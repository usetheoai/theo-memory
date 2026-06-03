/**
 * POST /v1/recall handler.
 *
 * Empty results return 200 with `{ results: [] }`, NOT 404 (EC-11 absorption).
 */
import type { Context } from 'hono';

import type { Memory } from '../../core/memory-store.js';
import { RecallBody, resolveScope, type MemoryLike } from '../schemas.js';

import { EMPTY_BODY, MALFORMED_BODY, safeJson, scopeOrValidationError } from './remember.js';

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
  const parsed = RecallBody.safeParse(json);
  if (!parsed.success) {
    return scopeOrValidationError(parsed.error, c);
  }
  const { query, topK, threshold, attributedTo, asOf } = parsed.data;
  const scoped = resolveScope(memory as unknown as MemoryLike, parsed.data);
  const results = await scoped.recall(query, {
    topK,
    threshold,
    attributedTo,
    asOf: asOf !== undefined ? new Date(asOf) : undefined,
  });
  return c.json({ results }, 200);
}
