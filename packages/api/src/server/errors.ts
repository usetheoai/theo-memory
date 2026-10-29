/**
 * Domain-error → HTTP envelope mapping (T1.6).
 *
 * Pure function: `mapDomainErrorToResponse(err: unknown)` translates any
 * thrown error into `{ status, body: { code, message, field? } }`. Wired
 * into `app.onError` via a thin Hono adapter (`src/server/app.ts`).
 *
 * EC-23 absorption: ANY error that's not mapped explicitly falls through to
 * the 500 INTERNAL_ERROR branch with a sanitized body. Raw `err.message`
 * (e.g. pg's `relation memories does not exist`) is NEVER echoed in the
 * response body. The unredacted message IS captured via `console.error`
 * for operator diagnosability — AFTER passing through `redactSecrets()`.
 *
 * EC-24 absorption: `redactSecrets()` strips `Bearer <token>` substrings
 * (case-insensitive per RFC 9110 §5.1 + OWASP logging guide) BEFORE any
 * value reaches `console.error`. Scope is bearer-only at P0; AWS keys /
 * Authorization headers / password fields are YAGNI and risk false
 * positives on legitimate memory content.
 *
 * @see Plan theo-memory-standalone-p0 § T1.6 + ADR D11 + EC-23 + EC-24
 */
import {
  BiTemporalNotSupportedLocally,
  ContentTooLargeError,
  EmbedderError,
  EmptyScopeError,
  InvalidScope,
  IdempotencyConflict,
  MemoryJobUnavailable,
  InvalidSkillError,
  MemoryNotFound,
  MemoryStoreError,
  MissingScopeError,
  WorkspaceMismatch,
} from '@usetheo/memory/contract';

export interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export interface MappedErrorResponse {
  readonly status: number;
  readonly body: ErrorEnvelope;
}

const BEARER_TOKEN_PATTERN = /bearer\s+\S+/gi;

export function redactSecrets(input: string): string {
  return input.replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]');
}

function logSanitized(err: unknown): void {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  // EC-24 — redact BEFORE handing to console.error; logs are the only
  // place the original (sanitized) message survives. console.error is the
  // canonical structured-log sink for server boundary errors in the absence
  // of a wired OTel log signal (planned but out-of-scope for P0 / T1.6).
  // eslint-disable-next-line no-console -- intentional log sink at error boundary
  console.error(redactSecrets(raw));
}

export function mapDomainErrorToResponse(err: unknown): MappedErrorResponse {
  if (err instanceof MemoryJobUnavailable) return { status: 409, body: { code: 'JOB_UNAVAILABLE', message: err.message } };
  if (err instanceof IdempotencyConflict) return { status: 409, body: { code: 'IDEMPOTENCY_CONFLICT', message: err.message } };
  // Log first so even mapped errors leave an audit trail; redaction is applied.
  logSanitized(err);

  if (err instanceof InvalidScope || err instanceof EmptyScopeError || err instanceof MissingScopeError) {
    return { status: 422, body: { code: 'INVALID_SCOPE', message: 'Scope validation failed.' } };
  }
  if (err instanceof MemoryNotFound || err instanceof WorkspaceMismatch) {
    // WorkspaceMismatch → 404 (NOT 403/500): a cross-workspace target must not
    // leak its existence in another tenant (ADR D6 + OWASP IDOR). Defense-in-depth
    // behind the scoped-skill forget() workspace guard (skills-write-surface /review).
    return { status: 404, body: { code: 'MEMORY_NOT_FOUND', message: 'Memory not found.' } };
  }
  if (err instanceof ContentTooLargeError) {
    return { status: 413, body: { code: 'CONTENT_TOO_LARGE', message: 'Payload exceeds maximum allowed size.' } };
  }
  if (err instanceof BiTemporalNotSupportedLocally) {
    return {
      status: 501,
      body: { code: 'NOT_IMPLEMENTED', message: 'Feature not available on this runtime.' },
    };
  }
  if (err instanceof InvalidSkillError) {
    return { status: 422, body: { code: 'INVALID_SKILL', message: 'Skill payload validation failed.' } };
  }
  if (err instanceof MemoryStoreError || err instanceof EmbedderError) {
    return {
      status: 503,
      body: { code: 'SERVICE_UNAVAILABLE', message: 'Upstream service unavailable. Retry later.' },
    };
  }
  // Default: anything else (pg native errors, unknown throws) → 500 sanitized.
  // Message verbatim matches the pre-T1.6 EC-10 envelope (no trailing period)
  // so the T1.2 regression test `body.message === 'Internal server error'`
  // continues to pass without scope creep.
  return { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
}
