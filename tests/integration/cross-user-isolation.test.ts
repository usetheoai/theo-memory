/**
 * M8 T4.1 — cross-user isolation HARD GATE (real ankane/pgvector:v0.5.1).
 *
 * Proves the `(workspace, user[, session])` boundary M8 hardens: user B reads ZERO
 * of user A's global/session rows in the SAME workspace — even when addressing the
 * SAME session id. This closes the pre-M8 leak (a session scope with no `user_id`
 * filter). The field ships no such negative test — M8 originates it
 * (blueprint Coverage Corner 1). Also asserts the ADR-D6 workspace-admin path:
 * omitting `userId` (Principal.userId null) yields a workspace-scoped view.
 *
 * Gated by THEOMEM_PG_URI (absent → SKIP).
 */
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM, PgvectorStore, createLocalMemory } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M8 T4.1 cross-user isolation (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M8 T4.1 — (workspace, user[, session]) cross-user isolation', () => {
    const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
    const EMB = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);
    const W = 'tn-m8-iso';
    const USER_A = 'user-A';
    const USER_B = 'user-B';
    const SESSION = 's-shared';

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges, history RESTART IDENTITY CASCADE');
    });

    async function seed(opts: { user: string; session?: string; suffix: string }): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO memories (text, hash, embedding, payload, user_id, session_id, workspace_id)
         VALUES ($1, $2, $3::vector, $4, $5, $6, $7) RETURNING id`,
        [
          `fact ${opts.suffix}`,
          `h-m8-${opts.suffix}-${Math.random().toString(36).slice(2)}`,
          JSON.stringify(EMB),
          JSON.stringify({
            text: `fact ${opts.suffix}`,
            user_id: opts.user,
            session_id: opts.session ?? null,
            workspace_id: W,
          }),
          opts.user,
          opts.session ?? null,
          W,
        ],
      );
      return rows[0]!.id;
    }

    const embedder: Embedder = {
      embed: vi.fn(async () => new Array<number>(MAX_EMBEDDING_DIM).fill(0)),
      embedBatch: vi.fn(async (t: readonly string[]) => t.map(() => new Array<number>(MAX_EMBEDDING_DIM).fill(0))),
    };
    const llm: LLM = {
      generateResponse: vi.fn(async () => ({ memory: [] })),
      generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
    };

    async function boundMemory() {
      const m = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm });
      return m.withWorkspace(W);
    }

    test('test_user_b_reads_zero_of_user_a_session_rows — same session id, different user', async () => {
      const aSessionId = await seed({ user: USER_A, session: SESSION, suffix: 'A-session' });
      const m = await boundMemory();

      // user B addresses the SAME session id → gets NONE of user A's rows.
      const bView = await m.session(SESSION, USER_B).getAll();
      expect(bView.find((x) => x.id === aSessionId)).toBeUndefined();
      expect(bView.length).toBe(0);

      // user A reads its own session row — isolation is PER-USER, not a total block.
      const aView = await m.session(SESSION, USER_A).getAll();
      expect(aView.find((x) => x.id === aSessionId)).toBeDefined();
    });

    test('test_user_b_reads_zero_of_user_a_global_rows', async () => {
      const aGlobalId = await seed({ user: USER_A, suffix: 'A-global' });
      const m = await boundMemory();

      const bGlobal = await m.user(USER_B).getAll();
      expect(bGlobal.find((x) => x.id === aGlobalId)).toBeUndefined();

      const aGlobal = await m.user(USER_A).getAll();
      expect(aGlobal.find((x) => x.id === aGlobalId)).toBeDefined();
    });

    test('test_workspace_admin_null_user_sees_workspace_session — ADR D6 workspace-scoped path', async () => {
      // A workspace-admin credential (Principal.userId null → userId omitted) gets a
      // WORKSPACE-scoped session view: the session filter carries no user_id, so it
      // finds the row regardless of its owning user (legitimate admin access).
      const rowId = await seed({ user: USER_A, session: SESSION, suffix: 'admin' });
      const m = await boundMemory();

      const adminView = await m.session(SESSION).getAll();
      expect(adminView.find((x) => x.id === rowId)).toBeDefined();
    });
  });
}
