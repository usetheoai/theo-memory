/**
 * Unit tests for the zero-config createMemory preset (create-memory-preset plan).
 *
 * T1.1 — CreateMemoryPresetConfig shape discriminator.
 * T1.2 — assemblePresetMemory (pool-owning assembly) + resolvePreset (env-set,
 *        migrate opt-out, fail-fast) with a mock pool + deterministic stub adapters.
 *
 * @see .claude/knowledge-base/plans/create-memory-preset-plan.md
 */
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';

import type { LocalMemoryConfig } from './config.js';
import {
  assemblePresetMemory,
  InvalidPresetConfig,
  isPresetConfig,
  resolvePreset,
} from './preset.js';

// ── Collaborator mocks (vi.mock intercepts BOTH static + dynamic imports) ──
// Spies live inside vi.hoisted so the hoisted vi.mock factories can reference
// them (vi.mock is hoisted above normal module-level consts).
const { runMigrations, pgvectorCtor, createLocalMemory, OpenAIEmbedderMock, OpenAILLMMock, PoolCtor } =
  vi.hoisted(() => ({
    runMigrations: vi.fn(async () => undefined),
    // Constructor mocks use regular function expressions (arrow fns are not
    // constructable → `new X()` would throw "not a constructor").
    pgvectorCtor: vi.fn(function (pool: unknown, opts: unknown) {
      return { __pool: pool, __opts: opts };
    }),
    createLocalMemory: vi.fn(async () => ({ dispose: vi.fn(async () => undefined) })),
    OpenAIEmbedderMock: vi.fn(function () {
      return { kind: 'openai-embedder' };
    }),
    OpenAILLMMock: vi.fn(function () {
      return { kind: 'openai-llm' };
    }),
    PoolCtor: vi.fn(function () {
      return { end: vi.fn(async () => undefined) };
    }),
  }));
vi.mock('./migrations-runner.js', () => ({ runMigrations }));
vi.mock('./pgvector-store.js', () => ({ PgvectorStore: pgvectorCtor }));
vi.mock('./factory.js', () => ({ createLocalMemory }));
vi.mock('../embedders/openai.js', () => ({ OpenAIEmbedder: OpenAIEmbedderMock }));
vi.mock('../llms/openai.js', () => ({ OpenAILLM: OpenAILLMMock }));
vi.mock('pg', () => ({ default: { Pool: PoolCtor } }));

function fakePool() {
  return { end: vi.fn(async () => undefined) } as unknown as Pool;
}
const fakeEmbedder = { kind: 'e' } as unknown as Embedder;
const fakeLlm = { kind: 'l' } as unknown as LLM;

describe('T1.1 — isPresetConfig discriminator', () => {
  it('test_isPresetConfig_true_for_postgres_shape', () => {
    expect(isPresetConfig({ postgres: 'postgres://localhost/db' })).toBe(true);
  });

  it('test_isPresetConfig_false_for_full_config', () => {
    const fullConfig = {
      embedder: {} as unknown,
      llm: {} as unknown,
      vectorStore: {} as unknown,
    } as unknown as LocalMemoryConfig;
    expect(isPresetConfig(fullConfig)).toBe(false);
  });
});

describe('T1.2 — assemblePresetMemory (pool-owning assembly)', () => {
  beforeEach(() => {
    runMigrations.mockClear();
    pgvectorCtor.mockClear();
    createLocalMemory.mockClear();
  });

  it('test_assemble_runs_migrations_by_default', async () => {
    await assemblePresetMemory({ pool: fakePool(), embedder: fakeEmbedder, llm: fakeLlm, migrate: true });
    expect(runMigrations).toHaveBeenCalledTimes(1);
  });

  it('test_assemble_skips_migrations_when_migrate_false', async () => {
    await assemblePresetMemory({ pool: fakePool(), embedder: fakeEmbedder, llm: fakeLlm, migrate: false });
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it('test_assemble_dispose_ends_pool_once', async () => {
    const pool = fakePool();
    const mem = await assemblePresetMemory({ pool, embedder: fakeEmbedder, llm: fakeLlm, migrate: true });
    await mem.dispose();
    await mem.dispose();
    expect((pool as unknown as { end: ReturnType<typeof vi.fn> }).end).toHaveBeenCalledTimes(1);
  });

  it('test_assemble_ends_pool_on_migration_failure', async () => {
    const pool = fakePool();
    runMigrations.mockRejectedValueOnce(new Error('migration boom'));
    await expect(
      assemblePresetMemory({ pool, embedder: fakeEmbedder, llm: fakeLlm, migrate: true }),
    ).rejects.toThrow('migration boom');
    expect((pool as unknown as { end: ReturnType<typeof vi.fn> }).end).toHaveBeenCalledTimes(1);
  });

  it('test_assemble_uses_dim_1536', async () => {
    await assemblePresetMemory({ pool: fakePool(), embedder: fakeEmbedder, llm: fakeLlm, migrate: true });
    expect(runMigrations).toHaveBeenCalledWith(expect.anything(), { embeddingDim: 1536 });
    expect(pgvectorCtor).toHaveBeenCalledWith(expect.anything(), { embeddingDim: 1536 });
  });
});

describe('T1.2 — resolvePreset (env-set, validation)', () => {
  let prevKey: string | undefined;
  beforeEach(() => {
    prevKey = process.env['OPENAI_API_KEY'];
    PoolCtor.mockClear();
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env['OPENAI_API_KEY'];
    else process.env['OPENAI_API_KEY'] = prevKey;
  });

  it('test_resolvePreset_sets_openai_env_when_key_provided', async () => {
    await resolvePreset({ postgres: 'postgres://x/db', openai: 'sk-passed', migrate: false });
    expect(process.env['OPENAI_API_KEY']).toBe('sk-passed');
  });

  it('test_resolvePreset_empty_openai_keeps_ambient_key', async () => {
    process.env['OPENAI_API_KEY'] = 'amb';
    await resolvePreset({ postgres: 'postgres://x/db', openai: '', migrate: false });
    expect(process.env['OPENAI_API_KEY']).toBe('amb');
  });

  it('test_resolvePreset_rejects_empty_postgres', async () => {
    // EC-4 + testing.md §4.1: pin the SPECIFIC typed error AND message, not just "it throws".
    await expect(resolvePreset({ postgres: '' })).rejects.toThrow(InvalidPresetConfig);
    await expect(resolvePreset({ postgres: '' })).rejects.toThrow(/non-empty `postgres`/);
    expect(PoolCtor).not.toHaveBeenCalled();
  });

  it('test_resolvePreset_rejects_whitespace_only_postgres', async () => {
    // The .trim()==='' guard branch (preset.ts) — a whitespace-only string is
    // still an invalid connection string and must fail fast before any pool opens.
    await expect(resolvePreset({ postgres: '   ' })).rejects.toThrow(InvalidPresetConfig);
    expect(PoolCtor).not.toHaveBeenCalled();
  });
});
