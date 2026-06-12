/**
 * Contract tests for DeterministicStubEmbedder.
 *
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T1.1 + EC-1
 */
import { describe, it, expect } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';

import { DeterministicStubEmbedder } from './stub.js';

describe('DeterministicStubEmbedder.embed', () => {
  it('returns same vector for repeated calls with same text', async () => {
    // Given a fresh embedder and a text
    const embedder = new DeterministicStubEmbedder();
    const text = 'Paulo likes coffee';

    // When embed is called twice with the same text
    const v1 = await embedder.embed(text);
    const v2 = await embedder.embed(text);

    // Then both vectors are deeply equal (pure-function determinism)
    expect(v1).toEqual(v2);
  });

  it('returns distinct vectors for distinct texts', async () => {
    // Given a fresh embedder
    const embedder = new DeterministicStubEmbedder();

    // When embed is called with two distinct texts
    const a = await embedder.embed('a');
    const b = await embedder.embed('b');

    // Then the vectors are different (no collision on common inputs)
    expect(a).not.toEqual(b);
  });

  it('returns 1536-dimensional vector (MAX_EMBEDDING_DIM)', async () => {
    const embedder = new DeterministicStubEmbedder();
    const v = await embedder.embed('any text');
    expect(v).toHaveLength(MAX_EMBEDDING_DIM);
  });

  it('returns L2-normalized unit vector OR all-zeros fallback (EC-1)', async () => {
    const embedder = new DeterministicStubEmbedder();
    const v = await embedder.embed('test');
    const sumSq = v.reduce((acc, x) => acc + x * x, 0);
    const norm = Math.sqrt(sumSq);
    // Norm is 1.0 (within float tolerance) OR 0 (EC-1 NaN-guard fallback)
    expect(norm === 0 || Math.abs(norm - 1.0) < 1e-6).toBe(true);
  });

  it('produces NO NaN for empty string input', async () => {
    const embedder = new DeterministicStubEmbedder();
    const v = await embedder.embed('');
    expect(v.some((x) => Number.isNaN(x))).toBe(false);
    expect(v).toHaveLength(MAX_EMBEDDING_DIM);
  });

  /**
   * F-tests-2 / F-dom-memory-1 absorption: seeded LCG counter replaces
   * `Math.random()` per `testing.md § Determinism` — flaky-fixture rule
   * forbids non-deterministic test inputs. Inline 5-line LCG (Numerical
   * Recipes constants) gives byte-reproducible 1000-input sequence
   * across runs.
   */
  function makeSeededLcg(seed: number): () => string {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state.toString(36);
    };
  }

  it('produces NO NaN across 1000 seeded-LCG inputs (EC-1 stress)', async () => {
    const embedder = new DeterministicStubEmbedder();
    const nextSuffix = makeSeededLcg(0xec1);
    for (let i = 0; i < 1000; i++) {
      const v = await embedder.embed(`text-${i}-${nextSuffix()}`);
      expect(v.some((x) => Number.isNaN(x))).toBe(false);
    }
  });

  it('seeded LCG inputs produce byte-reproducible embedding sequence across runs (F-tests-2)', async () => {
    // Cross-run determinism: identical seeded sequence yields identical
    // embedding arrays (the determinism invariant is locked at the seed
    // level, not the Math.random() level).
    const embedder = new DeterministicStubEmbedder();
    async function run(): Promise<readonly number[][]> {
      const next = makeSeededLcg(0xdeadbeef);
      const out: number[][] = [];
      for (let i = 0; i < 10; i++) {
        const v = await embedder.embed(`text-${i}-${next()}`);
        out.push([...v]);
      }
      return out;
    }
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
  });
});

describe('DeterministicStubEmbedder.embedBatch', () => {
  it('returns per-element parity with embed', async () => {
    const embedder = new DeterministicStubEmbedder();
    const texts = ['alpha', 'beta', 'gamma'];

    const batch = await embedder.embedBatch(texts);
    const single = await Promise.all(texts.map((t) => embedder.embed(t)));

    expect(batch).toEqual(single);
  });

  it('returns empty array for empty input', async () => {
    const embedder = new DeterministicStubEmbedder();
    const batch = await embedder.embedBatch([]);
    expect(batch).toEqual([]);
  });
});
