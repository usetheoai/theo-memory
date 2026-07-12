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
import type { LocalMemoryConfig } from './config.js';

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
