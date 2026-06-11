/**
 * T2.2 — LocalScopedMemory.getAll consumes VectorStoreResult.createdAt + D2 fallback + EC-7.
 *
 * Three RED tests:
 *   2. getAll uses store.createdAt (NOT new Date()) — mock VectorStore returns
 *      a past Date; assert getAll output reflects the store value, not now().
 *   3. getAll emits `getall_temporal_fallback` OTel event when store.createdAt
 *      is undefined (stale-impl adapter detection).
 *   5. EC-7 absorption — event is emitted AT MOST ONCE per request with
 *      `{ count: N }` metadata. A 100-row legacy scope must produce ONE event
 *      with count=100, NOT 100 distinct events (log-explosion guard).
 *
 * The MEMORY_EVENTS union was extended with `getall_temporal_fallback` at
 * `src/core/memory-event.ts` in this same RED commit per SEPA pre-RED CRITICAL-2
 * (type narrowing requires the literal exist BEFORE `emitEvent` call typechecks).
 *
 * @see .claude/knowledge-base/plans/dashboard-memories-tab-standardization-plan.md § T2.2
 * @see .claude/knowledge-base/reviews/dashboard-memories-tab-standardization-edge-cases-2026-06-08.md § EC-7
 */
import type { Tracer } from '@opentelemetry/api';
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';
import type { InsertOutcome, VectorStore, VectorStoreResult } from '../../domain/dip/vector-store.js';
import type { Filters } from '../../domain/scope.js';
import { createLocalMemory } from './index.js';

const validVector = (): readonly number[] =>
  new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 0.1 : 0));

const makeEmbedder = (): Embedder => ({
  embed: vi.fn(async () => validVector()),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => validVector())),
});

const makeLlm = () => ({
  extract: vi.fn(async () => ({ memory: [] })),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
}) as unknown as LLM;

/** Tracer mock — captures `startActiveSpan` invocations + attribute sets. */
function makeTracerMock(): { tracer: Tracer; events: { name: string; attrs: Record<string, unknown> }[] } {
  const events: { name: string; attrs: Record<string, unknown> }[] = [];
  const tracer = {
    startActiveSpan: vi.fn((name: string, cb: (span: unknown) => void) => {
      const attrs: Record<string, unknown> = {};
      const span = {
        setAttribute: (key: string, value: unknown) => {
          attrs[key] = value;
        },
        end: vi.fn(),
      };
      cb(span);
      events.push({ name, attrs });
      return span;
    }),
  } as unknown as Tracer;
  return { tracer, events };
}

/** VectorStore mock — returns a controlled list() result with whatever createdAt shape. */
function makeVectorStoreReturning(
  rows: readonly VectorStoreResult[],
): VectorStore {
  return {
    initialize: vi.fn(async () => undefined),
    insert: vi.fn(
      async (
        _v: readonly (readonly number[])[],
        ids: readonly string[],
      ): Promise<readonly InsertOutcome[]> =>
        ids.map((id) => ({ id, confirmationCount: 1, rejectedAsDuplicate: false })),
    ),
    search: vi.fn(async () => []),
    keywordSearch: vi.fn(async () => null),
    get: vi.fn(async () => null),
    update: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    deleteCol: vi.fn(async () => undefined),
    list: vi.fn(async (_filters?: Filters, _topK?: number) => [rows, rows.length] as const),
    getUserId: vi.fn(async () => ''),
    setUserId: vi.fn(async () => undefined),
  };
}

describe('LocalScopedMemory.getAll — T2.2 + D2 fallback + EC-7 aggregation', () => {
  test('getAll uses VectorStoreResult.createdAt when present (NOT new Date / now)', async () => {
    const pastDate = new Date('2026-01-15T10:00:00Z');
    const store = makeVectorStoreReturning([
      { id: 'id-1', payload: { text: 'hello', hash: 'h1' }, createdAt: pastDate },
    ]);
    const { tracer } = makeTracerMock();
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm(),
      tracer,
    });

    const items = await memory.user('alice').getAll();

    expect(items).toHaveLength(1);
    // POST-fix contract: createdAt mirrors the store-projected value (not new Date()).
    expect(items[0]?.createdAt.toISOString()).toBe(pastDate.toISOString());
    // updatedAt + tValid mirror createdAt per SEPA CRITICAL-3 honesty.
    expect(items[0]?.updatedAt.toISOString()).toBe(pastDate.toISOString());
    expect(items[0]?.tValid?.toISOString()).toBe(pastDate.toISOString());
  });

  test('getAll emits getall_temporal_fallback when store.createdAt is undefined', async () => {
    const store = makeVectorStoreReturning([
      // Stale-impl shape: no createdAt projected.
      { id: 'id-1', payload: { text: 'hello', hash: 'h1' } },
    ]);
    const { tracer, events } = makeTracerMock();
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm(),
      tracer,
    });

    await memory.user('alice').getAll();

    const fallbackEvents = events.filter((e) => e.name === 'getall_temporal_fallback');
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0]?.attrs['count']).toBe(1);
  });

  test('EC-7 — getall_temporal_fallback aggregated per-request (100 rows → 1 event with count:100, NOT 100 events)', async () => {
    // Fixture: 100 rows ALL missing createdAt.
    const rows: VectorStoreResult[] = Array.from({ length: 100 }, (_, i) => ({
      id: `id-${i}`,
      payload: { text: `row ${i}`, hash: `h${i}` },
    }));
    const store = makeVectorStoreReturning(rows);
    const { tracer, events } = makeTracerMock();
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: makeEmbedder(),
      llm: makeLlm(),
      tracer,
    });

    await memory.user('alice').getAll({ topK: 100 });

    const fallbackEvents = events.filter((e) => e.name === 'getall_temporal_fallback');
    // EC-7 contract: EXACTLY ONE event, not 100. Aggregation prevents log explosion
    // when a 10k-row legacy scope is queried.
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0]?.attrs['count']).toBe(100);
  });
});
