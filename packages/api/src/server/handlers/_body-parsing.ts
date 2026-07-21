/**
 * Shared body-parsing utilities consumed by every `/v1/*` POST handler.
 *
 * Extracted from `remember.ts` per fixes-cycle-1 T1.2 (F-rev-12 absorption)
 * — `remember.ts` previously had two reasons to change (the `/v1/remember`
 * semantic AND the shared body-parser surface). SRP discipline per
 * `architecture.md § 7`. The leading underscore prefix (`_body-parsing.ts`)
 * signals "module-internal helper, not a public handler" — Hono routes are
 * mounted explicitly in `app.ts`, so the prefix is informational only.
 *
 * @see Plan theo-memory-standalone-p0-fixes-cycle-1 § T1.2 + ADR D2
 */
import type { Memory, Principal } from '@usetheo/memory/contract';
import { DEFAULT_WORKSPACE_ID } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import type { z } from 'zod';

export const EMPTY_BODY = Symbol('empty-body');
export const MALFORMED_BODY = Symbol('malformed-body');

/**
 * multi-tenant-workspace-isolation T3.1 (ADR D3): bind `memory` to the
 * authenticated Principal's workspace (injected by the auth middleware via
 * `c.set('principal')`). When no Principal is present (auth middleware not
 * mounted — e.g. a bare test harness) OR the impl predates `withWorkspace`,
 * falls back to the `default` workspace. The workspace ALWAYS comes from the
 * credential here, never from the request body.
 */
export function workspaceBoundMemory(c: Context, memory: Memory): Memory {
  const principal = c.get('principal') as Principal | undefined;
  const workspaceId = principal?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  return memory.withWorkspace !== undefined ? memory.withWorkspace(workspaceId) : memory;
}

/** MCP-parity user-scope header the edge injects (mirrors the streamable-http transport). */
const USER_SCOPE_HEADER = 'X-Theo-User-Id';
const SCOPE_TIER_KEYS = ['userId', 'sessionId', 'agentId'] as const;

/**
 * Resolve the user tier the SAME way the MCP transport does: when the body names
 * no scope tier, fall back to the auth-trusted `X-Theo-User-Id` the edge injects.
 *
 * Why: the REST surface took the tier ONLY from the body, so the Claude Code kit
 * hooks (which post no tier) landed under a project-name id invisible to the
 * dashboard, while the MCP tools landed under the credential's subject. This unifies
 * both onto one user space the dashboard reads. Body-supplied tiers still win — the
 * header is a fallback, never an override — and an absent identity stays absent so
 * the schema's single-tier refine still fails closed. Returns a NEW object; never
 * mutates the input.
 */
export function applyHeaderUserScope<T extends Record<string, unknown>>(c: Context, body: T): T {
  const alreadyTiered = SCOPE_TIER_KEYS.some(
    (k) => body[k] !== undefined && body[k] !== null,
  );
  if (alreadyTiered) return body;
  const headerUser = c.req.header(USER_SCOPE_HEADER)?.trim();
  if (headerUser === undefined || headerUser === '') return body;
  return { ...body, userId: headerUser };
}

export async function safeJson(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim().length === 0) return EMPTY_BODY;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return MALFORMED_BODY;
  }
}

/**
 * Read + JSON-parse the request body, returning the parsed value OR a ready 4xx
 * Response for the malformed (400) / empty (422) cases. Callers:
 * `const json = await readJsonBody(c); if (json instanceof Response) return json;`
 * then `Schema.safeParse(json)`. Shared by the single + batch remember handlers (DRY).
 */
export async function readJsonBody(c: Context): Promise<unknown> {
  const json = await safeJson(c);
  if (json === MALFORMED_BODY) {
    return c.json({ code: 'BAD_REQUEST', message: 'Malformed JSON body' }, 400);
  }
  if (json === EMPTY_BODY) {
    return c.json({ code: 'INVALID_BODY', message: 'Request body required' }, 422);
  }
  return json;
}

export function scopeOrValidationError(err: z.ZodError, c: Context): Response {
  const scopeIssue = err.issues.find(
    (i) => i.message.startsWith('INVALID_SCOPE'),
  );
  if (scopeIssue !== undefined) {
    return c.json(
      { code: 'INVALID_SCOPE', message: scopeIssue.message, field: 'scope' },
      422,
    );
  }
  return c.json(
    { code: 'INVALID_BODY', message: err.issues[0]?.message ?? 'Request body invalid' },
    422,
  );
}
