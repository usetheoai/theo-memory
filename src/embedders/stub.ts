/**
 * DeterministicStubEmbedder — debug-only Embedder with pure-function determinism.
 *
 * Algorithm (plan ADR D2):
 *   1. MD5 of UTF-8 bytes of the input text.
 *   2. First 8 bytes of digest → BigInt seed for Lehmer LCG.
 *   3. Lehmer LCG (a=48271, m=2^31-1, the Park-Miller minimal standard) fills
 *      MAX_EMBEDDING_DIM floats in `[-1, 1]`.
 *   4. L2-normalize the resulting vector to lie on the unit hypersphere
 *      (cosine distance is well-defined).
 *
 * EC-1 absorption: if the pre-norm L2 magnitude is below `1e-30` (degenerate
 * near-zero case, probability ~2^-128 per input but defensive), `l2Normalize`
 * returns an all-zeros vector instead of dividing by ~0 and producing NaN.
 * pgvector's `vector(1536)` column REJECTS NaN with `ERROR: NaN not allowed
 * in vector`, so the guard prevents a catastrophic INSERT failure mode.
 *
 * Determinism invariants asserted in `__tests__/stub.test.ts`:
 *   - `embed(t)` is pure: same input → same output (deep equality).
 *   - `embed(t1) !== embed(t2)` for distinct texts (collision probability
 *     bounded by MD5 first-8-byte birthday ~ 2^32 inputs for 50% chance).
 *   - Output length === MAX_EMBEDDING_DIM === 1536.
 *   - L2 norm === 1.0 ± 1e-6 OR all-zeros (EC-1 fallback). NEVER NaN.
 *
 * @experimental — debug only. Not semantically meaningful for actual recall;
 *   use for race/dedup reproducibility (e.g., F-T4.1-2 isolation) and CI.
 *
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T1.1
 * @see .claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-edge-cases-2026-06-01.md § EC-1
 */
import { createHash } from 'node:crypto';

import { MAX_EMBEDDING_DIM } from '../core/constants.js';
import type { Embedder } from '../core/dip/embedder.js';

/** Park-Miller MINSTD multiplier (1988). */
const LCG_MULTIPLIER = 48271n;
/** Mersenne prime modulus 2^31 - 1, guarantees full period of m-1. */
const LCG_MODULUS = 2147483647n;
/** Half of the modulus, used to map LCG output `[0, m)` to `[-1, 1)`. */
const LCG_HALF_MODULUS_F64 = Number(LCG_MODULUS / 2n);
/** EC-1: epsilon below which we treat the vector as degenerate-zero. */
const L2_DEGENERATE_THRESHOLD = 1e-30;

function seedFromText(text: string): bigint {
  const digest = createHash('md5').update(text, 'utf8').digest();
  // First 8 bytes as unsigned 64-bit integer, then guarantee non-zero seed.
  const raw = digest.readBigUInt64BE(0);
  return raw === 0n ? 1n : raw % LCG_MODULUS === 0n ? raw + 1n : raw;
}

function lcgFill(seed: bigint, length: number): number[] {
  const out = new Array<number>(length);
  let state = seed % LCG_MODULUS;
  if (state === 0n) state = 1n;
  for (let i = 0; i < length; i++) {
    state = (state * LCG_MULTIPLIER) % LCG_MODULUS;
    out[i] = (Number(state) - LCG_HALF_MODULUS_F64) / LCG_HALF_MODULUS_F64;
  }
  return out;
}

function l2Normalize(v: number[]): number[] {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm < L2_DEGENERATE_THRESHOLD) {
    // EC-1 NaN-guard fallback — divide-by-near-zero would produce NaN-vector,
    // which pgvector's `vector(1536)` column REJECTS with a hard error.
    return new Array<number>(v.length).fill(0);
  }
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

export class DeterministicStubEmbedder implements Embedder {
  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract requires Promise return; algorithm is sync
  async embed(text: string): Promise<readonly number[]> {
    const seed = seedFromText(text);
    const raw = lcgFill(seed, MAX_EMBEDDING_DIM);
    return l2Normalize(raw);
  }

  async embedBatch(
    texts: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    const out: (readonly number[])[] = [];
    for (const text of texts) {
      out.push(await this.embed(text));
    }
    return out;
  }
}
