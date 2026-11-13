/**
 * Tests for `StubEmbedder` + `StubLLM` — T4.5 of plan v0-2-theokit-binding (v1.1).
 *
 * Per ADR D8: deterministic stub adapters so scaffolded `npm install && npm run dev`
 * boots without crashing on the embedder dimension probe. Consumer sees demo route
 * work BEFORE wiring real OpenAI/Anthropic providers.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';

import { InMemoryVectorStore } from './in-memory-store.js';

import { createLocalMemory, PROBE_TEXT, StubEmbedder, StubLLM } from './index.js';

// Static, so loading the whole barrel happens while the file is collected and does not count
// against a test's timeout (a dynamic import inside the test timed out under parallel load).
import * as publicBarrel from '@usetheo/memory';

let warnSpy: MockInstance<(typeof console)['warn']>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('StubEmbedder (ADR D8)', () => {
  test('embed(PROBE_TEXT) returns a vector of MAX_EMBEDDING_DIM zeros (probe-safe)', async () => {
    const stub = new StubEmbedder();
    const vector = await stub.embed(PROBE_TEXT);
    expect(vector).toHaveLength(MAX_EMBEDDING_DIM);
    expect(vector.every((v) => v === 0)).toBe(true);
  });

  test('embedBatch returns one zero-vector per input in input order', async () => {
    const stub = new StubEmbedder();
    const batch = await stub.embedBatch(['a', 'b', 'c']);
    expect(batch).toHaveLength(3);
    for (const vec of batch) {
      expect(vec).toHaveLength(MAX_EMBEDDING_DIM);
      expect(vec.every((v) => v === 0)).toBe(true);
    }
  });

  test('warns once on first non-probe call; subsequent non-probe calls are silent', async () => {
    const stub = new StubEmbedder();
    await stub.embed(PROBE_TEXT); // probe — no warn
    await stub.embed('real text 1'); // first real call — warns
    await stub.embed('real text 2'); // second real call — silent
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('StubEmbedder');
    expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/replace|stub|production/i);
  });
});

describe('StubLLM (ADR D8)', () => {
  test('generateResponse returns an empty-object placeholder (safe shape)', async () => {
    const stub = new StubLLM();
    const result = await stub.generateResponse([{ role: 'user', content: 'hi' }]);
    expect(result).toEqual({});
  });

  test('generateChat returns an empty-content LLMResponse with role=assistant', async () => {
    const stub = new StubLLM();
    const result = await stub.generateChat([{ role: 'user', content: 'hi' }]);
    expect(result.role).toBe('assistant');
    expect(result.content).toBe('');
  });

  test('warns once on first real method call (shared flag across both methods)', async () => {
    const stub = new StubLLM();
    await stub.generateChat([{ role: 'user', content: 'first' }]);
    await stub.generateResponse([{ role: 'user', content: 'second' }]);
    await stub.generateChat([{ role: 'user', content: 'third' }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('StubLLM');
  });
});

describe('createLocalMemory with stubs — probe path (ADR D8 integration)', () => {
  test('factory resolves without throwing EmbeddingMismatch when stubs supplied as defaults', async () => {
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: new StubEmbedder(),
      llm: new StubLLM(),
    });
    expect(memory).toBeDefined();
    // Three-tier API is reachable; scoped instances type-check correctly
    expect(memory.user('alice')).toBeDefined();
  });
});

describe('Public surface (top-level barrel)', () => {
  test('StubEmbedder + StubLLM are importable from @usetheo/memory', () => {
    expect(typeof publicBarrel.StubEmbedder).toBe('function');
    expect(typeof publicBarrel.StubLLM).toBe('function');
  });
});
