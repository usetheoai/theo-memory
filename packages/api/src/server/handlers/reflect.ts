/**
 * POST /v1/reflect handler.
 *
 * Returns 202 Accepted with `{ jobId, derivedCount }`. Reflection is
 * potentially-long-running (LLM consolidation) — async/queued semantics per
 * ADR D2.
 */
import type { Memory } from '@usetheo/memory/contract';
import type { Context } from 'hono';

import { ReflectBody, resolveScope } from '../schemas.js';

import { EMPTY_BODY, MALFORMED_BODY, safeJson, scopeOrValidationError } from './_body-parsing.js';

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
  const scoped = resolveScope(memory, parsed.data);
  const result = await scoped.reflect({ maxIterations });
  return c.json(result, 202);
}
