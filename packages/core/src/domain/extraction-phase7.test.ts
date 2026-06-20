/**
 * T3.1 — Phase 7 (entity linking) orchestration tests.
 *
 * Unit-level with stubs (no real DB): asserts the pipeline extracts → embeds →
 * persists entities via the MemoryEntityStore port when both Phase-7 ports are
 * present; skips entirely when they are absent; is FAIL-SOFT (extractor/persist
 * throw → entity_linking_failed event + remember() still returns its items);
 * caps per memory (EC-3); drops empty/short names before persist (EC-2).
 *
 * @see .claude/knowledge-base/plans/entity-extraction-nodes-slice1-plan.md § T3.1
 */
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from './constants.js';
import type { Embedder } from './dip/embedder.js';
import type { EntityExtractor } from './dip/entity-extractor.js';
import type { LLM } from './dip/llm.js';
import type { MemoryEntityStore, UpsertAndLinkParams } from './dip/memory-entity-store.js';
import type { InsertOutcome, VectorStore, VectorStoreResult } from './dip/vector-store.js';
import { runExtractionPipeline } from './extraction/pipeline.js';
import type { Filters } from './scope.js';

type Payload = Record<string, string | number | boolean | null>;

class StubVectorStore implements VectorStore {
  private rows = new Map<string, Payload>();
  initialize(): Promise<void> { return Promise.resolve(); }
  async insert(_v: readonly (readonly number[])[], ids: readonly string[], payloads: readonly Payload[]): Promise<readonly InsertOutcome[]> {
    const out: InsertOutcome[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i] as string;
      this.rows.set(id, payloads[i] as Payload);
      out.push({ id, confirmationCount: 1, rejectedAsDuplicate: false });
    }
    await Promise.resolve();
    return out;
  }
  async search(_q: readonly number[], topK = 10): Promise<readonly VectorStoreResult[]> {
    const out: VectorStoreResult[] = [];
    for (const [id, payload] of this.rows.entries()) { out.push({ id, payload }); if (out.length >= topK) break; }
    await Promise.resolve();
    return out;
  }
  keywordSearch(): Promise<readonly VectorStoreResult[] | null> { return Promise.resolve(null); }
  async get(id: string): Promise<VectorStoreResult | null> { await Promise.resolve(); const p = this.rows.get(id); return p ? { id, payload: p } : null; }
  async update(id: string, _v: readonly number[], payload: Payload): Promise<void> { this.rows.set(id, payload); await Promise.resolve(); }
  async delete(id: string): Promise<void> { this.rows.delete(id); await Promise.resolve(); }
  async deleteCol(): Promise<void> { this.rows.clear(); await Promise.resolve(); }
  async list(_f?: Filters, topK = 100): Promise<readonly [readonly VectorStoreResult[], number]> {
    const m: VectorStoreResult[] = [];
    for (const [id, payload] of this.rows.entries()) m.push({ id, payload });
    await Promise.resolve();
    return [m.slice(0, topK), m.length];
  }
  getUserId(): Promise<string> { return Promise.resolve(''); }
  setUserId(): Promise<void> { return Promise.resolve(); }
}

const vec = (): readonly number[] => new Array<number>(MAX_EMBEDDING_DIM).fill(0);
const makeEmbedder = (): Embedder => ({
  embed: vi.fn(async () => vec()),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => vec())),
});
const makeLlm = (response: unknown): LLM => ({
  generateResponse: vi.fn(async () => response),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});
const oneFactLlm = (): LLM => makeLlm({ memory: [{ id: '0', text: 'John Smith works at Google' }] });

const makeExtractor = (entities: readonly { type: 'PROPER' | 'QUOTED' | 'COMPOUND' | 'NOUN'; name: string }[]): EntityExtractor => ({
  extract: vi.fn(() => entities),
});

function spyStore(): { store: MemoryEntityStore; calls: UpsertAndLinkParams[] } {
  const calls: UpsertAndLinkParams[] = [];
  return {
    calls,
    store: { upsertAndLink: vi.fn(async (p: UpsertAndLinkParams) => { calls.push(p); await Promise.resolve(); }) },
  };
}

const setupTracer = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
};

describe('Phase 7 — entity linking (T3.1)', () => {
  test('persists extracted entities + links via the store when both ports present', async () => {
    const { store, calls } = spyStore();
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'John Smith works at Google' }],
      { user_id: 'alice', workspace_id: 'default' },
      {
        vectorStore: new StubVectorStore(),
        embedder: makeEmbedder(),
        llm: oneFactLlm(),
        entityExtractor: makeExtractor([{ type: 'PROPER', name: 'John Smith' }, { type: 'PROPER', name: 'Google' }]),
        memoryEntityStore: store,
      },
    );
    expect(result).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.memoryId).toBe(result[0]?.id);
    expect(calls[0]?.entities.map((e) => e.name).sort()).toEqual(['Google', 'John Smith']);
    expect(calls[0]?.entities[0]?.embedding).toHaveLength(MAX_EMBEDDING_DIM);
    expect(calls[0]?.entities[0]?.normalizedKey).toBeDefined();
  });

  test('skips Phase 7 entirely when the ports are absent', async () => {
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'John Smith works at Google' }],
      { user_id: 'alice' },
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: oneFactLlm() },
    );
    expect(result).toHaveLength(1); // no throw, no persist
  });

  test('FAIL-SOFT: extractor throwing does not fail remember() and emits entity_linking_failed', async () => {
    const { tracer, exporter } = setupTracer();
    const throwingExtractor: EntityExtractor = { extract: () => { throw new Error('boom'); } };
    const { store } = spyStore();
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'John Smith works at Google' }],
      { user_id: 'alice' },
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: oneFactLlm(), tracer, entityExtractor: throwingExtractor, memoryEntityStore: store },
    );
    expect(result).toHaveLength(1); // remember() survived
    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).toContain('entity_linking_failed');
  });

  test('EC-2: empty/short-name entities are dropped before persist', async () => {
    const { store, calls } = spyStore();
    await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      {
        vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: oneFactLlm(),
        entityExtractor: makeExtractor([{ type: 'PROPER', name: 'Google' }, { type: 'NOUN', name: ' ' }, { type: 'NOUN', name: 'a' }]),
        memoryEntityStore: store,
      },
    );
    expect(calls[0]?.entities.map((e) => e.name)).toEqual(['Google']);
  });

  test('EC-3: entities are capped per memory', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ type: 'PROPER' as const, name: `Name${i}` }));
    const { store, calls } = spyStore();
    await runExtractionPipeline(
      [{ role: 'user', content: 'lots' }],
      { user_id: 'alice' },
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: oneFactLlm(), entityExtractor: makeExtractor(many), memoryEntityStore: store },
    );
    expect(calls[0]?.entities.length).toBeLessThanOrEqual(50);
  });
});
