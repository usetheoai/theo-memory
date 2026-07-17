/**
 * adapters-openrouter-local-embedder T4.1 — integration tests for the
 * chat-with-memory demo running in `THEOMEM_DEMO_BACKEND=local-openrouter`
 * mode. Exercises the end-to-end Goal-metric path:
 *
 *   - GET /api/health returns 200 (server up)
 *   - GET /api/info returns { adapterSource: 'local-openrouter', embedderDim: 384 }
 *     (verbatim shape per Goal metric)
 *   - 384-dim vector successfully INSERTed into memories.embedding (proves
 *     schema was migrated via runMigrations({ embeddingDim: 384 }) — T0.3
 *     atomic DROP+ALTER+RECREATE landed)
 *   - POST /api/memory/distill with policy=last-write-wins succeeds with
 *     the local-openrouter backend (proves the full singleton wiring +
 *     T1.1 LocalTransformerEmbedder + T2.1 demo backend mode + T2.2 /api/info
 *     all compose)
 *
 * **Pre-conditions to run the live HTTP scenarios:**
 *   1. `npm run compose:up` (pgvector container)
 *   2. From `examples/chat-with-memory/`:
 *      ```
 *      OPENAI_API_KEY=sk-or-v1-...your-openrouter-key
 *      OPENAI_BASE_URL=https://openrouter.ai/api/v1
 *      THEOMEM_DEMO_BACKEND=local-openrouter
 *      THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem
 *      npm run dev
 *      ```
 *   3. First-run model warmup: ~22 MB Xenova/all-MiniLM-L6-v2 download
 *      to `~/.cache/transformers-js/` (one-time).
 *
 * When the dev server is NOT running on :3000 OR `THEOMEM_PG_URI` is unset,
 * the `describe.skipIf` block cleanly skips — no flake. Mirrors the EC-11
 * reachability-probe pattern from the v0.7 SDK cycle.
 *
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

const DEV_SERVER = process.env['DEMO_DEV_SERVER_URL'] ?? 'http://localhost:3000';
const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

async function isReachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

interface InfoResponse {
  readonly backend: 'pgvector' | 'in-memory';
  readonly reflectionThreshold: number;
  readonly adapterSource: 'stub' | 'openai' | 'local-openrouter';
  readonly embedderDim: number;
}

const reachable = await isReachable(DEV_SERVER);

describe.skipIf(!reachable || PG_URI === '')(
  'T4.1: chat-with-memory local-openrouter HTTP surface (Goal metric)',
  () => {
    let pool: pg.Pool;
    // /review F-Mi12: per-suite UUID so parallel runs against a shared dev
    // DB don't see each other's seeded memories or consolidation_history rows.
    const TEST_USER = `t4-1-${randomUUID()}`;

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      // Reset test data only — preserve schema (which the running dev
      // server already migrated to vector(384) per T0.3 + T2.1 wiring).
      await pool.query(`DELETE FROM memories WHERE user_id = $1`, [TEST_USER]);
      await pool.query(
        `DELETE FROM consolidation_history WHERE policy_name IN ('last-write-wins','noop','llm-judged-merge')`,
      );
    });

    it('GET /api/health returns 200 (server reachable in local-openrouter mode)', async () => {
      const res = await fetch(`${DEV_SERVER}/api/health`);
      expect(res.status).toBe(200);
    });

    it('GET /api/info returns adapterSource="local-openrouter" + embedderDim=384 (Goal metric verbatim match)', async () => {
      const res = await fetch(`${DEV_SERVER}/api/info`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as InfoResponse;
      expect(json.adapterSource).toBe('local-openrouter');
      expect(json.embedderDim).toBe(384);
    });

    it('memories.embedding column is vector(384) — proves T0.3 parametric runMigrations applied at demo boot', async () => {
      // atttypmod stores N directly for pgvector v0.5.1 (verified during T0.3
      // implementation; see sepa-iterations/iteration-3-post-green.md for the
      // empirical correction over the SEPA training-data claim of N+4).
      const res = await pool.query<{ atttypmod: number }>(
        `SELECT a.atttypmod
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relname = 'memories'
            AND a.attname = 'embedding'
            AND a.attisdropped = false`,
      );
      expect(res.rows[0]?.atttypmod).toBe(384);
    });

    it('both HNSW indexes exist post-migration (EC-4 absorption: DROP+RECREATE preserved them)', async () => {
      const res = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN ('memories_embedding_hnsw_idx', 'entities_embedding_hnsw_idx')`,
      );
      expect(res.rows[0]?.count).toBe('2');
    });

    it('POST /api/memory/distill policy=last-write-wins returns 200 in local-openrouter mode', async () => {
      // Seed 2 contradictory 384-dim memories so the LWW policy has cluster
      // candidates to merge. Embedding values are arbitrary unit-norm
      // 384-vectors — the integration test exercises the routing, not
      // semantic clustering quality.
      const embedding = Array.from({ length: 384 }, () => 0);
      embedding[0] = 1;
      const embA = '[' + embedding.join(',') + ']';
      // Slightly different vector for the 2nd memory so the cluster has 2
      // distinct rows that LWW can pick between.
      const embB = '[' + (() => {
        const v = Array.from({ length: 384 }, () => 0);
        v[0] = 0.99;
        v[1] = 0.14;
        return v;
      })().join(',') + ']';

      const olderTs = new Date(Date.now() - 60_000).toISOString();
      const newerTs = new Date().toISOString();

      await pool.query(
        `INSERT INTO memories (text, hash, embedding, payload, user_id, t_valid, created_at, updated_at, kind)
         VALUES ('Older fact', 'h-older-t41', $1::vector, '{}'::jsonb, $2, $3, $3, $3, 'extracted')`,
        [embA, TEST_USER, olderTs],
      );
      await pool.query(
        `INSERT INTO memories (text, hash, embedding, payload, user_id, t_valid, created_at, updated_at, kind)
         VALUES ('Newer fact', 'h-newer-t41', $1::vector, '{}'::jsonb, $2, $3, $3, $3, 'extracted')`,
        [embB, TEST_USER, newerTs],
      );

      const res = await fetch(`${DEV_SERVER}/api/memory/distill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: TEST_USER, policy: 'last-write-wins' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { invocationId?: string; reason?: string };
      expect(typeof json.invocationId).toBe('string');

      // /review F-M8: previous coverage stopped at the 200 + invocationId
      // contract. Plan T4.1 § AC line 918 requires "a non-zero
      // consolidation_history row count returned by the new endpoint" —
      // assert the audit table actually grew so a silent no-op regression
      // (e.g., factory mis-wired to a no-op policy) is caught here.
      const audit = await pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c
           FROM consolidation_history
          WHERE policy_name = 'last-write-wins'`,
      );
      expect(audit.rows[0]?.c).toBeGreaterThanOrEqual(1);
    });

    // /review F-M9 — end-to-end /api/chat test. Plan T4.1 TDD #3 declared
    // `test_api_chat_seeds_memory_with_384_dim_embedding`. The existing
    // atttypmod structural check is a proxy (does the column have the right
    // dim) but does NOT exercise the chat → LLM → embed → INSERT path. This
    // test posts a chat message and asserts a new 384-length embedding row
    // landed in memories with the correct scope.
    it('POST /api/chat seeds a memory row with embedding length 384 + scope user_id matching', async () => {
      const res = await fetch(`${DEV_SERVER}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: TEST_USER,
          sessionId: 't4-1-f-m9-session',
          messages: [
            { role: 'user', content: 'My favorite color is teal.' },
          ],
        }),
      });
      expect(res.status).toBe(200);

      // The chat endpoint MAY return immediately (streamed response) — give
      // the async embed+INSERT pipeline a brief window to commit, then poll
      // the table.
      const deadline = Date.now() + 5_000;
      let rowCount = 0;
      let rawEmb = '';
      while (Date.now() < deadline) {
        const probe = await pool.query<{ c: number; raw: string | null }>(
          `SELECT COUNT(*)::int AS c, MAX(embedding::text) AS raw
             FROM memories
            WHERE user_id = $1`,
          [TEST_USER],
        );
        rowCount = probe.rows[0]?.c ?? 0;
        rawEmb = probe.rows[0]?.raw ?? '';
        if (rowCount > 0) break;
        await new Promise<void>((r) => setTimeout(r, 250));
      }
      expect(rowCount).toBeGreaterThanOrEqual(1);
      // pgvector text-cast: `[v1,v2,...,v384]`. Count comma-separated entries
      // by counting commas + 1 — robust to leading/trailing brackets.
      const commaCount = (rawEmb.match(/,/g) ?? []).length;
      expect(commaCount + 1).toBe(384);
    });
  },
);
