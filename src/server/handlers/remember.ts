/**
 * POST /v1/remember handler.
 *
 * @see Plan theo-memory-standalone-p0 § T1.2 + ADR D2 (RPC shape) + ADR D11
 *      (DI composition) + ADR D12 (single scope tier via schemas.ts)
 */
import type { Context } from 'hono';
import type { z } from 'zod';

import type { Memory } from '../../core/memory-store.js';
import { RememberBody, resolveScope, type MemoryLike } from '../schemas.js';

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
  const scoped = resolveScope(memory as unknown as MemoryLike, parsed.data);
  const items = await scoped.remember(text, { infer, attributedTo, metadata });
  return c.json({ items }, 201);
}

const EMPTY_BODY = Symbol('empty-body');
const MALFORMED_BODY = Symbol('malformed-body');

async function safeJson(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim().length === 0) return EMPTY_BODY;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return MALFORMED_BODY;
  }
}

function scopeOrValidationError(err: z.ZodError, c: Context): Response {
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

export { safeJson, scopeOrValidationError, EMPTY_BODY, MALFORMED_BODY };
