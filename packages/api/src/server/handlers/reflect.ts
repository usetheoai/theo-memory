/**
 * POST /v1/reflect handler.
 *
 * Returns 202 Accepted with `{ jobId, derivedCount }`. Reflection is
 * potentially-long-running (LLM consolidation) — async/queued semantics per
 * ADR D2.
 */
import type { Memory } from '@usetheo/memory/contract';
import { SessionToGlobalConsolidationPolicy } from '@usetheo/memory';
import type { Context } from 'hono';

import { ReflectBody, resolveScope } from '../schemas.js';

import {
  EMPTY_BODY,
  MALFORMED_BODY,
  safeJson,
  scopeOrValidationError,
  principalUserId,
  workspaceBoundMemory,
} from './_body-parsing.js';

export async function reflectHandler(c: Context, memory: Memory): Promise<Response> {
  const json = await safeJson(c);
  if (json === MALFORMED_BODY) {
    return c.json({ code: 'BAD_REQUEST', message: 'Malformed JSON body' }, 400);
  }
  if (json === EMPTY_BODY) {
    return c.json(
      { code: 'INVALID_BODY', message: 'Request body required' },
      422,
    );
  }
  const parsed = ReflectBody.safeParse(json);
  if (!parsed.success) {
    return scopeOrValidationError(parsed.error, c);
  }
  const { maxIterations } = parsed.data;
  // multi-tenant-workspace-isolation T3.1: scope reflect by the Principal's workspace (ADR D3).
  const scoped = resolveScope(workspaceBoundMemory(c, memory), parsed.data, principalUserId(c));
  // Session-separation fix (2026-07-23): a SESSION-tier reflect threads the M9
  // SessionToGlobalConsolidationPolicy so durable working memories (default
  // confirmation_count ≥ 3 — M11 FAILCLOSED_DEFAULT_POLICY threshold) are
  // PROMOTED to the (workspace, user) global tier. Before this, the policy was
  // SDK-only — no REST caller ever triggered the shipped M9 promotion.
  const isSessionTier = typeof (parsed.data as { sessionId?: unknown }).sessionId === 'string';
  const result = await scoped.reflect({
    maxIterations,
    ...(isSessionTier ? { conflictResolution: new SessionToGlobalConsolidationPolicy() } : {}),
  });
  return c.json(result, 202);
}
