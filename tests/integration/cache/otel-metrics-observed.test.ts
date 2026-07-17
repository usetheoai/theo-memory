/**
 * T3.1 integration — observe the 3 recall-cache OTel instruments firing
 * end-to-end against real `ankane/pgvector:v0.5.1`.
 *
 * Builds a minimal in-memory MeterProvider that captures Counter.add() and
 * Histogram.record() calls into Maps so we can assert on emission counts
 * + label shapes without depending on `@opentelemetry/sdk-metrics`
 * (not in dependencies; Inquebrável Rule 11 YAGNI).
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import {
  metrics,
  type Counter,
  type Histogram,
  type Meter,
  type MeterProvider,
} from '@opentelemetry/api';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import type { Embedder } from '@usetheo/memory';
import type { LLM } from '@usetheo/memory';
import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { __resetRecallCacheMetricsForTesting } from '../../../packages/core/src/infrastructure/db/recall-cache/recall-cache-metrics.js';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t3_1_otel_metrics';

function vec(seed = 0): readonly number[] {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  v[seed] = 1;
  return v;
}

const fixedEmbedder = (): Embedder => ({
  embed: vi.fn(async () => vec(0)),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => vec(0))),
});

const echoLlm = (): LLM => ({
  generateResponse: vi.fn(async (messages: readonly { role: string; content: string }[]) => {
    const userLine = messages.find((m) => m.role === 'user')?.content ?? '';
    return { memory: [{ id: '0', text: userLine.replace(/^user:\s*/, '') || 'fact' }] };
  }),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

interface CapturedObservation {
  readonly instrument: string;
  readonly value: number;
  readonly attributes: Readonly<Record<string, unknown>>;
}

function buildCapturingMeterProvider(captures: CapturedObservation[]): MeterProvider {
  function buildCounter(name: string): Counter {
    return {
      add: (value: number, attrs?: Readonly<Record<string, unknown>>) => {
        captures.push({ instrument: name, value, attributes: attrs ?? {} });
      },
    };
  }
  function buildHistogram(name: string): Histogram {
    return {
      record: (value: number, attrs?: Readonly<Record<string, unknown>>) => {
        captures.push({ instrument: name, value, attributes: attrs ?? {} });
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
  return {
    getMeter: () => meter,
  };
}

describe.skipIf(ROOT_PG_URI === '')('T3.1 — recall-cache OTel metrics (integration)', () => {
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
    await runMigrations(pool);
    // Install the capturing MeterProvider BEFORE any cache module touches `metrics.getMeter`.
    metrics.setGlobalMeterProvider(buildCapturingMeterProvider(captures));
  }, 60_000);

  afterAll(async () => {
    metrics.disable();
    __resetRecallCacheMetricsForTesting();
    await pool?.end();
    const adminPool = new pg.Pool({ connectionString: adminUri });
    await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await adminPool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE memories, entities, history, recall_cache CASCADE');
    captures.length = 0;
    // Reset the lazy cache so the FIRST observation re-resolves the meter against the
    // capturing MeterProvider installed above. Without this, the previous test run's
    // resolved instruments (from a different provider) would be retained.
    __resetRecallCacheMetricsForTesting();
  });

  it('T3.1-RED-2 — cache HIT emits hit counter + hit duration histogram with labels', async () => {
    const memory = await createLocalMemory({
      vectorStore: new PgvectorStore(pool),
      embedder: fixedEmbedder(),
      llm: echoLlm(),
      recallCache: { threshold: 0.8 },
    });
    await memory.user('alice').remember('Paulo likes coffee');
    // First recall MISS → populates cache.
    await memory.user('alice').recall('coffee');
    const captureCountBeforeHit = captures.length;
    // Second recall HIT.
    await memory.user('alice').recall('coffee');

    const sinceHit = captures.slice(captureCountBeforeHit);
    const counterObs = sinceHit.find((c) => c.instrument === 'theo.memory.recall_cache.hit');
    expect(counterObs).toBeDefined();
    expect(counterObs?.value).toBe(1);
    expect(counterObs?.attributes['scope_tier']).toBe('user');
    expect(counterObs?.attributes['embedder_kind']).toBeDefined();

    const hitHistoObs = sinceHit.find((c) => c.instrument === 'theo.memory.recall_cache.hit.duration_ms');
    expect(hitHistoObs).toBeDefined();
    expect(typeof hitHistoObs?.value).toBe('number');
  });

  it('T3.1-RED-3 — cache MISS emits miss duration histogram (no counter increment)', async () => {
    const memory = await createLocalMemory({
      vectorStore: new PgvectorStore(pool),
      embedder: fixedEmbedder(),
      llm: echoLlm(),
      recallCache: { threshold: 0.8 },
    });
    await memory.user('alice').remember('Paulo likes tea');
    captures.length = 0;
    // Single recall → MISS (cache was empty post-remember invalidation).
    await memory.user('alice').recall('tea');
    const missHistoObs = captures.find((c) => c.instrument === 'theo.memory.recall_cache.miss.duration_ms');
    expect(missHistoObs).toBeDefined();
    expect(typeof missHistoObs?.value).toBe('number');
    const counterObs = captures.find((c) => c.instrument === 'theo.memory.recall_cache.hit');
    expect(counterObs).toBeUndefined();
  });

  it('T3.1-RED-4 — labels include scope_tier + embedder_kind on emissions', async () => {
    const memory = await createLocalMemory({
      vectorStore: new PgvectorStore(pool),
      embedder: fixedEmbedder(),
      llm: echoLlm(),
      recallCache: { threshold: 0.8 },
    });
    await memory.user('alice').remember('seed fact');
    // First recall → MISS (miss histogram observation).
    await memory.user('alice').recall('seed fact');
    const missObs = captures.find((c) => c.instrument === 'theo.memory.recall_cache.miss.duration_ms');
    expect(missObs?.attributes['scope_tier']).toBe('user');
    expect(missObs?.attributes['embedder_kind']).toBeDefined();
  });
});
