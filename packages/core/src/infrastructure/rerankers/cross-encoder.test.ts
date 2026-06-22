/**
 * Unit tests for CrossEncoderReranker (cross-encoder-reranker T3.1).
 *
 * The @xenova/transformers boundary is mocked: a fake tokenizer (callable
 * returning the pair inputs) + a fake model (callable returning logits whose
 * value encodes a deterministic per-doc score). The REAL model is exercised by
 * the integration GOAL test (T5.1).
 */
import { describe, expect, test, vi, beforeEach } from 'vitest';

import type { MemoryItemWithScore } from '../../domain/memory-item.js';
import type { Scope } from '../../domain/scope.js';

// --- @xenova mock -----------------------------------------------------------
// The model returns a logit per pair = the LENGTH of the doc text, so a longer
// doc scores higher after sigmoid (deterministic, model-free). The tokenizer
// records the (query, doc) pairs it was asked to encode.
const tokenizerCalls: { queries: string[]; docs: string[] }[] = [];
const tokenizerLoad = vi.fn();
const modelLoad = vi.fn();

vi.mock('@xenova/transformers', () => {
  const fakeTokenizer = (queries: string[], opts: { text_pair: string[] }) => {
    tokenizerCalls.push({ queries, docs: opts.text_pair });
    // Carry the docs forward so the fake model can derive a score.
    return { __docs: opts.text_pair };
  };
  const fakeModel = (inputs: { __docs: string[] }) => {
    const docs = inputs.__docs;
    // One logit per pair = doc length (large magnitude → sigmoid ~1 ordering).
    const data = Float32Array.from(docs.map((d) => d.length));
    return Promise.resolve({ logits: { data } });
  };
  return {
    AutoTokenizer: {
      from_pretrained: (...args: unknown[]) => {
        tokenizerLoad(...args);
        return Promise.resolve(fakeTokenizer);
      },
    },
    AutoModelForSequenceClassification: {
      from_pretrained: (...args: unknown[]) => {
        modelLoad(...args);
        return Promise.resolve(fakeModel);
      },
    },
  };
});

// Imported AFTER the mock is registered (vi.mock is hoisted).
const { CrossEncoderReranker } = await import('./cross-encoder.js');

const SCOPE: Scope = { kind: 'user', userId: 'u' };
const item = (id: string, text: string, score: number): MemoryItemWithScore => ({
  id,
  text,
  hash: id,
  scope: SCOPE,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  metadata: {},
  tValid: new Date(0),
  tInvalid: null,
  score,
});

beforeEach(() => {
  tokenizerCalls.length = 0;
  tokenizerLoad.mockClear();
  modelLoad.mockClear();
});

describe('CrossEncoderReranker', () => {
  test('empty candidates short-circuits to [] (no model load)', async () => {
    const r = new CrossEncoderReranker({ model: 'Xenova/empty-test' });
    const out = await r.rerank('q', [], 5);
    expect(out).toEqual([]);
    expect(tokenizerLoad).not.toHaveBeenCalled();
  });

  test('reranks by cross-encoder score desc + truncates to topK + does not mutate input', async () => {
    const r = new CrossEncoderReranker({ model: 'Xenova/order-test' });
    const input: MemoryItemWithScore[] = [
      item('short', 'hi', 0.9), // cosine #1 but shortest text → lowest rerank
      item('longest', 'a much longer passage', 0.5),
      item('mid', 'medium text', 0.6),
    ];
    const frozenIds = input.map((i) => i.id);
    const out = await r.rerank('q', input, 2);
    expect(out.map((o) => o.id)).toEqual(['longest', 'mid']);
    // sigmoid(len) is strictly increasing → score reflects relevance order.
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
    // input untouched (order preserved, items not mutated)
    expect(input.map((i) => i.id)).toEqual(frozenIds);
    expect(input[0]!.score).toBe(0.9);
  });

  test('builds (query, doc) pairs for the tokenizer', async () => {
    const r = new CrossEncoderReranker({ model: 'Xenova/pair-test' });
    await r.rerank('my query', [item('a', 'doc-a', 0.5), item('b', 'doc-b', 0.4)], 5);
    expect(tokenizerCalls).toHaveLength(1);
    expect(tokenizerCalls[0]!.queries).toEqual(['my query', 'my query']);
    expect(tokenizerCalls[0]!.docs).toEqual(['doc-a', 'doc-b']);
  });

  test('batches respect batchSize (two batches for 3 docs at batchSize=2)', async () => {
    const r = new CrossEncoderReranker({ model: 'Xenova/batch-test', batchSize: 2 });
    await r.rerank('q', [item('a', 'aa', 0.5), item('b', 'bbb', 0.4), item('c', 'c', 0.3)], 5);
    expect(tokenizerCalls).toHaveLength(2);
    expect(tokenizerCalls[0]!.docs).toEqual(['aa', 'bbb']);
    expect(tokenizerCalls[1]!.docs).toEqual(['c']);
  });

  test('concurrent test: two concurrent rerank() calls share ONE model load (single-load invariant)', async () => {
    const r = new CrossEncoderReranker({ model: 'Xenova/concurrent-test' });
    await Promise.all([
      r.rerank('q', [item('a', 'aa', 0.5)], 1),
      r.rerank('q', [item('b', 'bb', 0.5)], 1),
    ]);
    // Lazy singleton keyed by model id → loaded exactly once despite 2 concurrent callers.
    expect(tokenizerLoad).toHaveBeenCalledTimes(1);
    expect(modelLoad).toHaveBeenCalledTimes(1);
  });
});
