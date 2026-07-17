/**
 * T5.1 — THE GOAL TEST per `semantic-recall-cache-v1-5-plan.md § T5.1`.
 *
 * Proves Item 19 Acceptance Criterion #1: cache hit rate ≥ 0.5 on a
 * 20-query test set (10 near-duplicate pairs at cosine ≥ 0.8 default threshold)
 * against real `ankane/pgvector:v0.5.1`.
 *
 * Composition:
 *   - `LocalTransformerEmbedder` (Xenova `all-MiniLM-L6-v2`, 384-dim, L2-normalized;
 *     ships in repo per adapters-openrouter-local-embedder v1.4)
 *   - `DeterministicStubLLM` (extraction quality not measured here; cache hit
 *     rate is the metric of interest)
 *   - `PgvectorStore` + `runMigrations({ embeddingDim: 384 })`
 *   - `createLocalMemory({ recallCache: { threshold: 0.8 } })` opt-in cache wiring
 *
 * Measurement: in-memory capturing MeterProvider counts
 * `theo.memory.recall_cache.hit` Counter emissions across 10 pair sequences.
 *
 * Skipped when THEOMEM_PG_URI is unset (no flaky CI).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import {
  metrics,
  type Counter,
  type Histogram,
  type Meter,
  type MeterProvider,
} from '@opentelemetry/api';

import { LocalTransformerEmbedder } from '@usetheo/memory/embedders/local';
import { DeterministicStubLLM } from '@usetheo/memory/llms/stub';
import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { __resetRecallCacheMetricsForTesting } from '../../../packages/core/src/infrastructure/db/recall-cache/recall-cache-metrics.js';
import { NEAR_DUPLICATE_QUERY_PAIRS } from '../../fixtures/cache/near-duplicate-query-pairs.js';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t5_1_semantic_recall_cache_goal';

interface CapturedObservation {
  readonly instrument: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

function buildCapturingMeterProvider(captures: CapturedObservation[]): MeterProvider {
  function buildCounter(name: string): Counter {
    return {
      add: (_value: number, attrs?: Readonly<Record<string, unknown>>) => {
        captures.push({ instrument: name, attributes: attrs ?? {} });
      },
    };
  }
  function buildHistogram(name: string): Histogram {
    return {
      record: (_value: number, attrs?: Readonly<Record<string, unknown>>) => {
        captures.push({ instrument: name, attributes: attrs ?? {} });
      },
    };
  }
  const meter = {
    createCounter: (name: string) => buildCounter(name),
    createHistogram: (name: string) => buildHistogram(name),
    createUpDownCounter: (name: string) => buildCounter(name),
    createObservableCounter: () => ({ addCallback: () => undefined, removeCallback: () => undefined }),
    createObservableGauge: () => ({ addCallback: () => undefined, removeCallback: () => undefined }),
    createObservableUpDownCounter: () => ({ addCallback: () => undefined, removeCallback: () => undefined }),
    createGauge: (name: string) => buildHistogram(name),
    addBatchObservableCallback: () => undefined,
    removeBatchObservableCallback: () => undefined,
  } as unknown as Meter;
  return { getMeter: () => meter };
}

describe.skipIf(ROOT_PG_URI === '')(
  'T5.1 — THE GOAL TEST: 10 near-duplicate pairs, hit rate ≥ 0.5',
  () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const testUri = ROOT_PG_URI.replace(/\/[^/]*$/, `/${TEST_DB}`);
    let pool: pg.Pool;
    const captures: CapturedObservation[] = [];

    beforeAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      await adminPool.end();
      pool = new pg.Pool({ connectionString: testUri });
      // 384-dim cascade via applyDimChange (extended in this commit to also
      // rewrite recall_cache.query_embedding).
      await runMigrations(pool, { embeddingDim: 384 });
      metrics.setGlobalMeterProvider(buildCapturingMeterProvider(captures));
      __resetRecallCacheMetricsForTesting();
    }, 120_000);

    afterAll(async () => {
      metrics.disable();
      __resetRecallCacheMetricsForTesting();
      await pool?.end();
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    });

    // Sibling regression smokes per plan T5.1 Acceptance Criteria. Deep
    // coverage lives in tests/integration/cache/cache-hit-miss.test.ts,
    // tests/integration/cache/factory-wiring.test.ts, and the contract suite
    // at src/local/__tests__/embedder-cache-gate-warning.test.ts. These
    // smokes guard against silent breakage of THE GOAL TEST's preconditions
    // (Item 19 AC#3 + TTL semantics + stub warning).
    it('regression smoke — write-triggered invalidation: remember() clears cache row in scope', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
        embedder: new LocalTransformerEmbedder(),
        llm: new DeterministicStubLLM(),
        embeddingDim: 384,
        recallCache: { threshold: 0.8 },
      });
      await pool.query('TRUNCATE recall_cache, memories, entities, history CASCADE');
      // First recall populates the cache for user:alice.
      await memory.user('alice').recall('what is my favorite color?');
      const before = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_cache WHERE scope_key = 'ws:default|user:alice'`,
      );
      expect(before.rows[0]?.count).toBe('1');
      // remember() must invalidate the scope per Item 19 AC#3.
      await memory.user('alice').remember('My favorite color is teal.');
      const after = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_cache WHERE scope_key = 'ws:default|user:alice'`,
      );
      expect(after.rows[0]?.count).toBe('0');
    }, 120_000);

    it('regression smoke — TTL expiry: set with ttl=1; wait 2s; get → MISS', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
        embedder: new LocalTransformerEmbedder(),
        llm: new DeterministicStubLLM(),
        embeddingDim: 384,
        recallCache: { ttlSecondsByScopeTier: { user: 1, agent: 1, session: 1, repo: 1 }, threshold: 0.8 },
      });
      await pool.query('TRUNCATE recall_cache CASCADE');
      await memory.user('alice').recall('what is my favorite color?'); // populates
      await new Promise((r) => setTimeout(r, 2000));
      captures.length = 0;
      await memory.user('alice').recall('what is my favorite color?'); // expired → MISS
      const hitObs = captures.filter((c) => c.instrument === 'theo.memory.recall_cache.hit');
      expect(hitObs).toHaveLength(0);
    }, 120_000);

    it('regression smoke — stub-embedder + cache → 3-line stderr warning emitted', async () => {
      // The shipped `DeterministicStubEmbedder` is MAX_EMBEDDING_DIM=1536 — the
      // test DB is at 384, so the dim probe would reject before the warning
      // fires. Build a tiny 384-dim stub inline that the warning helper
      // recognizes via constructor.name to keep the regression honest at the
      // current DB dim.
      class DeterministicStubEmbedder {
        async embed(): Promise<readonly number[]> {
          const v = new Array<number>(384).fill(0);
          v[0] = 1;
          return v;
        }
        async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
          return texts.map(() => {
            const v = new Array<number>(384).fill(0);
            v[0] = 1;
            return v;
          });
        }
      }
      // EC-14 stderr-spy convention per plan T2.3 + cycle-1 T2.2 precedent
      // (mirror src/local/__tests__/embedder-cache-gate-warning.test.ts).
      const writes: string[] = [];
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: unknown): true => {
          writes.push(typeof chunk === 'string' ? chunk : String(chunk));
          return true;
        });
      try {
        await createLocalMemory({
          vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
          embedder: new DeterministicStubEmbedder(),
          llm: new DeterministicStubLLM(),
          embeddingDim: 384,
          recallCache: { threshold: 0.8 },
        });
      } finally {
        stderrSpy.mockRestore();
      }
      const cacheLines = writes.filter((w) => w.startsWith('themory cache:'));
      expect(cacheLines).toHaveLength(3);
      expect(cacheLines[0]).toMatch(/DeterministicStubEmbedder/);
    });

    it(
      'cache hit rate ≥ 0.5 on the 10-pair set under cosine ≥ 0.8 (default threshold)',
      async () => {
        const memory = await createLocalMemory({
          vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
          embedder: new LocalTransformerEmbedder(),
          llm: new DeterministicStubLLM(),
          embeddingDim: 384,
          recallCache: { threshold: 0.8 },
        });
        // The Memory wrap embeds + cache.get → MISS → runRetrievalPipeline →
        // cache.set. We do NOT need any seed memories for this test: the
        // result_set persisted by set() is empty (no rows in scope yet) but
        // that does NOT affect the hit/miss accounting — the cache compares
        // QUERY embeddings, not result content.
        let hits = 0;
        const aliceScope = { scope_tier: 'user' as const };
        for (const { a, b } of NEAR_DUPLICATE_QUERY_PAIRS) {
          // Truncate the cache between pairs so each pair tests in isolation
          // (prevents cumulative leakage from earlier pairs' embeddings).
          await pool.query('TRUNCATE recall_cache');
          captures.length = 0;
          await memory.user('alice').recall(a); // MISS → populates cache for a
          await memory.user('alice').recall(b); // HIT iff cosine(embed(a), embed(b)) ≥ 0.8
          const hitObs = captures.filter(
            (c) =>
              c.instrument === 'theo.memory.recall_cache.hit' &&
              c.attributes['scope_tier'] === aliceScope.scope_tier,
          );
          if (hitObs.length > 0) {
            hits += 1;
          }
        }
        const total = NEAR_DUPLICATE_QUERY_PAIRS.length;
        const hitRate = hits / total;
        // eslint-disable-next-line no-console
        console.log(
          `[T5.1 GOAL TEST] hits=${String(hits)}/${String(total)} → hit rate ${hitRate.toFixed(2)} (target ≥ 0.50)`,
        );
        // Item 19 Acceptance Criterion #1
        expect(hitRate).toBeGreaterThanOrEqual(0.5);
      },
      300_000, // model download + first-run inference can take a while
    );
  },
);
