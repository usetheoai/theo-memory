/**
 * GOAL TEST — create-memory-preset (T2.2).
 *
 * Proves the zero-config preset boots a working Memory against real
 * ankane/pgvector:v0.5.1 and round-trips remember+recall in top-k.
 *
 * The CI-runnable path uses the @internal `assemblePresetMemory` seam with
 * DeterministicStub adapters (deterministic, no live OpenAI key): the stored
 * item is the LLM-extracted fact and DeterministicStubEmbedder gives different
 * vectors for different text, so `threshold: 0` is required and the assertion
 * is `results.length > 0` (mirrors local-runtime.test.ts:99, EC-2). A separate
 * block gated behind an explicit `THEOMEM_TEST_REAL_OPENAI=1` opt-in exercises
 * the true zero-config public path `createMemory({ postgres, openai })` with a
 * LIVE OpenAI call (opt-in so a stray ambient key can't auto-trigger billing).
 *
 * Gated by THEOMEM_PG_URI (EC-17: fail loudly in CI when unset).
 *
 * @see .claude/knowledge-base/plans/create-memory-preset-plan.md § T2.2
 */
import pg from 'pg';
import { afterEach, describe, expect, test } from 'vitest';

import { createMemory } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';
import { DeterministicStubLLM } from '@usetheo/memory/llms/stub';

// @internal seam — deep-imported (NOT a barrel export), per plan D5.
import { assemblePresetMemory } from '../../packages/core/src/infrastructure/db/preset.js';
import { createIsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

// EC-17: CI env guard — fail loudly when CI=true but env unset (no false-green).
if (process.env['CI'] === 'true' && (PG_URI === undefined || PG_URI === '')) {
  throw new Error(
    'EC-17: THEOMEM_PG_URI must be set in CI for tests/integration/** to run; refusing to false-green skip',
  );
}

describe.skipIf(PG_URI === undefined || PG_URI === '')('create-memory-preset — integration', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const c = cleanups.pop();
      if (c) await c().catch(() => undefined);
    }
  });

  test('create-memory preset wires pool + migrations + store and round-trips remember+recall in top-k', async () => {
    const pool = new pg.Pool({ connectionString: PG_URI });
    const memory = await assemblePresetMemory({
      pool,
      embedder: new DeterministicStubEmbedder(),
      llm: new DeterministicStubLLM(),
      migrate: true, // idempotent on the already-migrated shared DB; proves the wiring
    });
    cleanups.push(() => memory.dispose());

    await memory.user('u1').remember('Paulo likes coffee');
    // EC-2: stored item is the extracted fact; stub embedder → low cross-text
    // cosine → threshold:0 required; assert the fact is recalled (migrations
    // fired + store queried).
    const results = await memory.user('u1').recall('coffee', { topK: 3, threshold: 0 });
    expect(results.length).toBeGreaterThan(0);
  });

  test('preset dispose ends the pool it owns', async () => {
    const pool = new pg.Pool({ connectionString: PG_URI });
    const memory = await assemblePresetMemory({
      pool,
      embedder: new DeterministicStubEmbedder(),
      llm: new DeterministicStubLLM(),
      migrate: false, // schema already present on the shared DB
    });
    await memory.dispose();
    // A query on an ended pool rejects (pg: "Cannot use a pool after calling end").
    await expect(pool.query('SELECT 1')).rejects.toThrow();
  });

  test('preset migrate:false on an un-migrated DB surfaces a clear missing-relation error (EC-6)', async () => {
    const iso = await createIsolatedDb({ fresh: true }); // empty DB (template0), no schema
    cleanups.push(() => iso.dropDb());
    const pool = new pg.Pool({ connectionString: iso.uri });

    // assemblePresetMemory owns `pool` and ends it on failure (EC-1), so we do
    // NOT push a pool cleanup here. Both failure branches close `pool` exactly
    // once: (a) assembly throws → EC-1 catch ends it; (b) assembly succeeds then
    // remember throws → the finally below disposes (which ends it). Mutually
    // exclusive, so no double-end. The whole flow must reject with a Postgres
    // missing-relation error (the consumer's explicit migrate:false).
    const error = await assemblePresetMemory({
      pool,
      embedder: new DeterministicStubEmbedder(),
      llm: new DeterministicStubLLM(),
      migrate: false,
    })
      .then(async (memory) => {
        // If assembly unexpectedly succeeds against an empty DB, the write must fail.
        try {
          await memory.user('u1').remember('should fail on missing tables');
        } finally {
          await memory.dispose();
        }
        return null;
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/does not exist|relation|memories/i);
  });

  // True zero-config public path — makes a LIVE OpenAI call, so it is gated
  // behind an EXPLICIT opt-in (THEOMEM_TEST_REAL_OPENAI=1) rather than the mere
  // presence of OPENAI_API_KEY: a stray/expired ambient key on a dev machine
  // must not auto-trigger a billing call (and would 401). Run with a valid key:
  //   THEOMEM_TEST_REAL_OPENAI=1 OPENAI_API_KEY=sk-... npm run test:integration -- tests/integration/create-memory-preset.test.ts
  describe.skipIf(process.env['THEOMEM_TEST_REAL_OPENAI'] !== '1')('real OpenAI adapters', () => {
    test('createMemory({ postgres, openai }) round-trips remember+recall', async () => {
      const memory = await createMemory({
        postgres: PG_URI as string,
        openai: process.env['OPENAI_API_KEY'],
        migrate: true,
      });
      cleanups.push(() => memory.dispose());
      await memory.user('real-1').remember('The Eiffel Tower is in Paris');
      const results = await memory.user('real-1').recall('Where is the Eiffel Tower?', {
        topK: 3,
        threshold: 0,
      });
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
