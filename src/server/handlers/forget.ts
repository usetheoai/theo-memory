/**
 * POST /v1/forget handler.
 *
 * `Memory.forget(memoryId, options?)` is TOP-LEVEL on Memory (no scope) per
 * v0.4b T7.1 PUBLIC API. Body shape: `{ memoryId, hard? }`.
 */
import type { Context } from 'hono';

import type { Memory } from '../../core/memory-store.js';
import { ForgetBody } from '../schemas.js';

import { EMPTY_BODY, MALFORMED_BODY, safeJson } from './_body-parsing.js';

export async function forgetHandler(c: Context, memory: Memory): Promise<Response> {
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
  const parsed = ForgetBody.safeParse(json);
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Body invalid' },
      422,
    );
  }
  const { memoryId, hard } = parsed.data;
  await memory.forget(memoryId, hard !== undefined ? { hard } : undefined);
  return c.body(null, 204);
}
