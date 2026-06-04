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
import type { Context } from 'hono';
import type { z } from 'zod';

export const EMPTY_BODY = Symbol('empty-body');
export const MALFORMED_BODY = Symbol('malformed-body');

export async function safeJson(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim().length === 0) return EMPTY_BODY;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return MALFORMED_BODY;
  }
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
