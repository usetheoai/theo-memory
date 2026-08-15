/**
 * M24 T1.1 — `recallConsolidationCandidates` returns the row embedding.
 *
 * The M24 bounded clustering (`clusterByProximity`) needs each candidate's
 * vector; the store already has it (`embedding` column) but did not project it.
 * This proves the store now returns a parsed `number[]` embedding of the
 * configured dim alongside `{memoryId,text,createdAt,confirmationCount}`.
 *
 * Keyless: no LLM — direct INSERT of `kind='extracted'` rows + the store read.
 * DB-gated per repo convention (`describe.skipIf(THEOMEM_PG_URI unset)`).
 */
import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { PgvectorStore } from '@usetheo/memory';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];
const DIM = 1536;

/** Distinct deterministic vector: 1 at `seed % DIM`, 0 elsewhere. */
function vec(seed: number): number[] {
  return new Array<number>(DIM).fill(0).map((_, i) => (i === seed % DIM ? 1 : 0));
}

interface ConsolidationStore {
  recallConsolidationCandidates(filters: {
    readonly workspace_id?: string;
    readonly user_id?: string;
  }): Promise<
    readonly {
      memoryId: string;
      text: string;
      createdAt: Date;
      confirmationCount?: number;
      embedding?: readonly number[];
    }[]
  >;
}

describe.skipIf(PG_URI === undefined || PG_URI === '')(
  'M24 T1.1 — recallConsolidationCandidates returns the embedding vector (real pgvector)',
  () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let store: PgvectorStore;
    const WS = 'default';
    const USER = `m24-embed-${randomUUID()}`;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.poolPinnedTo('default');
      dropDb = iso.dropDb;
      store = new PgvectorStore(pool);
      await store.initialize();
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories`);
    });

    async function insertExtracted(text: string, seed: number): Promise<string> {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO memories (id, text, hash, embedding, payload, workspace_id, user_id, kind, confirmation_count)
         VALUES ($1,$2,$3,$4::vector,$5::jsonb,$6,$7,'extracted',1)`,
        [id, text, `h-${seed}-${id}`, JSON.stringify(vec(seed)), JSON.stringify({}), WS, USER],
      );
      return id;
    }

    test('each returned candidate carries a number[] embedding of the configured dim', async () => {
      await insertExtracted('fact one', 3);
      await insertExtracted('fact two', 7);

      const candidates = await (store as unknown as ConsolidationStore).recallConsolidationCandidates({
        workspace_id: WS,
        user_id: USER,
      });

      expect(candidates).toHaveLength(2);
      for (const c of candidates) {
        expect(Array.isArray(c.embedding)).toBe(true);
        expect(c.embedding).toHaveLength(DIM);
        expect(c.embedding?.every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);
      }
      // The parsed embedding round-trips the inserted unit vector (1 at seed index).
      const one = candidates.find((c) => c.text === 'fact one');
      expect(one?.embedding?.[3]).toBe(1);
      expect(one?.embedding?.[0]).toBe(0);
    });
  },
);
