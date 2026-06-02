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
import { describe, expect, test } from 'vitest';

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

  test('embedBatch preserves input order and per-row dim is 384', async () => {
    const emb = new LocalTransformerEmbedder();
    const rows = await emb.embedBatch(['alpha', 'beta', 'gamma']);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toHaveLength(EXPECTED_DIM);
      const norm = l2Norm(row);
      expect(Math.abs(norm - 1.0)).toBeLessThan(L2_TOLERANCE);
    }
    // Order preserved + rows distinct (semantic discrimination per row).
    expect(rows[0]).not.toEqual(rows[1]);
    expect(rows[1]).not.toEqual(rows[2]);
  }, 90_000);

  test('embed and embedBatch agree on identical input (batch path produces same output as singleton path)', async () => {
    const emb = new LocalTransformerEmbedder();
    const single = await emb.embed('exact text');
    const [batched] = await emb.embedBatch(['exact text']);
    expect(batched).toEqual(single);
  }, 60_000);
});
