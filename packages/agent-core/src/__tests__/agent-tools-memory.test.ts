/**
 * verbs-as-cli-fixes-cycle-2 T3.1 / EC-3 absorption — contract test pinning
 * the `wireMemoryFromPool` lifecycle invariant: the helper MUST NOT close
 * the pool. Caller owns the pool lifecycle (close it on dispose / shutdown).
 *
 * A future regression where someone "improves" wireMemoryFromPool by adding
 * a `pool.end()` finally clause "for safety" would break `createAgentToolsMemory`
 * (returns a Memory whose pool is closed) AND `run-mcp-server.ts` (crashes
 * on first MCP request) AND `run-server.ts` (crashes during readiness warm).
 * This test pins the contract at the unit-tier so the defect surfaces
 * before integration.
 *
 * @see plan verbs-as-cli-fixes-cycle-2 § ADR D4 + T3.1 step 6
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Pool } from 'pg';

import {
  wireMemoryFromPool,
  resolveEmbedderKind,
  embeddingDimForKind,
  LOCAL_EMBEDDER_DIM,
  OPENAI_EMBEDDER_DIM,
} from '../agent-tools-memory.js';

// Mock the ACTUAL specifiers wireMemoryFromPool imports (post extract-cli move +
// lazy optional-dep refactor): `@usetheo/memory` (createLocalMemory / runMigrations
// / PgvectorStore) statically, and `@usetheo/memory/embedders/local` +
// `@usetheo/memory/llms/openai` dynamically. Mocking these keeps the test hermetic —
// it must NOT pull the real @xenova/transformers + openai optional deps.
vi.mock('@usetheo/memory', () => ({
  createLocalMemory: vi.fn(async () => ({})),
  runMigrations: vi.fn(async () => undefined),
  PgvectorStore: class {
    constructor() {}
  },
}));

vi.mock('@usetheo/memory/embedders/local', () => ({
  LocalTransformerEmbedder: class {
    constructor() {}
  },
}));

vi.mock('@usetheo/memory/llms/openai', () => ({
  OpenAILLM: class {
    constructor() {}
  },
}));

vi.mock('@usetheo/memory/embedders/openai', () => ({
  OpenAIEmbedder: class {
    constructor() {}
  },
}));

describe('T3.1 / EC-3 — wireMemoryFromPool lifecycle invariant', () => {
  test('does NOT call pool.end() (caller owns pool lifecycle)', async () => {
    const endSpy = vi.fn(async () => undefined);
    const queryFn = vi.fn(async () => ({ rows: [] }));
    const fakePool = {
      end: endSpy,
      query: queryFn,
    } as unknown as Pool;

    await wireMemoryFromPool(fakePool);

    // The contract: wireMemoryFromPool MUST NOT close the pool.
    expect(endSpy).not.toHaveBeenCalled();
  });

  test('post-wire pool remains usable (query still works)', async () => {
    const endSpy = vi.fn(async () => undefined);
    const queryFn = vi.fn(async () => ({ rows: [{ ok: 1 }] }));
    const fakePool = {
      end: endSpy,
      query: queryFn,
    } as unknown as Pool;

    await wireMemoryFromPool(fakePool);

    // Caller can still query the pool — proves it stays open.
    const result = await fakePool.query('SELECT 1');
    expect(result).toBeDefined();
    expect(endSpy).not.toHaveBeenCalled();
  });
});

describe('embedder selection via THEOMEM_EMBEDDER', () => {
  const ENV = 'THEOMEM_EMBEDDER';
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV];
    delete process.env[ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  test('defaults to local when unset (back-compat)', () => {
    expect(resolveEmbedderKind()).toBe('local');
  });

  test("treats empty string as local", () => {
    process.env[ENV] = '';
    expect(resolveEmbedderKind()).toBe('local');
  });

  test('resolves openai when THEOMEM_EMBEDDER=openai', () => {
    process.env[ENV] = 'openai';
    expect(resolveEmbedderKind()).toBe('openai');
  });

  test('fails loud on an unknown value (no silent fallback)', () => {
    process.env[ENV] = 'cohere';
    expect(() => resolveEmbedderKind()).toThrow(/THEOMEM_EMBEDDER/);
  });

  test('dimension follows the embedder kind (local 384, openai 1536)', () => {
    expect(embeddingDimForKind('local')).toBe(LOCAL_EMBEDDER_DIM);
    expect(embeddingDimForKind('local')).toBe(384);
    expect(embeddingDimForKind('openai')).toBe(OPENAI_EMBEDDER_DIM);
    expect(embeddingDimForKind('openai')).toBe(1536);
  });

  test('wireMemoryFromPool with openai builds the OpenAI embedder at dim 1536', async () => {
    process.env[ENV] = 'openai';
    const { createLocalMemory } = await import('@usetheo/memory');
    const fakePool = { end: vi.fn(), query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;

    await wireMemoryFromPool(fakePool);

    // createLocalMemory receives embeddingDim 1536 on the openai path.
    const memArgs = vi.mocked(createLocalMemory).mock.calls.at(-1)?.[0] as { embeddingDim?: number } | undefined;
    expect(memArgs?.embeddingDim).toBe(1536);
  });
});
