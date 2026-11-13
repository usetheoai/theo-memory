/**
 * POST /v1/recall handler.
 *
 * Empty results return 200 with `{ results: [] }`, NOT 404 (EC-11 absorption).
 */
import { randomUUID } from 'node:crypto';

import type { Memory } from '@usetheo/memory/contract';
import type { Context } from 'hono';

import { RecallBody, resolveScope } from '../schemas.js';

import {
  applyHeaderUserScope,
  EMPTY_BODY,
  MALFORMED_BODY,
  safeJson,
  scopeOrValidationError,
  actingUserId,
  workspaceBoundMemory,
} from './_body-parsing.js';

export async function recallHandler(c: Context, memory: Memory): Promise<Response> {
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
  // MCP parity: no body tier → fall back to the edge-injected X-Theo-User-Id, so a
  // gateway-fronted recall (the kit hooks) reads the credential's user space.
  const withScope =
    typeof json === 'object' && json !== null
      ? applyHeaderUserScope(c, json as Record<string, unknown>)
      : json;
  const parsed = RecallBody.safeParse(withScope);
  if (!parsed.success) {
    return scopeOrValidationError(parsed.error, c);
  }
  const { query, topK, threshold, attributedTo, asOf, graphExpand, includeSources } = parsed.data;
  // multi-tenant-workspace-isolation T3.1: scope recall by the Principal's workspace (ADR D3).
  const scoped = resolveScope(workspaceBoundMemory(c, memory), parsed.data, actingUserId(c));
  // explainable-recall S2 (D2) — mint the recall_id HERE so it can be BOTH driven
  // into the accountable-forgetting trace (SDK keys the recall_traces rows with it)
  // AND returned to the caller for the follow-up GET /v1/recall-traces/:recallId.
  const recallId = randomUUID();
  const results = await scoped.recall(query, {
    topK,
    threshold,
    attributedTo,
    asOf: asOf !== undefined ? new Date(asOf) : undefined,
    // rest-graph-aware-recall — pass the graph-expansion opt-in through to the
    // SDK recall (default OFF when absent; mirrors topK/threshold mapping).
    graphExpand,
    recallId,
    ...(includeSources !== undefined ? { includeSources } : {}),
  });
  return c.json({ results, recallId }, 200);
}
