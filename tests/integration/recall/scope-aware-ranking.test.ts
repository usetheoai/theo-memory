/**
 * M10 T4.1 — the scope-aware ranking + cross-user isolation HARD GATE, end-to-end through
 * recall() against real ankane/pgvector.
 *
 * A session recall with `RecallOptions.scopes` over the M8 `session ∪ global` union ranks:
 *   fresh-session > stale-session   (recency boost)
 *   durable-global > one-off-global (stability boost, confirmation_count)
 * and user B in the SAME workspace sees ZERO of user A's rows (the full `(workspace_id,
 * user_id)` filter — ROADMAP M10 risk #1 hard gate).
 *
 * A FIXED unit-vector embedder is used (not the shipped StubEmbedder, which returns a zero
 * vector that makes cosine degenerate) so every seeded row matches the query equally and the
 * SCOPE-AWARE REWEIGHT — not vector noise — determines the order. That is the M10 claim.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

import { createLocalMemory, PgvectorStore } from '@usetheo/memory';
import type { Embedder, LLM, LLMResponse, Memory, Message } from '@usetheo/memory';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const DIM = 1536;
const unit = ((): number[] => {
  const v = new Array<number>(DIM).fill(0);
  v[0] = 1;
  return v;
})();

/** Deterministic FIXED unit-vector embedder — every text maps to the same vector, so cosine is
 * uniform across seeds and the scope-aware reweight is the ONLY ranking signal (the M10 claim). */
const fixedEmbedder: Embedder = {
  embed: async () => unit,
  embedBatch: async (texts: readonly string[]) => texts.map(() => unit),
};

const emptyJsonLlm: LLM = {
  async generateResponse(): Promise<unknown> {
    return Promise.resolve([]);
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ role: 'assistant', content: '[]' });
  },
};

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M10 scope-aware ranking + isolation (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M10 T4.1 — scope-aware ranking + cross-user isolation (real pgvector)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let memory: Memory;
    const USER_A = `alice-${randomUUID()}`;
    const USER_B = `bob-${randomUUID()}`;
    const SESSION = `s-${randomUUID()}`;
    const DAY_MS = 24 * 60 * 60 * 1000;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.poolPinnedTo('default');
      dropDb = iso.dropDb;
      memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder,
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
    });

    /** Seed a row (all share the unit embedding) with controlled scope/recency/confirmation. */
    async function seed(
      user: string,
      text: string,
      opts: { sessionId: string | null; ageDays: number; confirmations: number },
    ): Promise<string> {
      const createdAt = new Date(Date.now() - opts.ageDays * DAY_MS).toISOString();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO memories (text, hash, embedding, payload, workspace_id, user_id, session_id, confirmation_count, kind, created_at)
         VALUES ($1,$2,$3::vector,$4::jsonb,'default',$5,$6,$7,'extracted',$8) RETURNING id`,
        [
          text,
          `h-${randomUUID()}`,
          `[${unit.join(',')}]`,
          JSON.stringify({}),
          user,
          opts.sessionId,
          opts.confirmations,
          createdAt,
        ],
      );
      return rows[0]!.id;
    }

    /** A session recall with the M10 scope-aware weights for a given user. */
    const scopeAwareRecall = (user: string): Promise<readonly { text: string }[]> =>
      memory.session(SESSION, user).recall('anything', {
        topK: 20,
        threshold: 0.0,
        scopes: { sessionRecencyWeight: 0.5, globalStabilityWeight: 0.5 },
      });

    test('test_scope_aware_ranking_and_isolation', async () => {
      // User A: fresh + stale SESSION facts, durable + one-off GLOBAL facts.
      await seed(USER_A, 'fresh session fact', { sessionId: SESSION, ageDays: 0, confirmations: 1 });
      await seed(USER_A, 'stale session fact', { sessionId: SESSION, ageDays: 60, confirmations: 1 });
      await seed(USER_A, 'durable global fact', { sessionId: null, ageDays: 30, confirmations: 20 });
      await seed(USER_A, 'one off global fact', { sessionId: null, ageDays: 30, confirmations: 1 });
      // User B (same workspace) has its own private row — must never leak into A's recall or vice-versa.
      await seed(USER_B, 'bob private fact', { sessionId: SESSION, ageDays: 0, confirmations: 5 });

      // A session recall over the M8 union with scope-aware weights.
      const hits = await scopeAwareRecall(USER_A);
      const order = hits.map((h) => h.text);
      // Isolation: none of user B's rows appear in user A's recall.
      expect(order).not.toContain('bob private fact');
      // The four A rows are all present (session ∪ global union).
      expect(order).toContain('fresh session fact');
      expect(order).toContain('durable global fact');

      const idx = (t: string): number => order.indexOf(t);
      // Recency boost: the fresh session fact outranks the stale one.
      expect(idx('fresh session fact')).toBeLessThan(idx('stale session fact'));
      // Stability boost: the high-confirmation global fact outranks the one-off global fact.
      expect(idx('durable global fact')).toBeLessThan(idx('one off global fact'));

      // Cross-user isolation hard gate: user B's scope-aware recall returns ZERO of A's rows.
      const bHits = await scopeAwareRecall(USER_B);
      const bText = bHits.map((h) => h.text);
      expect(bText).not.toContain('fresh session fact');
      expect(bText).not.toContain('durable global fact');
      expect(bText).toEqual(['bob private fact']); // B sees only its own row
    });
  });
}
