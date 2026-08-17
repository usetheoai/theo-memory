/**
 * M9 T2.1 — `persistConsolidations({ promote: true })` promotes the durable representative
 * to GLOBAL (session_id→NULL, agent_id→NULL) atomically with the duplicate soft-delete +
 * consolidation_history audit, against real ankane/pgvector. The promotion NEVER touches
 * workspace_id/user_id (the M9 isolation hard gate) and is idempotent on re-run.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

import { PgvectorStore, withWorkspaceScope } from '@usetheo/memory';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const DIM = 1536;
function vec(seed: number): number[] {
  return new Array<number>(DIM).fill(0).map((_, i) => (i === 0 ? seed : 0));
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M9 promoteToGlobal (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M9 persistConsolidations promote → global (T2.1, real pgvector)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let store: PgvectorStore;
    const WS = 'tn-A';
    const USER = `alice-${randomUUID()}`;
    /**
     * O código sob teste resolve o workspace da escrita pelo escopo em vigor
     * (`workspaceIdForWrite`), não pelo pool. Sem escopo ele cai no modo
     * single-tenant e grava em `default` — que a policy então recusa, porque a
     * conexão está no workspace deste arquivo. Rodar dentro do escopo é a forma
     * multi-inquilino de produção, e é a única em que as duas camadas concordam.
     */
    const inWs = <T>(fn: () => Promise<T>): Promise<T> => withWorkspaceScope(WS, fn);
    const SESSION = `s-${randomUUID()}`;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.poolPinnedTo('tn-A');
      dropDb = iso.dropDb;
      store = new PgvectorStore(pool);
      await store.initialize();
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories`);
      await pool.query(`DELETE FROM consolidation_history`);
    });

    /** Insert a session-scoped row directly, return its id. */
    async function insertSessionRow(text: string, seed: number, confirmations = 1): Promise<string> {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO memories (id, text, hash, embedding, payload, workspace_id, user_id, session_id, confirmation_count)
         VALUES ($1,$2,$3,$4::vector,$5::jsonb,$6,$7,$8,$9)`,
        [id, text, `h-${seed}-${id}`, JSON.stringify(vec(seed)), JSON.stringify({}), WS, USER, SESSION, confirmations],
      );
      return id;
    }

    test('promotes the kept row to global, keeps workspace+user, soft-deletes rejects, audits', async () => {
      const kept = await insertSessionRow('durable fact', 1, 3);
      const dupA = await insertSessionRow('durable fact dup a', 1, 1);
      const dupB = await insertSessionRow('durable fact dup b', 1, 1);

      await inWs(() =>
        store.persistConsolidations(
        [
          {
            keptMemoryId: kept,
            rejectedMemoryIds: [dupA, dupB],
            reason: 'promoted: confirmation_count 3 >= 3',
            policyName: 'session-to-global',
            originalEpisodeIds: [kept, dupA, dupB],
          },
        ],
        { promote: true },
      ));

      // Kept row is now GLOBAL, same workspace+user, still valid.
      const keptRow = await pool.query(
        `SELECT session_id, agent_id, workspace_id, user_id, t_invalid FROM memories WHERE id = $1`,
        [kept],
      );
      expect(keptRow.rows[0].session_id).toBeNull();
      expect(keptRow.rows[0].agent_id).toBeNull();
      expect(keptRow.rows[0].workspace_id).toBe(WS); // isolation anchor UNCHANGED
      expect(keptRow.rows[0].user_id).toBe(USER); // isolation anchor UNCHANGED
      expect(keptRow.rows[0].t_invalid).toBeNull(); // kept, not soft-deleted

      // Duplicates are soft-deleted.
      const dups = await pool.query(
        `SELECT id, t_invalid FROM memories WHERE id = ANY($1::uuid[])`,
        [[dupA, dupB]],
      );
      expect(dups.rows.every((r) => r.t_invalid !== null)).toBe(true);

      // One audit row with the lineage.
      const audit = await pool.query(
        `SELECT kept_memory_id, original_episode_ids, policy_name FROM consolidation_history WHERE kept_memory_id = $1`,
        [kept],
      );
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].policy_name).toBe('session-to-global');
    });

    test('is idempotent — a second promote of the same kept row updates 0 rows, no error', async () => {
      const kept = await insertSessionRow('durable fact', 2, 3);
      const result = promoteResult(kept);
      await inWs(() => store.persistConsolidations([result], { promote: true }));
      // Second run must not throw and must leave the row global (returns 0 promoted).
      await expect(inWs(() => store.persistConsolidations([result], { promote: true }))).resolves.toBe(0);
      const row = await pool.query(`SELECT session_id FROM memories WHERE id = $1`, [kept]);
      expect(row.rows[0].session_id).toBeNull();
    });

    /** A single-row promotion result (no rejects) for `keptId`. */
    function promoteResult(keptId: string, rejectedMemoryIds: string[] = []): {
      keptMemoryId: string;
      rejectedMemoryIds: string[];
      reason: string;
      policyName: string;
      originalEpisodeIds: string[];
    } {
      return {
        keptMemoryId: keptId,
        rejectedMemoryIds,
        reason: 'promoted',
        policyName: 'session-to-global',
        originalEpisodeIds: [keptId],
      };
    }

    /** Count of consolidation_history audit rows for a kept id. */
    async function auditCount(keptId: string): Promise<number> {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM consolidation_history WHERE kept_memory_id = $1`,
        [keptId],
      );
      return rows[0]!.n;
    }

    test('F-arch-3: a re-run promotes 0 rows and writes NO duplicate audit row (fidelity)', async () => {
      const kept = await insertSessionRow('durable', 8, 3);
      const result = promoteResult(kept);
      const first = await inWs(() => store.persistConsolidations([result], { promote: true }));
      const second = await inWs(() => store.persistConsolidations([result], { promote: true }));
      expect(first).toBe(1); // one row actually promoted
      expect(second).toBe(0); // re-run: nothing left to promote (idempotent)
      expect(await auditCount(kept)).toBe(1); // exactly ONE audit row, not two (no over-report)
    });

    test('F-tests-1: a failing audit/soft-delete rolls the promotion back (EC-8 atomicity)', async () => {
      const kept = await insertSessionRow('durable', 9, 3);
      // An invalid-uuid rejected id makes the `ANY($1::uuid[])` soft-delete cast throw mid-txn.
      const bad = promoteResult(kept, ['not-a-uuid']);
      await expect(inWs(() => store.persistConsolidations([bad], { promote: true }))).rejects.toThrow();
      // The whole txn rolled back: the kept row is STILL session-scoped, no audit row.
      const row = await pool.query(`SELECT session_id FROM memories WHERE id = $1`, [kept]);
      expect(row.rows[0].session_id).toBe(SESSION);
      expect(await auditCount(kept)).toBe(0);
    });

    test('F-tests-3: two CONCURRENT promotions of the same row flip it exactly once', async () => {
      const kept = await insertSessionRow('durable', 10, 3);
      const result = promoteResult(kept);
      // Fire both in parallel; the `session_id IS NOT NULL` guard makes exactly one flip.
      const [a, b] = await Promise.all([
        inWs(() => store.persistConsolidations([result], { promote: true })),
        inWs(() => store.persistConsolidations([result], { promote: true })),
      ]);
      expect(a + b).toBe(1); // exactly one promotion effected across the two concurrent txns
      const row = await pool.query(`SELECT session_id FROM memories WHERE id = $1`, [kept]);
      expect(row.rows[0].session_id).toBeNull();
    });

    test('without promote, the kept row stays session-scoped (v0.7 distillation behavior preserved)', async () => {
      const kept = await insertSessionRow('fact', 3, 3);
      await inWs(() =>
        store.persistConsolidations(
          [
            {
              keptMemoryId: kept,
              rejectedMemoryIds: [],
              reason: 'r',
              policyName: 'noop',
              originalEpisodeIds: [kept],
            },
          ],
          // no promote option
        ),
      );
      const row = await pool.query(`SELECT session_id FROM memories WHERE id = $1`, [kept]);
      expect(row.rows[0].session_id).toBe(SESSION); // unchanged
    });
  });
}
