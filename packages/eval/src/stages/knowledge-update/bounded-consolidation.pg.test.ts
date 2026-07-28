/**
 * M24 T4.1 (#146) — deterministic KEYLESS proof that BOUNDED consolidation
 * supersedes the real knowledge-update case AT SCALE (> clusterCap), where the
 * pre-M24 whole-scope path ABSTAINS.
 *
 * M23 proved (real bench) that whole-scope reflect abstains once a conversation
 * exceeds clusterCap (20): `recallConsolidationCandidates` returned the entire
 * live scope as ONE cluster and `LlmJudgedMergeConflictPolicy` abstains on a
 * cluster > 20 (no LLM call), so the `6a1eabeb` contradiction pair never reached
 * the judge. This test ingests the TWO real PB sentences PLUS 25 real-string
 * fillers (27 rows > cap 20) and reflects with the SAME stubbed judge M23 used.
 * Bounded clustering must place the PB pair in one sub-cluster (<= cap) so the
 * judge supersedes the stale `27:12` — proving the mechanism moves the real case
 * at real scale WITHOUT an API key.
 *
 * Determinism note: memoryIds are DB UUIDs (random order), so the supersession
 * scenario is a TWO-group scope (25 mutually-near fillers + the PB pair) — the
 * PB pair are each other's clear nearest and no third group can split them for
 * ANY anchor order (see clusterByProximity M24 T2.1). The precision guard (a
 * same-entity/different-attribute pair the judge must NOT supersede) runs in its
 * own scope, mirroring the M23 supersession.pg.test structure, so its assertion
 * never depends on the clustering order.
 *
 * "Keyless" = the LLM is STUBBED (no API key); the DB is a real, isolated
 * ankane/pgvector:v0.5.1. DB-gated via `describe.skipIf(THEOMEM_PG_URI unset)`.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLocalMemory,
  LlmJudgedMergeConflictPolicy,
  PgvectorStore,
  runMigrations,
  type DisposableMemory,
  type Embedder,
} from '@usetheo/memory';

import { KNOWLEDGE_UPDATE_REAL_FIXTURE, REAL_EMBEDDING_BY_TEXT } from './golden.js';
import { reflectNoopLlm, supersessionJudgeLlm } from './supersession-support.js';

const ADMIN_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_m24_bounded_consolidation';
const DIM = 384;

/** 25 real-string fillers on varied topics — none mention the PB fact. */
const FILLERS: readonly string[] = [
  'I enjoy hiking in the mountains on weekends',
  'My favorite programming language is TypeScript',
  'I drink coffee every morning before work',
  'The capital of France is Paris',
  'I have two cats named Luna and Milo',
  'My apartment is on the third floor',
  'I studied computer science at university',
  'I prefer tea over soda in the afternoon',
  'My car is a blue hatchback',
  'I read science fiction novels before bed',
  'I play the guitar as a hobby',
  'The nearest grocery store is two blocks away',
  'I usually take the train to the office',
  'My favorite season is autumn',
  'I learned to swim when I was seven',
  'I keep a small herb garden on my balcony',
  'My phone is running low on storage',
  'I watched a documentary about the ocean last night',
  'I like to cook pasta on Sundays',
  'My gym membership renews every January',
  'I once travelled to Japan for two weeks',
  'I write in a journal most evenings',
  'My favorite board game is chess',
  'I adopted my dog from a local shelter',
  'I collect vintage postcards from flea markets',
];

/** Distinct deterministic filler vectors: a shared base (mutually near) + a
 *  per-text perturbation, all far from the PB pair. Fixture texts map to their
 *  FROZEN real embeddings. */
function boundedEmbedder(): Embedder {
  const hash = (t: string): number => {
    let h = 0;
    for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  };
  const filler = (t: string): number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[100] = 1; // shared base → fillers mutually near (cos ~1)
    v[101 + (hash(t) % 200)] = 0.05; // distinct signal → far from the PB pair
    return v;
  };
  const one = (t: string): readonly number[] => REAL_EMBEDDING_BY_TEXT.get(t) ?? filler(t);
  return {
    embed: (t) => Promise.resolve(one(t)),
    embedBatch: (ts) => Promise.resolve(ts.map(one)),
  };
}

function isolatedUri(): string {
  const u = new URL(ADMIN_PG_URI);
  u.pathname = `/${ISOLATED_DB}`;
  return u.toString();
}

describe.skipIf(ADMIN_PG_URI === '')(
  'M24 T4.1 — bounded consolidation supersedes AT SCALE (> clusterCap) vs real pgvector (keyless)',
  () => {
    const f = KNOWLEDGE_UPDATE_REAL_FIXTURE;
    let pool: pg.Pool;
    let memory: DisposableMemory;

    beforeAll(async () => {
      const admin = new pg.Pool({ connectionString: ADMIN_PG_URI });
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB}`);
        await admin.query(`CREATE DATABASE ${ISOLATED_DB}`);
      } finally {
        await admin.end();
      }
      pool = new pg.Pool({ connectionString: isolatedUri() });
      await runMigrations(pool, { embeddingDim: DIM });
      memory = (await createLocalMemory({
        vectorStore: new PgvectorStore(pool, { embeddingDim: DIM }),
        embedder: boundedEmbedder(),
        llm: reflectNoopLlm,
        embeddingDim: DIM,
      }));
    }, 60_000);

    afterAll(async () => {
      await memory.dispose();
      await pool.end();
      const admin = new pg.Pool({ connectionString: ADMIN_PG_URI });
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB}`);
      } finally {
        await admin.end();
      }
    });

    async function reflectWithStubJudge(user: string): Promise<void> {
      await memory.user(user).reflect({
        conflictResolution: new LlmJudgedMergeConflictPolicy({ llm: supersessionJudgeLlm }),
      });
    }

    it('test_bounded_consolidation_supersedes_at_scale_over_cluster_cap', async () => {
      const user = 'm24_scale';
      const scope = memory.user(user);
      // Ingest the 2 real PB sentences + 25 fillers → 27 rows > clusterCap(20).
      await scope.remember(f.older.text, { infer: false, metadata: { created_at: f.older.createdAt } });
      await scope.remember(f.newer.text, { infer: false, metadata: { created_at: f.newer.createdAt } });
      for (const text of FILLERS) {
        await scope.remember(text, { infer: false });
      }

      // Control: the scope really is above the cluster cap (whole-scope would abstain).
      const { rows: countRows } = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM memories WHERE user_id = $1 AND kind = 'extracted' AND t_invalid IS NULL`,
        [user],
      );
      expect(Number(countRows[0]?.n)).toBe(27);
      expect(Number(countRows[0]?.n)).toBeGreaterThan(20);

      await reflectWithStubJudge(user);

      // The stale 27:12 row is soft-superseded; the fresh 25:50 row survives.
      const { rows } = await pool.query<{ text: string; t_invalid: Date | null }>(
        `SELECT text, t_invalid FROM memories WHERE user_id = $1`,
        [user],
      );
      const stale = rows.find((r) => r.text.includes('27:12'));
      const fresh = rows.find((r) => r.text.includes('25:50'));
      expect(stale?.t_invalid).not.toBeNull(); // AT SCALE, bounded path did NOT abstain
      expect(fresh?.t_invalid).toBeNull();

      // recall (t_invalid IS NULL) now returns the FRESH value, not the stale one.
      const recalled = (await scope.recall(f.query5k)).map((m) => m.text);
      expect(recalled.some((t) => t.includes('25:50'))).toBe(true);
      expect(recalled.some((t) => t.includes('27:12'))).toBe(false);

      // Auditable — one consolidation_history row keyed to the fresh keeper.
      const { rows: audit } = await pool.query<{ policy_name: string }>(
        `SELECT policy_name FROM consolidation_history WHERE policy_name = 'llm-judged-merge'`,
      );
      expect(audit.length).toBeGreaterThanOrEqual(1);
    });

    it('test_precision_guard_same_entity_different_attribute_survives', async () => {
      const user = 'm24_precision';
      const scope = memory.user(user);
      await scope.remember(f.googleRole.text, { infer: false, metadata: { created_at: f.googleRole.createdAt } });
      await scope.remember(f.googleTenure.text, { infer: false, metadata: { created_at: f.googleTenure.createdAt } });

      await reflectWithStubJudge(user);

      // Same entity, different attribute → the judge abstains → BOTH survive.
      const { rows } = await pool.query<{ t_invalid: Date | null }>(
        `SELECT t_invalid FROM memories WHERE user_id = $1`,
        [user],
      );
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.t_invalid === null)).toBe(true);
    });
  },
);
