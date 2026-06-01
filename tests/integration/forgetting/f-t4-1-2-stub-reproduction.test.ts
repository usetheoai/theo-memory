/**
 * F-T4.1-2 stub-reproduction integration test.
 *
 * Landing site declared in adapters-stub-embedder-llm-cycle-1-fixes T0.1
 * ADR-DEFER-WIRING-B markers (commit c729d52, merged in PR #25). Consumes
 * the deterministic stubs shipped at @usetheo/memory/embedders/stub +
 * @usetheo/memory/llms/stub to reproduce the F-T4.1-2 eviction race
 * deterministically WITHOUT external API dep.
 *
 * The bug (empirical from hotfix b2909ff body):
 *   With createLocalMemory({ eviction: { trigger: 'capacity',
 *   maxMemoriesPerScope: 10 } }) active + parallel
 *   Promise.all([userScoped.remember(...), sessionScoped.remember(...)])
 *   from rememberTurn: DB state shows user_id IS NULL on all rows;
 *   user-scope rows LOST entirely.
 *
 * EC-1 absorption: race is heisenbug; loop 20x to maximize reproduction.
 * EC-2 absorption: TRUNCATE per trial for fresh state.
 * EC-3 absorption: all assertions guard WHERE t_invalid IS NULL.
 * EC-4 absorption: optional dumpPgLocks helper for post-mortem.
 *
 * @see .claude/knowledge-base/plans/f-t4-1-2-eviction-race-debug-plan.md § T1.1
 * @see .claude/knowledge-base/plans/completed/adapters-stub-embedder-llm-cycle-1-fixes-plan.md § T0.1
 * @see commit b2909ff (hotfix being lifted)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
  createLocalMemory,
  PgvectorStore,
  runMigrations,
} from '../../../src/local/index.js';
import { DeterministicStubEmbedder } from '../../../src/embedders/stub.js';
import { DeterministicStubLLM } from '../../../src/llms/stub.js';

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TRIALS = 20;
const WRITES_PER_TRIAL = 5;
const MAX_MEMORIES_PER_SCOPE = 10;

async function truncateTestTables(pool: pg.Pool): Promise<void> {
  await pool.query(
    'TRUNCATE memories, entities, history RESTART IDENTITY CASCADE',
  );
}

/**
 * EC-4 absorption: diagnostic helper for post-mortem on intermittent
 * race-condition reproduction. Returns a snapshot of held pg_locks
 * relevant to advisory-lock keys used by the eviction triggers.
 */
async function dumpPgLocks(pool: pg.Pool): Promise<unknown[]> {
  const result = await pool.query(
    `SELECT locktype, mode, granted, pid, classid, objid
     FROM pg_locks
     WHERE locktype IN ('advisory', 'transactionid')
     ORDER BY pid, granted`,
  );
  return result.rows;
}

/**
 * Slow-embedder wrapper that simulates real-LLM I/O latency (~30-80ms per
 * embed call). The hotfix b2909ff was observed under OpenAI embedder timing
 * (real network calls). Pure-deterministic stubs run sub-millisecond — the
 * race window may be too narrow to observe. This wrapper adds artificial
 * `await setTimeout(_, randomMs)` per embed to simulate the OpenAI cadence.
 */
class SlowDeterministicEmbedder extends DeterministicStubEmbedder {
  constructor(private readonly minMs: number = 20, private readonly maxMs: number = 80) {
    super();
  }
  override async embed(text: string): Promise<readonly number[]> {
    const ms = this.minMs + Math.random() * (this.maxMs - this.minMs);
    await new Promise((r) => setTimeout(r, ms));
    return super.embed(text);
  }
  override async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const out: (readonly number[])[] = [];
    for (const text of texts) out.push(await this.embed(text));
    return out;
  }
}

describe('F-T4.1-2 eviction race — stub reproduction (20-iter heisenbug loop)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    if (PG_URI === '') {
      throw new Error('THEOMEM_PG_URI env var required for this test');
    }
    pool = new pg.Pool({ connectionString: PG_URI });
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateTestTables(pool);
  });

  it('T1.3 — SLOW-embedder simulating OpenAI latency does NOT lose user-scope rows (5 trials × 4 conversations × ~30-80ms/embed)', async () => {
    // T1.3 per ADR D2 deeper-fallback: T1.1 + T1.2 with pure-fast stubs both
    // PASSed. The hotfix b2909ff was observed under OpenAI embedder timing
    // (real network calls ~30-80ms per embed). This test wraps the stub
    // with artificial setTimeout to widen the race window to match the
    // observed bug environment.
    const T1_3_TRIALS = 5;
    const CONVERSATIONS = 4;
    const failingTrials: Array<{ trial: number; details: unknown[] }> = [];

    for (let trial = 0; trial < T1_3_TRIALS; trial++) {
      await truncateTestTables(pool);
      const store = new PgvectorStore(pool);
      const memory = await createLocalMemory({
        vectorStore: store,
        embedder: new SlowDeterministicEmbedder(20, 80),
        llm: new DeterministicStubLLM(),
        eviction: {
          trigger: 'capacity',
          maxMemoriesPerScope: MAX_MEMORIES_PER_SCOPE,
        },
      });
      try {
        const conversationPromises: Promise<void>[] = [];
        for (let conv = 0; conv < CONVERSATIONS; conv++) {
          const userId = `u-slow-${trial}-c${conv}`;
          const sessionId = `s-slow-${trial}-c${conv}`;
          conversationPromises.push(
            (async () => {
              const userScoped = memory.user(userId);
              const sessionScoped = memory.session(sessionId);
              for (let i = 0; i < WRITES_PER_TRIAL; i++) {
                await Promise.all([
                  userScoped.remember(`u-slow-content-${trial}-${conv}-${i}`),
                  sessionScoped.remember(`s-slow-content-${trial}-${conv}-${i}`),
                ]);
              }
            })(),
          );
        }
        await Promise.all(conversationPromises);
        const details: Array<{ conv: number; userActive: number; sessActive: number }> = [];
        for (let conv = 0; conv < CONVERSATIONS; conv++) {
          const ua = await pool.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM memories
             WHERE t_invalid IS NULL AND user_id = $1 AND session_id IS NULL`,
            [`u-slow-${trial}-c${conv}`],
          );
          const sa = await pool.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM memories
             WHERE t_invalid IS NULL AND user_id IS NULL AND session_id = $1`,
            [`s-slow-${trial}-c${conv}`],
          );
          details.push({
            conv,
            userActive: ua.rows[0]?.n ?? -1,
            sessActive: sa.rows[0]?.n ?? -1,
          });
        }
        const orphans = await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM memories
           WHERE t_invalid IS NULL AND user_id IS NULL AND session_id IS NULL`,
        );
        const allOK = details.every(
          (d) => d.userActive === WRITES_PER_TRIAL && d.sessActive === WRITES_PER_TRIAL,
        );
        if (!allOK || (orphans.rows[0]?.n ?? -1) !== 0) {
          failingTrials.push({
            trial,
            details: [...details, { orphans: orphans.rows[0]?.n ?? -1 }],
          });
        }
      } finally {
        await memory.dispose();
      }
    }

    expect(
      failingTrials,
      `F-T4.1-2 reproduced in ${failingTrials.length}/${T1_3_TRIALS} SLOW-embedder trials. ` +
        `Sample: ${JSON.stringify(failingTrials.slice(0, 2), null, 2)}`,
    ).toEqual([]);
  }, 240_000);

  it('T1.2 — overlapping multi-conversation Promise.all does NOT lose user-scope rows (10 trials × 4 parallel conversations)', async () => {
    // T1.2 per ADR D2 fallback: T1.1 (sequential Promise.all in one scope)
    // PASSed 60/60 trials — bug does not reproduce in pure-SDK with that
    // shape. This second test mirrors the demo's MULTI-CONVERSATION pattern:
    // multiple rememberTurn-like calls overlap across DIFFERENT user/session
    // pairs, all sharing the SAME memory singleton (matches Next.js demo
    // where multiple HTTP requests hit the globalThis singleton).
    const T1_2_TRIALS = 10;
    const CONVERSATIONS = 4;
    const failingTrials: Array<{
      trial: number;
      details: unknown[];
    }> = [];

    for (let trial = 0; trial < T1_2_TRIALS; trial++) {
      await truncateTestTables(pool);

      const store = new PgvectorStore(pool);
      const memory = await createLocalMemory({
        vectorStore: store,
        embedder: new DeterministicStubEmbedder(),
        llm: new DeterministicStubLLM(),
        eviction: {
          trigger: 'capacity',
          maxMemoriesPerScope: MAX_MEMORIES_PER_SCOPE,
        },
      });

      try {
        // Build 4 parallel "conversations" each calling rememberTurn-like
        // pattern (Promise.all on user + session scope). All conversations
        // share THE SAME memory singleton — like the demo's globalThis
        // singleton servicing multiple HTTP requests.
        const conversationPromises: Promise<void>[] = [];
        for (let conv = 0; conv < CONVERSATIONS; conv++) {
          const userId = `u-${trial}-c${conv}`;
          const sessionId = `s-${trial}-c${conv}`;
          conversationPromises.push(
            (async () => {
              const userScoped = memory.user(userId);
              const sessionScoped = memory.session(sessionId);
              for (let i = 0; i < WRITES_PER_TRIAL; i++) {
                await Promise.all([
                  userScoped.remember(`u-content-${trial}-${conv}-${i}`),
                  sessionScoped.remember(`s-content-${trial}-${conv}-${i}`),
                ]);
              }
            })(),
          );
        }
        await Promise.all(conversationPromises);

        // EC-3 guards: per-conversation row counts under t_invalid IS NULL.
        const details: Array<{
          conv: number;
          userActive: number;
          sessActive: number;
        }> = [];
        for (let conv = 0; conv < CONVERSATIONS; conv++) {
          const ua = await pool.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM memories
             WHERE t_invalid IS NULL
               AND user_id = $1 AND session_id IS NULL`,
            [`u-${trial}-c${conv}`],
          );
          const sa = await pool.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM memories
             WHERE t_invalid IS NULL
               AND user_id IS NULL AND session_id = $1`,
            [`s-${trial}-c${conv}`],
          );
          details.push({
            conv,
            userActive: ua.rows[0]?.n ?? -1,
            sessActive: sa.rows[0]?.n ?? -1,
          });
        }
        const orphans = await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM memories
           WHERE t_invalid IS NULL
             AND user_id IS NULL AND session_id IS NULL`,
        );
        const orphCount = orphans.rows[0]?.n ?? -1;

        const allOK = details.every(
          (d) =>
            d.userActive === WRITES_PER_TRIAL &&
            d.sessActive === WRITES_PER_TRIAL,
        );
        if (!allOK || orphCount !== 0) {
          failingTrials.push({
            trial,
            details: [...details, { orphans: orphCount }],
          });
        }
      } finally {
        await memory.dispose();
      }
    }

    expect(
      failingTrials,
      `F-T4.1-2 reproduced in ${failingTrials.length}/${T1_2_TRIALS} multi-conversation trials. ` +
        `Sample: ${JSON.stringify(failingTrials.slice(0, 2), null, 2)}`,
    ).toEqual([]);
  }, 120_000);

  it('parallel user/session remember with capacity eviction does NOT lose user-scope rows (20 trials)', async () => {
    // EC-1 + EC-2 + EC-3 + EC-4 absorbed.
    // 20-iteration loop maximizes reproduction probability for the
    // race condition (heisenbug character per plan EC-1).
    const failingTrials: Array<{
      trial: number;
      userActive: number;
      sessActive: number;
      orphans: number;
      locks?: unknown[];
    }> = [];

    for (let trial = 0; trial < TRIALS; trial++) {
      // Fresh DB state per trial (EC-2)
      if (trial > 0) {
        await truncateTestTables(pool);
      }

      const store = new PgvectorStore(pool);
      const memory = await createLocalMemory({
        vectorStore: store,
        embedder: new DeterministicStubEmbedder(),
        llm: new DeterministicStubLLM(),
        eviction: {
          trigger: 'capacity',
          maxMemoriesPerScope: MAX_MEMORIES_PER_SCOPE,
        },
      });

      try {
        const userScoped = memory.user(`u-${trial}`);
        const sessionScoped = memory.session(`s-${trial}`);

        for (let i = 0; i < WRITES_PER_TRIAL; i++) {
          await Promise.all([
            userScoped.remember(`fact-user-${trial}-${i}`),
            sessionScoped.remember(`fact-session-${trial}-${i}`),
          ]);
        }

        // EC-3: guard t_invalid IS NULL on all counts.
        const userActive = await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM memories
           WHERE t_invalid IS NULL
             AND user_id = $1 AND session_id IS NULL`,
          [`u-${trial}`],
        );
        const sessActive = await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM memories
           WHERE t_invalid IS NULL
             AND user_id IS NULL AND session_id = $1`,
          [`s-${trial}`],
        );
        const orphans = await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM memories
           WHERE t_invalid IS NULL
             AND user_id IS NULL AND session_id IS NULL`,
        );

        const ua = userActive.rows[0]?.n ?? -1;
        const sa = sessActive.rows[0]?.n ?? -1;
        const orphCount = orphans.rows[0]?.n ?? -1;

        // The F-T4.1-2 signature: user-scope rows lost (ua < WRITES_PER_TRIAL)
        // AND/OR orphan rows present (orphCount > 0).
        if (
          ua !== WRITES_PER_TRIAL ||
          sa !== WRITES_PER_TRIAL ||
          orphCount !== 0
        ) {
          failingTrials.push({
            trial,
            userActive: ua,
            sessActive: sa,
            orphans: orphCount,
            locks: await dumpPgLocks(pool),
          });
        }
      } finally {
        await memory.dispose();
      }
    }

    // F-T4.1-2 reproduction expectation:
    // - Pre-fix (RED): at least 1 trial has failingTrial entry.
    // - Post-fix (GREEN): zero failing trials.
    expect(
      failingTrials,
      `F-T4.1-2 reproduced in ${failingTrials.length}/${TRIALS} trials. ` +
        `Sample: ${JSON.stringify(failingTrials.slice(0, 3), null, 2)}`,
    ).toEqual([]);
  }, 60_000);
});
