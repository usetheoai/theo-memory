/**
 * T1.6 RED — Domain-error → HTTP envelope mapping.
 *
 * Pure-function `mapDomainErrorToResponse(err: unknown)` translates any
 * thrown error into a `{ status, body: { code, message, field? } }` shape.
 * Wired into `app.onError` via a thin Hono adapter (T1.6 GREEN).
 *
 * EC-23 absorption: pg-shaped errors (`code` + `severity` string fields)
 * fall to the default 500 branch — raw `err.message` (e.g. `relation
 * memories does not exist`) is NEVER echoed in the response body.
 *
 * EC-24 absorption: `Bearer <token>` substrings inside `err.message` are
 * redacted via `/bearer\s+\S+/gi` BEFORE the error reaches console.error
 * (so audit logs never carry leaked credentials).
 *
 * @see Plan theo-memory-standalone-p0 § T1.6 + EC-23 + EC-24
 */
import { describe, expect, test, vi } from 'vitest';

import {
  ContentTooLargeError,
  InvalidScope,
  MemoryNotFound,
} from '../../core/errors.js';
import { mapDomainErrorToResponse } from '../errors.js';

describe('T1.6 — mapDomainErrorToResponse', () => {
  test('19. InvalidScope error returns 422 with code: INVALID_SCOPE', () => {
    const { status, body } = mapDomainErrorToResponse(new InvalidScope('userId required'));
    expect(status).toBe(422);
    expect(body.code).toBe('INVALID_SCOPE');
    expect(typeof body.message).toBe('string');
  });

  test('20. MemoryNotFound error returns 404 with code: MEMORY_NOT_FOUND', () => {
    const { status, body } = mapDomainErrorToResponse(new MemoryNotFound('mem_abc'));
    expect(status).toBe(404);
    expect(body.code).toBe('MEMORY_NOT_FOUND');
  });

  test('21. Unknown error returns 500 without stack trace or raw message in body', () => {
    const raw = new Error('boom\n  at Object.<anonymous> (foo.ts:1:1)');
    const { status, body } = mapDomainErrorToResponse(raw);
    expect(status).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('boom');
    expect(body.message).not.toContain('at Object');
    expect(body).not.toHaveProperty('stack');
  });

  test('22. pg-shaped error message NOT echoed in response body (EC-23)', () => {
    // Duck-typed pg native error — DO NOT import `pg` (ADR D11 boundary).
    const pgError = Object.assign(new Error('relation memories does not exist'), {
      code: '42P01',
      severity: 'ERROR',
    });
    const { status, body } = mapDomainErrorToResponse(pgError);
    expect(status).toBe(500);
    expect(body.message).not.toContain('relation memories does not exist');
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  test('23. Error envelope shape: { code, message, field? } across all mapped errors', () => {
    const samples = [
      mapDomainErrorToResponse(new InvalidScope('x')),
      mapDomainErrorToResponse(new MemoryNotFound('m')),
      mapDomainErrorToResponse(new ContentTooLargeError(8_000, 10_000)),
      mapDomainErrorToResponse(new Error('?')),
    ];
    for (const { body } of samples) {
      expect(typeof body.code).toBe('string');
      expect(typeof body.message).toBe('string');
      // field is optional — when present, MUST be string
      if (body.field !== undefined) {
        expect(typeof body.field).toBe('string');
      }
    }
  });

  test('24. Bearer token in error.message is redacted before logging (EC-24)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow during assertion */
    });
    try {
      mapDomainErrorToResponse(new Error('upstream failed for Bearer sk-secret-abc123'));
      expect(spy).toHaveBeenCalled();
      const captured = spy.mock.calls.flat().map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)));
      const joined = captured.join(' ');
      expect(joined).not.toContain('sk-secret-abc123');
      expect(joined).toMatch(/bearer\s+\[REDACTED\]/i);
    } finally {
      spy.mockRestore();
    }
  });
});
