/**
 * Cross-cutting constants tests.
 *
 * F-dom-3 absorption: assert MAX_EMBEDDING_DIM stays within the pgvector v0.5.1
 * HNSW limit (2000 dims for vector_cosine_ops). A future refactor that bumps
 * the constant above 2000 without bumping the pgvector image will silently
 * create an invalid HNSW index migration; this test catches it.
 *
 * Per ADR D1.7: v0.1 caps at 1536; v0.2 plan owns the bump when pgvector ≥ 0.7.0
 * (halfvec) or IVFFlat alternatives ship.
 */
import { describe, expect, test } from 'vitest';

import { MAX_EMBEDDING_DIM } from './constants.js';

describe('MAX_EMBEDDING_DIM', () => {
  test('does not exceed pgvector v0.5.1 HNSW limit of 2000 dimensions (ADR D1.7)', () => {
    expect(MAX_EMBEDDING_DIM).toBeLessThanOrEqual(2000);
  });

  test('is a positive integer', () => {
    expect(MAX_EMBEDDING_DIM).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_EMBEDDING_DIM)).toBe(true);
  });

  test('matches the v0.1 locked value of 1536 per ADR D1.7', () => {
    // If this fails, the constant was bumped — verify ADR D1.7 was updated too
    // (and that the pgvector image supports the new dimension under HNSW).
    expect(MAX_EMBEDDING_DIM).toBe(1536);
  });
});
