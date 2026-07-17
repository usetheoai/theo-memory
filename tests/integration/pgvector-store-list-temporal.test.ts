/**
 * Integration test for T2.1 — PgvectorStore.list() projects `created_at` column,
 * maps NULL legacy rows to `undefined` (EC-1 defensive-in-depth), and orders rows
 * deterministically by `created_at DESC, id ASC` (EC-2 pagination determinism).
 *
 * Plan: dashboard-memories-tab-standardization v1.3, Phase 2 / T2.1.
 *
 * Runs against the real `ankane/pgvector:v0.5.1` container via THEOMEM_PG_URI.
 * Gating + truncate pattern mirrors `tests/integration/pgvector-store.test.ts`
 * (canonical integration shape since v0.1).
 *
 * EC-1 absorption — NULL `created_at` defensive-in-depth:
 *   The Drizzle schema at `src/local/schema.ts:128` declares
 *   `createdAt: timestamp(...).defaultNow().notNull()`. NULL is NOT reachable
 *   via the SDK INSERT path. The EC-1 guard exists for forward-compatibility
 *   against (a) manual `psql` INSERT bypassing the DEFAULT after a temporary
 *   constraint drop, (b) future schema relaxation, (c) `pg_restore` with the
 *   constraint dropped during data load. The test constructs the scenario by
 *   `ALTER TABLE memories ALTER COLUMN created_at DROP NOT NULL`, inserting
 *   a NULL row, asserting the mapping, then cleaning up + restoring NOT NULL.
 *
 * EC-2 absorption — deterministic ordering:
 *   Pre-T2.1 SQL was `ORDER BY created_at ASC` (single key). When two rows
 *   share the same `created_at`, Postgres returns them in physical heap order
 *   (which can vary across vacuum / page-reuse). T2.1 flips to
 *   `ORDER BY created_at DESC, id ASC` so identical-timestamp rows have a
 *   deterministic id tiebreak — Dashboard pagination consumes this contract.
 *
 * @see src/local/schema.ts:128 (created_at .notNull())
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import pg from 'pg';

import { PgvectorStore } from '@usetheo/memory';
import { vectorLiteral } from '../../packages/core/src/infrastructure/db/pgvector-vector-literal.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

/** Schema declares `vector(1536)` (default StubEmbedder dim for shared DB). */
const EMBEDDING_DIM = 1536;

function makeVec(seed = 0.1): readonly number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[0] = seed;
  return v;
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('PgvectorStore.list temporal projection (THEOMEM_PG_URI not set — skipping)', () => {
    test('placeholder', () => {
      // No-op
    });
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const store = new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM });

  beforeAll(async () => {
    // Quarantine to a fresh state — the integration suite runs against a
    // shared container, so other suites may have left rows behind.
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  afterEach(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('PgvectorStore.list — T2.1 temporal projection + EC-1 + EC-2', () => {
    test('list() returns createdAt from db per row, matching inserted timestamps', async () => {
      // Given: 2 rows with explicit, distinct created_at timestamps via direct SQL
      //        (bypasses PgvectorStore.insert so the test controls the timestamp).
      // Vector serialized via vectorLiteral() + parameterized `$N::vector` cast,
      // mirroring production INSERT pattern at src/local/pgvector-store.ts:324.
      const t1 = new Date('2026-01-15T10:00:00Z');
      const t2 = new Date('2026-01-15T11:00:00Z');
      const id1 = '00000000-0000-0000-0000-000000000001';
      const id2 = '00000000-0000-0000-0000-000000000002';
      await pool.query(
        `INSERT INTO memories (id, text, hash, embedding, payload, user_id, created_at)
         VALUES ($1, 'row 1', 'h1', $2::vector, '{}'::jsonb, 'alice', $3),
                ($4, 'row 2', 'h2', $5::vector, '{}'::jsonb, 'alice', $6)`,
        [id1, vectorLiteral(makeVec(0.1)), t1, id2, vectorLiteral(makeVec(0.2)), t2],
      );

      // When: list with the user_id filter
      const [results] = await store.list({ user_id: 'alice' }, 10);

      // Then: BOTH rows projected, each with createdAt matching its inserted value.
      expect(results).toHaveLength(2);
      const byId = new Map(results.map((r) => [r.id, r]));
      expect(byId.get(id1)?.createdAt?.toISOString()).toBe(t1.toISOString());
      expect(byId.get(id2)?.createdAt?.toISOString()).toBe(t2.toISOString());
    });

    test('list() maps NULL created_at to undefined, NOT new Date(0) / 1970-01-01 (EC-1 defensive-in-depth)', async () => {
      // PRE-CONDITION: schema declares created_at .notNull() (see file docstring
      // for EC-1 rationale). Drop the constraint temporarily to construct the
      // forward-compat scenario, then restore in finally.
      //
      // Test pairs a CONTROL row (non-NULL createdAt) with the LEGACY row (NULL).
      // The control row makes the test a TRUE RED pre-fix — pre-fix mapper never
      // projects created_at, so both control AND legacy come back undefined, and
      // the control assertion against the inserted Date fails. Post-fix the
      // control matches its inserted Date AND the legacy row maps to undefined.
      await pool.query('ALTER TABLE memories ALTER COLUMN created_at DROP NOT NULL');
      try {
        const tControl = new Date('2026-01-15T12:00:00Z');
        const idControl = '00000000-0000-0000-0000-000000000004';
        const idLegacy = '00000000-0000-0000-0000-000000000003';
        await pool.query(
          `INSERT INTO memories (id, text, hash, embedding, payload, user_id, created_at)
           VALUES ($1, 'control row', 'h-ctrl', $2::vector, '{}'::jsonb, 'alice', $3),
                  ($4, 'legacy row', 'h-legacy', $5::vector, '{}'::jsonb, 'alice', NULL)`,
          [idControl, vectorLiteral(makeVec(0.3)), tControl, idLegacy, vectorLiteral(makeVec(0.35))],
        );

        const [results] = await store.list({ user_id: 'alice' }, 10);

        expect(results).toHaveLength(2);
        const byId = new Map(results.map((r) => [r.id, r]));
        // CONTROL: maps the actual DB timestamp (forces true RED pre-fix).
        expect(byId.get(idControl)?.createdAt?.toISOString()).toBe(tControl.toISOString());
        // LEGACY: EC-1 — NULL → undefined. NOT `new Date(0)` (silent epoch lie).
        expect(byId.get(idLegacy)?.createdAt).toBeUndefined();
        expect(byId.get(idLegacy)?.createdAt).not.toEqual(new Date(0));
      } finally {
        // Delete the NULL row BEFORE restoring NOT NULL (else SET NOT NULL fails).
        await pool.query('DELETE FROM memories WHERE created_at IS NULL');
        await pool.query('ALTER TABLE memories ALTER COLUMN created_at SET NOT NULL');
      }
    });

    test('list() EXCLUDES soft-deleted rows (t_invalid IS NOT NULL) — parity with search/recall', async () => {
      // Given: one live row + one soft-deleted row (t_invalid set) for the same user.
      // A consumer listing their memories (scopes endpoint / OpenMemory list_memories /
      // dashboard) must NOT see a memory they forgot — list MUST match recall, which
      // filters `t_invalid IS NULL`. The getAll projection already hardcodes
      // tInvalid:null, proving list was always intended to be live-only.
      const idLive = '00000000-0000-0000-0000-0000000000d1';
      const idDeleted = '00000000-0000-0000-0000-0000000000d2';
      await pool.query(
        `INSERT INTO memories (id, text, hash, embedding, payload, user_id, created_at, t_invalid)
         VALUES ($1, 'live row', 'h-live', $2::vector, '{}'::jsonb, 'alice', NOW(), NULL),
                ($3, 'forgotten row', 'h-del', $4::vector, '{}'::jsonb, 'alice', NOW(), NOW())`,
        [idLive, vectorLiteral(makeVec(0.7)), idDeleted, vectorLiteral(makeVec(0.8))],
      );

      // When: list with the user filter
      const [results, total] = await store.list({ user_id: 'alice' }, 10);

      // Then: only the live row is returned; the soft-deleted row is excluded
      // from BOTH the page AND the count.
      expect(results.map((r) => r.id)).toEqual([idLive]);
      expect(total).toBe(1);

      // BUT with includeSoftDeleted=true (Memory.reset full-scope purge path),
      // BOTH rows are returned so reset can physically delete the tombstone too.
      const [allResults, allTotal] = await store.list({ user_id: 'alice' }, 10, true);
      expect(allResults.map((r) => r.id).sort()).toEqual([idLive, idDeleted].sort());
      expect(allTotal).toBe(2);
    });

    test('list() orders by created_at DESC, id ASC across identical timestamps (EC-2 pagination determinism)', async () => {
      // Given: 3 rows.
      //   - idLater: with a LATER created_at — under DESC primary must come FIRST.
      //   - idA, idB: at IDENTICAL created_at — only deterministic discriminator is id ASC.
      //
      // The idLater row makes the test a TRUE RED pre-fix: pre-T2.1 SQL is
      // `ORDER BY created_at ASC`, which would put idLater LAST (newest last).
      // Post-T2.1 SQL is `ORDER BY created_at DESC, id ASC`, putting idLater FIRST
      // and breaking the identical-timestamp tie with id ASC (idA then idB).
      //
      // Without idLater the test would pass vacuously pre-fix when Postgres heap
      // order happens to match id ASC. Adding idLater forces a behavior contrast.
      const tEqual = new Date('2026-01-15T10:00:00Z');
      const tLater = new Date('2026-01-15T11:00:00Z'); // strictly later
      const idLater = '00000000-0000-0000-0000-00000000000c';
      const idA = '00000000-0000-0000-0000-00000000000a';
      const idB = '00000000-0000-0000-0000-00000000000b';
      await pool.query(
        `INSERT INTO memories (id, text, hash, embedding, payload, user_id, created_at)
         VALUES ($1, 'later', 'h-later', $4::vector, '{}'::jsonb, 'alice', $7),
                ($2, 'a',     'ha',      $5::vector, '{}'::jsonb, 'alice', $6),
                ($3, 'b',     'hb',      $8::vector, '{}'::jsonb, 'alice', $6)`,
        [
          idLater, idA, idB,
          vectorLiteral(makeVec(0.6)), // $4 idLater vector
          vectorLiteral(makeVec(0.4)), // $5 idA vector
          tEqual,                       // $6 — shared between idA + idB rows
          tLater,                       // $7 — idLater timestamp
          vectorLiteral(makeVec(0.5)), // $8 idB vector
        ],
      );

      // When: list 5 times in succession
      const observedOrders: string[][] = [];
      for (let i = 0; i < 5; i++) {
        const [results] = await store.list({ user_id: 'alice' }, 10);
        observedOrders.push(results.map((r) => r.id));
      }

      // Then: every call returns the same DESC primary, id ASC tie-break order.
      // Expected post-T2.1: [idLater (newest), idA, idB] — pre-T2.1 ASC would
      // produce [idA, idB, idLater] (oldest first), failing this assertion.
      for (const order of observedOrders) {
        expect(order).toEqual([idLater, idA, idB]);
      }
    });
  });
}
