/**
 * adapters-openrouter-local-embedder T1.1 — RED-phase tests for
 * `LocalTransformerEmbedder` (the Wasm-runtime local embedder
 * implementing the Embedder DIP via the @xenova/transformers pipeline).
 *
 * **Cost discipline:** these tests load the actual ONNX model from disk
 * on first invocation (~22 MB cache). First run downloads from the
 * HuggingFace CDN; subsequent runs read from
 * `~/.cache/transformers-js/` (or the equivalent on the test runner).
 * Test runtime budget: ~10s per test once cache is warm; the first run
 * pays a one-time network cost.
 *
 * **Determinism:** the underlying model is deterministic at inference
 * (no temperature; argmax pooling for sentence-transformers). The same
 * input MUST produce the same output bit-for-bit on the same hardware.
 *
 * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T1.1 + ADR D1
 * @see .claude/knowledge-base/implementations/adapters-openrouter-local-embedder/sepa-iterations/iteration-4-pre-red.md (lazy singleton + L2 + batch slicing)
 */
import { describe, expect, test, vi } from 'vitest';

import { LocalTransformerEmbedder } from '../local.js';

const EXPECTED_DIM = 384;
const L2_TOLERANCE = 1e-6;

function l2Norm(v: readonly number[]): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

describe('LocalTransformerEmbedder — Embedder DIP contract (T1.1)', () => {
  test('embed(text) returns a vector of length 384 (Xenova/all-MiniLM-L6-v2 dim)', async () => {
    const emb = new LocalTransformerEmbedder();
    const v = await emb.embed('hello world');
    expect(v).toHaveLength(EXPECTED_DIM);
  }, 60_000);

  test('embed(text) returns a unit-norm L2 vector (cosine distance is well-defined)', async () => {
    const emb = new LocalTransformerEmbedder();
    const v = await emb.embed('I prefer dark mode');
    const norm = l2Norm(v);
    expect(Math.abs(norm - 1.0)).toBeLessThan(L2_TOLERANCE);
  }, 60_000);

  test('embed is deterministic: same input twice yields identical output', async () => {
    const emb = new LocalTransformerEmbedder();
    const a = await emb.embed('The quick brown fox');
    const b = await emb.embed('The quick brown fox');
    expect(a).toEqual(b);
  }, 60_000);

  test('embed: distinct inputs produce distinct outputs (semantic discrimination)', async () => {
    const emb = new LocalTransformerEmbedder();
    const a = await emb.embed('I love coffee');
    const b = await emb.embed('Stocks rose 3% yesterday');
    expect(a).not.toEqual(b);
  }, 60_000);

  test('embedBatch([]) returns [] without invoking the pipeline (matches OpenAIEmbedder precedent)', async () => {
    const emb = new LocalTransformerEmbedder();
    const out = await emb.embedBatch([]);
    expect(out).toEqual([]);
  });

  // /review F-Mi11 — split from a single "preserves input order AND per-row
  // dim is 384" test (testing.md anti-pattern: "and" in test names).
  test('embedBatch returns one vector per input in input order', async () => {
    const emb = new LocalTransformerEmbedder();
    const rows = await emb.embedBatch(['alpha', 'beta', 'gamma']);
    expect(rows).toHaveLength(3);
    expect(rows[0]).not.toEqual(rows[1]);
    expect(rows[1]).not.toEqual(rows[2]);
  }, 90_000);

  test('embedBatch per-row dim is 384', async () => {
    const emb = new LocalTransformerEmbedder();
    const rows = await emb.embedBatch(['alpha', 'beta', 'gamma']);
    for (const row of rows) {
      expect(row).toHaveLength(EXPECTED_DIM);
    }
  }, 90_000);

  test('embedBatch rows are L2-normalized', async () => {
    const emb = new LocalTransformerEmbedder();
    const rows = await emb.embedBatch(['alpha', 'beta', 'gamma']);
    for (const row of rows) {
      const norm = l2Norm(row);
      expect(Math.abs(norm - 1.0)).toBeLessThan(L2_TOLERANCE);
    }
  }, 90_000);

  // /review F-Mi11 — renamed from "embed and embedBatch agree on identical
  // input" (testing.md anti-pattern: "and" in test names).
  test('batch-of-one matches singleton output for the same text', async () => {
    const emb = new LocalTransformerEmbedder();
    const single = await emb.embed('exact text');
    const [batched] = await emb.embedBatch(['exact text']);
    expect(batched).toEqual(single);
  }, 60_000);

  // /review F-M12 EC-5 — empty-string embed contract. Edge-case review marked
  // this as SHOULD TEST; we honor the contract by asserting the embedder
  // returns a 384-dim vector even on '' input (Xenova's mean-pooling +
  // L2-normalize produces a finite vector for any tokenizable input,
  // including the empty string which tokenizes to BOS+EOS only).
  test('EC-5: embed("") returns a 384-dim vector (no crash on empty input)', async () => {
    const emb = new LocalTransformerEmbedder();
    const v = await emb.embed('');
    expect(v).toHaveLength(EXPECTED_DIM);
    // Vector should be finite (no NaN/Inf from a divide-by-zero).
    for (const x of v) {
      expect(Number.isFinite(x)).toBe(true);
    }
  }, 60_000);
});

// /review F-M12 EC-7 — warmup network failure retry contract. Edge-case
// review marked this as SHOULD TEST; the F-M5 fix promises that a transient
// pipeline rejection no longer poisons the lazy singleton. We exercise
// that fix here by mocking `@xenova/transformers` to reject on the FIRST
// pipeline() call and succeed on the SECOND, then asserting that the
// second `embed()` call recovers instead of returning the cached rejection.
//
// NOTE: this test re-imports `LocalTransformerEmbedder` via dynamic import
// AFTER `vi.doMock` registers the mocked module, so the module-level
// singleton in `src/embedders/local.ts` is a fresh instance for this test.
describe('LocalTransformerEmbedder — F-M5 / EC-7 retry on transient pipeline failure', () => {
  test('rejected singleton resets so the next call retries instead of caching the failure forever', async () => {
    vi.resetModules();
    let callCount = 0;
    vi.doMock('@xenova/transformers', () => ({
      pipeline: vi.fn().mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.reject(new Error('simulated HF CDN failure'));
        }
        // 2nd call: return a fake pipeline that mimics the Xenova output shape.
        const fakePipeline = (
          _input: string | readonly string[],
          _opts: { pooling: string; normalize: boolean },
        ) => {
          // 384-dim zero-vector with one '1' set so the result is unit-norm.
          const dim = 384;
          const data = new Float32Array(dim);
          data[0] = 1;
          return Promise.resolve({ data, dims: [1, dim] });
        };
        return Promise.resolve(fakePipeline);
      }),
    }));

    const { LocalTransformerEmbedder: Local } = await import('../local.js');
    const emb = new Local();

    // 1st call rejects (HF CDN simulated failure).
    await expect(emb.embed('first')).rejects.toThrow(/simulated HF CDN failure/);

    // /review F-M5 — the rejected promise MUST have been cleared from the
    // singleton so this 2nd call invokes pipeline() again (callCount → 2).
    const v = await emb.embed('second');
    expect(v).toHaveLength(384);
    expect(callCount).toBe(2);

    vi.doUnmock('@xenova/transformers');
    vi.resetModules();
  }, 60_000);
});
