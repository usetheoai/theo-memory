/**
 * POST /v1/remember handler.
 *
 * @see Plan theo-memory-standalone-p0 § T1.2 + ADR D2 (RPC shape) + ADR D11
 *      (DI composition) + ADR D12 (single scope tier via schemas.ts)
 * @see Plan theo-memory-standalone-p0-fixes-cycle-1 § T1.2 (shared body-parsing
 *      utilities extracted to ./_body-parsing.js per SRP discipline)
 */
import type { ChosenScope, Memory, Principal, RoutingAuditStore } from '@usetheo/memory/contract';
import { DEFAULT_WORKSPACE_ID, recordRoutingDecision } from '@usetheo/memory/contract';
import type { Context } from 'hono';

import { mapDomainErrorToResponse } from '../errors.js';
import { BatchRememberBody, RememberBody, resolveScope } from '../schemas.js';

import {
  applyHeaderUserScope,
  readJsonBody,
  scopeOrValidationError,
  actingUserId,
  workspaceBoundMemory,
} from './_body-parsing.js';

/**
 * M11 T3.1 wiring — audit the routing decision a successful remember made: the `user` tier lands in the
 * `(workspace, user)` GLOBAL scope, `session`/`agent` in the ephemeral SESSION scope. Best-effort +
 * opt-in (only when a `RoutingAuditStore` is wired) via the fail-soft `recordRoutingDecision` primitive
 * — a failed audit NEVER fails the remember (Rule 8).
 */
async function auditRememberRouting(
  c: Context,
  store: RoutingAuditStore,
  body: RememberBody,
  attributedTo: string | undefined,
): Promise<void> {
  const p = c.get('principal') as Principal | undefined;
  const workspaceId = p?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const chosenScope: ChosenScope = body.userId !== undefined ? 'global' : 'session';
  const auditUserId = actingUserId(c) ?? body.userId ?? body.sessionId ?? body.agentId ?? 'system';
  await recordRoutingDecision(store, {
    workspaceId,
    userId: auditUserId,
    chosenScope,
    attribution: attributedTo === 'agent' ? 'agent' : 'user',
    decidedBy: actingUserId(c) ?? 'system',
    why: `remember:${chosenScope === 'global' ? 'user-tier' : 'ephemeral-tier'}`,
    at: new Date(),
  });
}

export async function rememberHandler(c: Context, memory: Memory, routingAuditStore?: RoutingAuditStore): Promise<Response> {
  const json = await readJsonBody(c);
  if (json instanceof Response) return json;
  // MCP parity: when the body names no tier, fall back to the auth-trusted
  // X-Theo-User-Id the edge injects, so gateway-fronted callers (the kit hooks)
  // land under the credential's user — the same space the dashboard + MCP read.
  const withScope =
    typeof json === 'object' && json !== null
      ? applyHeaderUserScope(c, json as Record<string, unknown>)
      : json;
  const parsed = RememberBody.safeParse(withScope);
  if (!parsed.success) {
    return scopeOrValidationError(parsed.error, c);
  }
  const { text, infer, attributedTo, metadata, category, evidence, strictExtraction, idempotencyKey, expiresAt, observedAt } = parsed.data;
  // multi-tenant-workspace-isolation T3.1: bind to the Principal's workspace
  // (ADR D3) BEFORE resolving the body's tier — the workspace comes from the
  // credential, the tier from the body.
  const scoped = resolveScope(workspaceBoundMemory(c, memory), parsed.data, actingUserId(c));
  // themory-category-filter-server-side T4.2 — pass category through the SDK
  // boundary. EC-2 length check fires inside runExtractionPipeline at T3.3.
  const items = await scoped.remember(text, {
    infer, attributedTo, metadata, category,
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    ...(expiresAt !== undefined ? { expiresAt: new Date(expiresAt) } : {}),
    ...(observedAt !== undefined ? { observedAt: new Date(observedAt) } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
    ...(strictExtraction !== undefined ? { strictExtraction } : {}),
  });
  // M11 — audit the routing decision (best-effort, fail-soft, opt-in).
  if (routingAuditStore !== undefined) {
    await auditRememberRouting(c, routingAuditStore, parsed.data, attributedTo);
  }
  return c.json({ items }, 201);
}

/**
 * POST /v1/remember/batch handler (M6 claude-code-memory-integration T1.3).
 *
 * One request carries an array of per-item remember payloads (validated by
 * {@link BatchRememberBody}). The workspace is bound ONCE from the Principal
 * (never the body); each item carries its own scope tier. Each item reuses the
 * exact `scoped.remember` path (`infer:false` verbatim store + composite-UPSERT
 * idempotency), so a re-run bumps `confirmation_count` and reports
 * `rejectedAsDuplicate` — no double-insert. Per-item failures are caught and
 * reported in the aggregate (honest partial success per error-handling.md — a
 * poison item never fails the whole batch, and never a silent 500).
 */
export async function batchRememberHandler(c: Context, memory: Memory, routingAuditStore?: RoutingAuditStore): Promise<Response> {
  const json = await readJsonBody(c);
  if (json instanceof Response) return json;
  // Single-remember parity (#109 live E2E): apply the auth-trusted X-Theo-User-Id fallback
  // PER ITEM, exactly like rememberHandler does for its one body — a tier-less batch item
  // from a gateway-fronted caller (the migrator, the kit) binds to the credential's user
  // instead of 422-ing the whole batch. No header → items must name their tier (fail-closed).
  const withScope =
    typeof json === 'object' && json !== null && Array.isArray((json as { items?: unknown }).items)
      ? {
          ...(json as Record<string, unknown>),
          items: ((json as { items: unknown[] }).items).map((item) =>
            typeof item === 'object' && item !== null
              ? applyHeaderUserScope(c, item as Record<string, unknown>)
              : item,
          ),
        }
      : json;
  const parsed = BatchRememberBody.safeParse(withScope);
  if (!parsed.success) {
    return scopeOrValidationError(parsed.error, c);
  }
  // Bind to the Principal's workspace ONCE (ADR D3) — reused for every item.
  const bound = workspaceBoundMemory(c, memory);
  const results: unknown[] = [];
  const errors: { readonly index: number; readonly code: string; readonly message: string }[] = [];
  let imported = 0;
  let deduped = 0;
  for (let i = 0; i < parsed.data.items.length; i++) {
    const item = parsed.data.items[i]!;
    try {
      const scoped = resolveScope(bound, item, actingUserId(c));
      // `ScopedMemoryLike.remember` is typed `unknown` at the REST boundary; the
      // runtime shape is the MemoryItem array (with `rejectedAsDuplicate`).
      const written = (await scoped.remember(item.text, {
        infer: item.infer,
        ...(item.idempotencyKey !== undefined ? { idempotencyKey: item.idempotencyKey } : {}),
        ...(item.expiresAt !== undefined ? { expiresAt: new Date(item.expiresAt) } : {}),
        ...(item.observedAt !== undefined ? { observedAt: new Date(item.observedAt) } : {}),
        ...(item.strictExtraction !== undefined ? { strictExtraction: item.strictExtraction } : {}),
        ...(item.evidence !== undefined ? { evidence: item.evidence } : {}),
        attributedTo: item.attributedTo,
        metadata: item.metadata,
        category: item.category,
      })) as readonly { readonly rejectedAsDuplicate?: boolean }[];
      for (const row of written) {
        results.push(row);
        if (row.rejectedAsDuplicate === true) deduped += 1;
        else imported += 1;
      }
      // M11 F-tests-2 — audit this batched routing decision (best-effort, fail-soft, opt-in).
      if (routingAuditStore !== undefined) {
        await auditRememberRouting(c, routingAuditStore, item, item.attributedTo);
      }
    } catch (err) {
      // M6-SEC-02: route the per-item failure through the SAME sanitizer every
      // other verb uses (mapDomainErrorToResponse → sanitized {code,message},
      // logs the raw message with Bearer-token redaction). NEVER echo raw
      // err.message — a pg native error or a token-bearing message must not leak.
      const { body } = mapDomainErrorToResponse(err);
      errors.push({ index: i, code: body.code, message: body.message });
    }
  }
  return c.json(
    { items: results, imported, deduped, failed: errors.length, ...(errors.length > 0 ? { errors } : {}) },
    201,
  );
}
