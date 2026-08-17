/**
 * M9 T4.1 + T4.2 — the isolation + promotion hard gate, end-to-end through reflect()
 * against real ankane/pgvector. A reflect on a SESSION scope with the
 * SessionToGlobalConsolidationPolicy promotes the durable fact (confirmation_count ≥ 3)
 * to GLOBAL (session_id→NULL) with a consolidation_history audit row; a one-off session
 * fact is NOT promoted (it stays session-scoped and decays via eviction); and another
 * user in the same workspace sees NONE of it (the (workspace, user) isolation hard gate).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

import {
  createLocalMemory,
  PgvectorStore,
  StubEmbedder,
  SessionToGlobalConsolidationPolicy,
} from '@usetheo/memory';
import type { LLM, LLMResponse, Memory, Message } from '@usetheo/memory';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const emptyJsonLlm: LLM = {
  async generateResponse(): Promise<unknown> {
    return Promise.resolve([]);
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ role: 'assistant', content: '[]' });
  },
};

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M9 session→global e2e (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M9 session→global promotion + isolation (T4.1/T4.2, real pgvector)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let memory: Memory;
    const USER_A = `alice-${randomUUID()}`;
    const USER_B = `bob-${randomUUID()}`;
    const SESSION = `s-${randomUUID()}`;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.poolPinnedTo('default');
      dropDb = iso.dropDb;
      memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: emptyJsonLlm,
        reflectionPolicy: { kind: 'manual' },
      });
    }, 30_000);

    afterAll(async () => {
      await memory.dispose();
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories`);
      await pool.query(`DELETE FROM consolidation_history`);
    });

    /** Seed a session-scoped extracted row for a user with a given confirmation_count. */
    async function seed(user: string, text: string, seed: number, confirmations: number): Promise<string> {
      const embedding = new Array<number>(1536).fill(0);
      embedding[0] = seed;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO memories (text, hash, embedding, payload, workspace_id, user_id, session_id, confirmation_count, kind)
         VALUES ($1,$2,$3::vector,$4::jsonb,'default',$5,$6,$7,'extracted') RETURNING id`,
        [text, `h-${seed}-${randomUUID()}`, `[${embedding.join(',')}]`, JSON.stringify({}), user, SESSION, confirmations],
      );
      return rows[0]!.id;
    }

    test('test_durable_session_fact_promotes_to_global_isolated', async () => {
      const durable = await seed(USER_A, 'alice durable fact', 1, 3); // confirmation_count 3
      const oneOff = await seed(USER_A, 'alice one-off fact', 2, 1); // count 1 → not promoted
      await seed(USER_B, 'bob private fact', 3, 5); // user B's own durable fact (different user)

      // Reflect on user A's SESSION scope with the M9 policy.
      await memory
        .session(SESSION, USER_A)
        .reflect({ conflictResolution: new SessionToGlobalConsolidationPolicy(3) });

      // (1) the durable fact is now GLOBAL (session_id NULL), same workspace+user.
      const dur = await pool.query(
        `SELECT session_id, workspace_id, user_id, t_invalid FROM memories WHERE id = $1`,
        [durable],
      );
      expect(dur.rows[0].session_id).toBeNull();
      expect(dur.rows[0].workspace_id).toBe('default');
      expect(dur.rows[0].user_id).toBe(USER_A);
      expect(dur.rows[0].t_invalid).toBeNull();

      // (2) the one-off stays session-scoped + valid (NOT promoted, NOT soft-deleted).
      const off = await pool.query(`SELECT session_id, t_invalid FROM memories WHERE id = $1`, [oneOff]);
      expect(off.rows[0].session_id).toBe(SESSION);
      expect(off.rows[0].t_invalid).toBeNull();

      // (3) one consolidation_history audit row for the promotion.
      const audit = await pool.query(
        `SELECT policy_name FROM consolidation_history WHERE kept_memory_id = $1`,
        [durable],
      );
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].policy_name).toBe('session-to-global');

      // (4) ISOLATION: user B's global recall sees NONE of user A's promoted/session rows.
      const bGlobal = await memory.user(USER_B).recall('alice durable fact', { topK: 20 });
      expect(bGlobal.every((h) => h.text !== 'alice durable fact')).toBe(true);
      // user B still has its own row (its reflect did not run, its data is intact).
      const bRows = await pool.query(`SELECT count(*)::int AS n FROM memories WHERE user_id = $1`, [USER_B]);
      expect(bRows.rows[0].n).toBe(1);
    });

    test('test_lone_durable_fact_promotes_even_as_the_only_session_memory', async () => {
      // The literal DoD scenario: 3 exact mentions of ONE fact dedup (composite UPSERT) to
      // ONE row with confirmation_count=3, and it is the ONLY memory in the session. It MUST
      // still promote — M9 promotes individual durable memories; it is NOT gated on a ≥2
      // multi-memory cluster (that is the v0.7 distillation assumption, not M9's).
      const lone = await seed(USER_A, 'the only durable fact', 7, 3);
      await memory
        .session(SESSION, USER_A)
        .reflect({ conflictResolution: new SessionToGlobalConsolidationPolicy(3) });
      const row = await pool.query(`SELECT session_id FROM memories WHERE id = $1`, [lone]);
      expect(row.rows[0].session_id).toBeNull(); // promoted to global despite being alone
    });

    test('test_non_promoted_one_off_stays_session_scoped_and_untouched', async () => {
      // F-tests-2/F-xval-3 (review — honest scope): this proves NON-INTERFERENCE — a below-
      // threshold fact is neither promoted nor soft-deleted by M9. It does NOT re-prove the
      // shipped triadic eviction (no capacity pressure is applied here); decay is the
      // EvictionPolicy's own tested job, left intact by M9.
      const oneOff = await seed(USER_A, 'transient note', 4, 1);
      await seed(USER_A, 'another transient', 5, 1); // 2 rows so consolidation phase runs
      await memory
        .session(SESSION, USER_A)
        .reflect({ conflictResolution: new SessionToGlobalConsolidationPolicy(3) });
      const row = await pool.query(`SELECT session_id, t_invalid FROM memories WHERE id = $1`, [oneOff]);
      expect(row.rows[0].session_id).toBe(SESSION); // NOT promoted (below threshold)
      expect(row.rows[0].t_invalid).toBeNull(); // NOT soft-deleted by M9 (left to eviction)
    });

    test('test_three_real_remember_mentions_dedup_to_one_row_then_promote', async () => {
      // F-tests-6 (review) — the LITERAL DoD metric: 3 exact mentions via remember() dedup
      // (composite UPSERT, Princípio 1) to ONE row with confirmation_count=3, which then
      // promotes. Exercises the mention→dedup→promote chain, not a pre-seeded count-3 row.
      const fact = 'alice always uses tabs not spaces';
      for (let i = 0; i < 3; i += 1) {
        await memory.session(SESSION, USER_A).remember(fact, { infer: false });
      }
      // The 3 mentions dedup to one row at confirmation_count 3.
      const before = await pool.query<{ id: string; confirmation_count: number }>(
        `SELECT id, confirmation_count FROM memories WHERE user_id = $1 AND session_id = $2`,
        [USER_A, SESSION],
      );
      expect(before.rowCount).toBe(1);
      expect(before.rows[0].confirmation_count).toBe(3);
      // Needs ≥1 source memory (the M9 guard) — the lone durable row must still promote.
      await memory
        .session(SESSION, USER_A)
        .reflect({ conflictResolution: new SessionToGlobalConsolidationPolicy(3) });
      const after = await pool.query(`SELECT session_id FROM memories WHERE id = $1`, [before.rows[0].id]);
      expect(after.rows[0].session_id).toBeNull(); // promoted to global
    });
  });
}
