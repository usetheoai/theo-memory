/**
 * POST /v1/remember handler.
 *
 * @see Plan theo-memory-standalone-p0 § T1.2 + ADR D2 (RPC shape) + ADR D11
 *      (DI composition) + ADR D12 (single scope tier via schemas.ts)
 * @see Plan theo-memory-standalone-p0-fixes-cycle-1 § T1.2 (shared body-parsing
 *      utilities extracted to ./_body-parsing.js per SRP discipline)
 */
import type { Context } from 'hono';

import type { Memory } from '../../core/memory-store.js';
import { RememberBody, resolveScope } from '../schemas.js';

import { EMPTY_BODY, MALFORMED_BODY, safeJson, scopeOrValidationError } from './_body-parsing.js';

export async function rememberHandler(c: Context, memory: Memory): Promise<Response> {
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
  const parsed = RememberBody.safeParse(json);
  if (!parsed.success) {
    return scopeOrValidationError(parsed.error, c);
  }
  const { text, infer, attributedTo, metadata } = parsed.data;
  const scoped = resolveScope(memory, parsed.data);
  const items = await scoped.remember(text, { infer, attributedTo, metadata });
  return c.json({ items }, 201);
}
