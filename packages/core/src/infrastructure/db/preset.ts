/**
 * Zero-config `createMemory` preset — boot a working local Memory from just a
 * Postgres URL + OpenAI key, with no adapter wiring by the consumer.
 *
 * The preset is the convenience branch of `createMemory` (see `factory.ts`
 * dispatcher). It wires `OpenAIEmbedder` + `OpenAILLM` + `PgvectorStore` +
 * `pg.Pool`, auto-runs migrations by default (opt-out `{ migrate: false }`),
 * owns the pool lifecycle, and returns a `DisposableMemory` whose `dispose()`
 * also ends the pool it created. A consumer needing custom adapters / a
 * different embedding dim uses the full-config `createLocalMemory` path.
 *
 * @see .claude/knowledge-base/plans/create-memory-preset-plan.md
 */
import type { Pool } from 'pg';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';

import type { LocalMemoryConfig } from './config.js';
import { createLocalMemory } from './factory.js';
import type { DisposableMemory } from './local-memory.js';
import { runMigrations } from './migrations-runner.js';
import { PgvectorStore } from './pgvector-store.js';

/**
 * Zero-config preset input for `createMemory`.
 *
 * - `postgres` — Postgres connection string (required). Also the runtime
 *   discriminator vs {@link LocalMemoryConfig} (which has no `postgres` field).
 * - `openai` — OpenAI API key. When provided it is set on
 *   `process.env.OPENAI_API_KEY` before the adapters are constructed (they read
 *   the key lazily from env). When omitted, the ambient `OPENAI_API_KEY` is
 *   used. NOTE: one key per process — the OpenAI client is a module-global lazy
 *   singleton; for multiple keys use the full-config `createLocalMemory` path.
 * - `migrate` — run `runMigrations` on boot. Defaults to `true`; pass `false`
 *   when migrations are applied out-of-band.
 *
 * There is intentionally NO `embeddingDim` field: the preset always constructs
 * the 1536-dim OpenAI `text-embedding-3-small` embedder, so a dim override
 * could only mismatch (D4/EC-3). Custom dims go through `createLocalMemory`.
 */
export interface CreateMemoryPresetConfig {
  readonly postgres: string;
  readonly openai?: string;
  readonly migrate?: boolean;
}

/**
 * Runtime discriminator between the preset shape and the full
 * {@link LocalMemoryConfig}. `postgres` is present only on the preset shape
 * (verified against `config.ts` + `memory-store.ts`), so a string `postgres`
 * field is a sound discriminator for the `createMemory` overload.
 */
export function isPresetConfig(
  input: CreateMemoryPresetConfig | LocalMemoryConfig,
): input is CreateMemoryPresetConfig {
  return typeof (input as CreateMemoryPresetConfig).postgres === 'string';
}

/**
 * Thrown when a preset config is invalid — currently a missing/empty `postgres`
 * connection string. Raised fail-fast in {@link resolvePreset} BEFORE any pool
 * is opened, so the caller gets a clear typed error rather than a deferred,
 * opaque driver error (Unbreakable Rule 8; EC-4).
 *
 * Uses `Object.setPrototypeOf` so `instanceof` survives the ESM/CJS boundary +
 * dynamic imports (same pattern as `src/domain/errors.ts`).
 */
export class InvalidPresetConfig extends Error {
  override readonly name = 'InvalidPresetConfig' as const;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, InvalidPresetConfig.prototype);
  }
}

/** The 1536-dim OpenAI `text-embedding-3-small` — the preset's fixed dim (D4/EC-3). */
const PRESET_EMBEDDING_DIM = MAX_EMBEDDING_DIM;

/**
 * Pool-owning assembly of a preset {@link DisposableMemory}. Adapter-agnostic
 * (embedder/llm injected) so it is exercised deterministically by the GOAL
 * integration test with stub adapters against a real pool. Not a public export
 * — the barrel exposes only {@link CreateMemoryPresetConfig},
 * {@link InvalidPresetConfig}, and `createMemory` (D5). The integration test
 * deep-imports this seam.
 *
 * Owns the pool: the returned `dispose()` also `pool.end()`s exactly once
 * (idempotent). On any failure during migrate/wire the pool is closed before
 * the error propagates, so a failed boot never leaks it (EC-1).
 *
 * @internal
 */
export async function assemblePresetMemory(deps: {
  readonly pool: Pool;
  readonly embedder: Embedder;
  readonly llm: LLM;
  readonly migrate: boolean;
}): Promise<DisposableMemory> {
  const { pool, embedder, llm, migrate } = deps;
  try {
    if (migrate) {
      await runMigrations(pool, { embeddingDim: PRESET_EMBEDDING_DIM });
    }
    const vectorStore = new PgvectorStore(pool, { embeddingDim: PRESET_EMBEDDING_DIM });
    const memory = await createLocalMemory({
      embedder,
      llm,
      vectorStore,
      embeddingDim: PRESET_EMBEDDING_DIM,
    });
    return wrapDisposeWithPoolEnd(memory, pool);
  } catch (error) {
    // EC-1: close the pool we opened before propagating — no leak on failed boot.
    await pool.end();
    throw error;
  }
}

/**
 * Override `dispose()` on the memory instance so it also ends the preset-owned
 * pool exactly once. Mutates the instance in place (does NOT spread) so the
 * `LocalMemory` prototype methods (`user`/`session`/`agent`/`recall`/…) survive
 * — a `{ ...memory }` spread would drop them.
 */
function wrapDisposeWithPoolEnd(
  memory: DisposableMemory,
  pool: Pool,
): DisposableMemory {
  const innerDispose = memory.dispose.bind(memory);
  let disposed = false;
  (memory as { dispose: () => Promise<void> }).dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    await innerDispose();
    await pool.end();
  };
  return memory;
}

/**
 * Resolve the zero-config preset into a working {@link DisposableMemory}.
 *
 * Order (EC-4 first): validate `postgres` fail-fast BEFORE opening a pool →
 * set `OPENAI_API_KEY` from `openai` only when truthy (EC-5, never clobber an
 * ambient key with an empty string) → open the pool → lazily import the OpenAI
 * adapters + `pg` (dynamic import keeps `openai` OUT of the default barrel's
 * static graph, mirroring the cache-store precedent in `factory.ts`) → delegate
 * to {@link assemblePresetMemory} (migrate defaults to `true`).
 */
export async function resolvePreset(config: CreateMemoryPresetConfig): Promise<DisposableMemory> {
  if (typeof config.postgres !== 'string' || config.postgres.trim() === '') {
    throw new InvalidPresetConfig(
      'createMemory preset requires a non-empty `postgres` connection string',
    );
  }
  if (config.openai) {
    process.env['OPENAI_API_KEY'] = config.openai;
  }
  const { OpenAIEmbedder } = await import('../embedders/openai.js');
  const { OpenAILLM } = await import('../llms/openai.js');
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: config.postgres });
  return assemblePresetMemory({
    pool,
    embedder: new OpenAIEmbedder(),
    llm: new OpenAILLM(),
    migrate: config.migrate ?? true,
  });
}
