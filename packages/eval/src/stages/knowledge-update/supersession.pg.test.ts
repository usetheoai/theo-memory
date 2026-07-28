/**
 * knowledge-update-supersession (#144, M23) — the KEYLESS supersession proof against
 * REAL pgvector. The plan DoD "the older row's `t_invalid` is set" is achievable ONLY
 * on the pgvector runtime (InMemoryVectorStore hard-deletes and lacks
 * recallConsolidationCandidates()/persistConsolidations() — reflect({conflictResolution})
 * throws on it). "Keyless" = the LLM is STUBBED (no API key); the DB is present.
 * DB-gated per the repo convention (`describe.skipIf(THEOMEM_PG_URI unset)`) — SKIPs
 * cleanly in keyless-no-DB CI, GREEN against a live pgvector.
 *
 * Provisions its own isolated 384-dim DB (mirrors stages/e2e-qa/run.ts) so it never
 * touches a shared schema. Real strings + FROZEN real embeddings; the supersession
 * decision is made by a content-aware STUB judge that mirrors a correct LLM merge.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLocalMemory,
  LlmJudgedMergeConflictPolicy,
  PgvectorStore,
  runMigrations,
  type DisposableMemory,
} from '@usetheo/memory';

import { KNOWLEDGE_UPDATE_REAL_FIXTURE } from './golden.js';
import {
  realFixtureEmbedder,
  reflectNoopLlm,
  supersessionJudgeLlm,
} from './supersession-support.js';

const ADMIN_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_m23_knowledge_update';
const DIM = 384;

function isolatedUri(): string {
  const u = new URL(ADMIN_PG_URI);
  u.pathname = `/${ISOLATED_DB}`;
  return u.toString();
}

interface ConsolidationStore {
  recallConsolidationCandidates(filters: {
    readonly workspace_id?: string;
    readonly user_id?: string;
  }): Promise<readonly { memoryId: string; text: string }[]>;
}

describe.skipIf(ADMIN_PG_URI === '')(
  'knowledge-update-supersession (#144, M23) — reflect-time supersession vs real pgvector (keyless)',
  () => {
    const f = KNOWLEDGE_UPDATE_REAL_FIXTURE;
    let pool: pg.Pool;
    let memory: DisposableMemory;
    let store: PgvectorStore;

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
      store = new PgvectorStore(pool, { embeddingDim: DIM });
      memory = (await createLocalMemory({
        vectorStore: store,
        embedder: realFixtureEmbedder(),
        llm: reflectNoopLlm,
        embeddingDim: DIM,
        // reflectionPolicy omitted → factory default `{ kind: 'manual' }`; tests call reflect() explicitly.
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

    async function ingestPair(user: string, a: typeof f.older, b: typeof f.newer): Promise<void> {
      const scope = memory.user(user);
      await scope.remember(a.text, { infer: false, metadata: { created_at: a.createdAt } });
      await scope.remember(b.text, { infer: false, metadata: { created_at: b.createdAt } });
    }

    /** Run reflect with the stubbed LJM judge, then return the scope's rows + t_invalid. */
    async function reflectAndRows(
      user: string,
    ): Promise<readonly { text: string; t_invalid: Date | null }[]> {
      await memory.user(user).reflect({
        conflictResolution: new LlmJudgedMergeConflictPolicy({ llm: supersessionJudgeLlm }),
      });
      const { rows } = await pool.query<{ text: string; t_invalid: Date | null }>(
        `SELECT text, t_invalid FROM memories WHERE user_id = $1`,
        [user],
      );
      return rows;
    }

    // T1 — the whole-scope consolidation cluster for the real pair is reachable by the
    // judge (size 2 ≤ clusterCap 20 → no silent abstain). Records the cluster-size
    // finding empirically; decides D2 (no bound needed at this scale).
    it('test_consolidation_cluster_contains_contradiction_pair', async () => {
      const user = 'm23_cluster';
      await ingestPair(user, f.older, f.newer);
      const candidates = await (store as unknown as ConsolidationStore).recallConsolidationCandidates(
        { workspace_id: 'default', user_id: user },
      );
      expect(candidates).toHaveLength(2); // ≤ clusterCap(20) → the judge is reached, no abstain.
      const texts = candidates.map((c) => c.text);
      expect(texts.some((t) => t.includes('27:12'))).toBe(true);
      expect(texts.some((t) => t.includes('25:50'))).toBe(true);
    });

    // T2 case 2 — reflect-time LLM supersession moves the REAL different-wording case:
    // the stale "27:12" row gets t_invalid set and recall returns only the fresh "25:50".
    it('test_reflect_supersedes_diff_wording_update_returns_fresh', async () => {
      const user = 'm23_reflect';
      await ingestPair(user, f.older, f.newer);

      // (a) the stale row is soft-superseded; the fresh row survives.
      const rows = await reflectAndRows(user);
      const stale = rows.find((r) => r.text.includes('27:12'));
      const fresh = rows.find((r) => r.text.includes('25:50'));
      expect(stale?.t_invalid).not.toBeNull();
      expect(fresh?.t_invalid).toBeNull();

      // (b) recall (t_invalid IS NULL filter) now returns the FRESH value, not the stale one.
      const recalled = await memory.user(user).recall(f.query5k);
      const recalledTexts = recalled.map((m) => m.text);
      expect(recalledTexts.some((t) => t.includes('25:50'))).toBe(true);
      expect(recalledTexts.some((t) => t.includes('27:12'))).toBe(false);

      // (c) auditable — one consolidation_history row keyed to the fresh keeper.
      const { rows: audit } = await pool.query<{ policy_name: string; kept_memory_id: string }>(
        `SELECT policy_name, kept_memory_id FROM consolidation_history`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.policy_name).toBe('llm-judged-merge');
    });

    // T2 case 3 — precision guard: two DIFFERENT attributes of the SAME entity (Google
    // role vs tenure) are NOT a contradiction; the judge abstains and BOTH survive.
    it('test_reflect_does_not_supersede_same_entity_diff_attribute', async () => {
      const user = 'm23_precision';
      await ingestPair(user, f.googleRole, f.googleTenure);

      const rows = await reflectAndRows(user);
      expect(rows).toHaveLength(2);
      // Neither same-entity/different-attribute fact was superseded.
      expect(rows.every((r) => r.t_invalid === null)).toBe(true);
    });
  },
);
