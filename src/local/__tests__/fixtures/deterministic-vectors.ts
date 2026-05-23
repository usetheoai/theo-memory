/**
 * Deterministic vectors for VectorStore conformance tests.
 *
 * Three orthogonal-ish 1536-dim vectors at known relative similarities:
 *  - VEC_A: e1 (all weight on first dimension)
 *  - VEC_B: e2 (all weight on second dimension)
 *  - VEC_C: 0.7*e1 + 0.71*e2 (rotated mix; closer to A and B than they are to each other)
 *
 * Cosine similarities (the metric vector_cosine_ops uses):
 *  cos(A, B) = 0
 *  cos(A, C) ≈ 0.7
 *  cos(B, C) ≈ 0.71
 *
 * @see src/local/__tests__/vector-store-conformance.test.ts
 */
import { MAX_EMBEDDING_DIM } from '../../../core/constants.js';

function makeBasisVector(index: number): readonly number[] {
  const vec = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  vec[index] = 1;
  return vec;
}

function makeMixedVector(weights: readonly { index: number; weight: number }[]): readonly number[] {
  const vec = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  for (const { index, weight } of weights) {
    vec[index] = weight;
  }
  return vec;
}

export const VEC_A: readonly number[] = makeBasisVector(0);
export const VEC_B: readonly number[] = makeBasisVector(1);
export const VEC_C: readonly number[] = makeMixedVector([
  { index: 0, weight: 0.7 },
  { index: 1, weight: 0.71 },
]);
