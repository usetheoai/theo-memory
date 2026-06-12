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
import { describe, expect, test, vi } from 'vitest';

import type { Pool } from 'pg';

import { wireMemoryFromPool } from '../agent-tools-memory.js';

vi.mock('../../local/index.js', () => ({
  createLocalMemory: vi.fn(async () => ({})),
  runMigrations: vi.fn(async () => undefined),
}));

vi.mock('../../local/pgvector-store.js', () => ({
  PgvectorStore: class {
    constructor() {}
  },
}));

vi.mock('../../embedders/local.js', () => ({
  LocalTransformerEmbedder: class {
    constructor() {}
  },
}));

vi.mock('../../llms/openai.js', () => ({
  OpenAILLM: class {
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
