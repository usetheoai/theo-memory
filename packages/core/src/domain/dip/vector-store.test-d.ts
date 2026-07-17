/**
 * Type-level shape assertion for T1.1 — VectorStoreResult.createdAt optional field.
 *
 * the extension is additive (optional field), backward-compatible across all 6+ callsites in
 * `src/local/index.ts` + impls in `src/local/pgvector-store.ts` + `src/local/in-memory-store.ts`.
 *
 * Per ADR D2: when `result.createdAt === undefined`, `LocalScopedMemory.getAll` falls back to
 * `new Date()` AND emits OTel `getall_temporal_fallback{count}` event for stale-impl auditability.
 *
 * Negative-type test uses the canonical Vitest `// @ts-expect-error` directive (NOT `as any`
 * which would bypass the type check entirely per SEPA pre-RED guidance).
 *
 */
import { describe, test, expectTypeOf } from 'vitest';

import type { VectorStoreResult } from './vector-store.js';

describe('VectorStoreResult — type-level shape (T1.1)', () => {
  test('accepts optional createdAt: Date', () => {
    // Positive: an object with createdAt: Date assigns to VectorStoreResult
    const withCreatedAt: VectorStoreResult = {
      id: 'x',
      payload: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    expectTypeOf(withCreatedAt).toMatchTypeOf<VectorStoreResult>();
  });

  test('createdAt is optional — omission is valid', () => {
    // Pre-T1.1 backward-compat: existing callsites that don't set createdAt still typecheck.
    const withoutCreatedAt: VectorStoreResult = { id: 'y', payload: {} };
    expectTypeOf(withoutCreatedAt).toMatchTypeOf<VectorStoreResult>();
  });

  test('rejects string in createdAt field', () => {
    // Canonical Vitest negative-type pattern: @ts-expect-error directive forces tsc
    // to FAIL the file unless the next line genuinely errors. The `as any` shape from
    // the original plan would bypass type-checking entirely (SEPA pre-RED finding).
    // @ts-expect-error createdAt must be Date | undefined, not string
    const bad: VectorStoreResult = { id: 'z', payload: {}, createdAt: '2026-01-01' };
    // Suppress unused-var warning (test body is no-op at runtime; assertion is at compile time).
    void bad;
  });
});
