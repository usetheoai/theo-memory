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
  async deleteInScope(): Promise<boolean> { await Promise.resolve(); return false; }
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
    store: {
      upsertAndLink: vi.fn(async (p: UpsertAndLinkParams) => { calls.push(p); await Promise.resolve(); }),
      list: vi.fn(async () => []),
    },
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

  test('F-L4: emits entity_linked on the success path', async () => {
    const { tracer, exporter } = setupTracer();
    const { store } = spyStore();
    await runExtractionPipeline(
      [{ role: 'user', content: 'John Smith works at Google' }],
      { user_id: 'alice' },
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: oneFactLlm(), tracer, entityExtractor: makeExtractor([{ type: 'PROPER', name: 'John Smith' }]), memoryEntityStore: store },
    );
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain('entity_linked');
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

  test('F-M2: an entity whose embedding is empty is filtered before persist (no zero-dim vector)', async () => {
    // Embedder returns an EMPTY vector ONLY for the entity named "Empty One"
    // (keyed by text, NOT index — so the Phase 3 memory embedding stays valid).
    const partialEmbedder: Embedder = {
      embed: vi.fn(async () => vec()),
      embedBatch: vi.fn(async (texts: readonly string[]) => texts.map((t) => (t === 'Empty One' ? [] : vec()))),
    };
    const { store, calls } = spyStore();
    await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      {
        vectorStore: new StubVectorStore(), embedder: partialEmbedder, llm: oneFactLlm(),
        entityExtractor: makeExtractor([{ type: 'PROPER', name: 'Empty One' }, { type: 'PROPER', name: 'Google' }]),
        memoryEntityStore: store,
      },
    );
    // Only the valid-embedding entity reaches the store; no zero-dim vector persisted.
    expect(calls[0]?.entities.map((e) => e.name)).toEqual(['Google']);
    expect(calls[0]?.entities.every((e) => e.embedding.length === MAX_EMBEDDING_DIM)).toBe(true);
  });
});

// ── slice2 T2.2 — Phase 7 edge linking (relations) ───────────────────────────
import type { MemoryGraphStore, UpsertEdgesParams } from './dip/memory-graph-store.js';

function spyGraph(opts: { throws?: boolean } = {}): { store: MemoryGraphStore; calls: UpsertEdgesParams[] } {
  const calls: UpsertEdgesParams[] = [];
  return {
    calls,
    store: {
      upsertEdges: vi.fn(async (p: UpsertEdgesParams) => {
        if (opts.throws === true) throw new Error('edge store boom');
        calls.push(p);
        await Promise.resolve();
      }),
      listEdges: vi.fn(async () => []),
    },
  };
}

const relLlm = (relations: unknown): LLM =>
  makeLlm({ memory: [{ id: '0', text: 'John Smith works at Google' }], relations });

const goodRel = [{ source: 'John Smith', relationship: 'works at', destination: 'Google' }];

describe('Phase 7 — edge linking (slice2 T2.2)', () => {
  const baseDeps = (graph: MemoryGraphStore, llm: LLM, tracer?: ReturnType<typeof setupTracer>['tracer']) => ({
    vectorStore: new StubVectorStore(),
    embedder: makeEmbedder(),
    llm,
    ...(tracer ? { tracer } : {}),
    entityExtractor: makeExtractor([{ type: 'PROPER' as const, name: 'John Smith' }, { type: 'PROPER' as const, name: 'Google' }]),
    memoryEntityStore: spyStore().store,
    memoryGraphStore: graph,
  });

  test('link_entities_emits_edge_event_on_relations', async () => {
    const { tracer, exporter } = setupTracer();
    const { store, calls } = spyGraph();
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'John Smith works at Google' }],
      { user_id: 'alice' },
      baseDeps(store, relLlm(goodRel), tracer),
    );
    expect(calls).toHaveLength(1);
    // provenance: edge attributed to the FIRST (representative) memory of the call
    expect(calls[0]?.memoryId).toBe(result[0]?.id);
    expect(calls[0]?.edges).toHaveLength(1);
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain('entity_edge_linked');
  });

  test('link_entities_failsoft_on_edge_store_throw', async () => {
    const { tracer, exporter } = setupTracer();
    const { store } = spyGraph({ throws: true });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'John Smith works at Google' }],
      { user_id: 'alice' },
      baseDeps(store, relLlm(goodRel), tracer),
    );
    expect(result).toHaveLength(1); // remember() still resolves
    const spans = exporter.getFinishedSpans().map((s) => s.name);
    expect(spans).toContain('entity_edge_linking_failed');
    expect(spans).toContain('entity_linked'); // node linking still succeeded independently
  });

  test('link_entities_caps_edges_at_max', async () => {
    const { store, calls } = spyGraph();
    const many = Array.from({ length: 80 }, (_v, i) => ({
      source: 'John Smith', relationship: `rel${String(i)}`, destination: 'Google',
    }));
    await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      baseDeps(store, relLlm(many)),
    );
    const passed = calls[0]?.edges.length ?? 0;
    expect(passed).toBeLessThanOrEqual(50);
  });

  test('link_entities_drops_overlong_or_malformed_relation', async () => {
    const { store, calls } = spyGraph();
    const bad = [
      { source: 'John Smith', relationship: 'x'.repeat(80), destination: 'Google' }, // >64 chars
      { source: 'John Smith', relationship: '', destination: 'Google' }, // empty
      {}, // missing keys
    ];
    await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      baseDeps(store, relLlm(bad)),
    );
    const passed = calls[0]?.edges.length ?? 0;
    expect(passed).toBe(0);
  });

  test('no relations → no edge call (back-compat / infer node-only)', async () => {
    const { store, calls } = spyGraph();
    await runExtractionPipeline(
      [{ role: 'user', content: 'John Smith works at Google' }],
      { user_id: 'alice' },
      baseDeps(store, oneFactLlm()),
    );
    expect(calls).toHaveLength(0);
  });
});

describe('Phase 7 — edge endpoint auto-create (EC-5) + predicate-node filter (slice2 fix)', () => {
  test('EC-5: a relation endpoint compromise did NOT extract is auto-created as a node', async () => {
    const { store: graph, calls: graphCalls } = spyGraph();
    const { store: entityStore, calls: entityCalls } = spyStore();
    // Extractor returns ONLY "John Smith" (misses "Google") — mimics compromise
    // missing single-token entities. The LLM relation names Google as endpoint.
    await runExtractionPipeline(
      [{ role: 'user', content: 'John Smith works at Google' }],
      { user_id: 'alice' },
      {
        vectorStore: new StubVectorStore(),
        embedder: makeEmbedder(),
        llm: relLlm(goodRel),
        entityExtractor: makeExtractor([{ type: 'PROPER', name: 'John Smith' }]),
        memoryEntityStore: entityStore,
        memoryGraphStore: graph,
      },
    );
    // The edge was still linked (upsertEdges called)...
    expect(graphCalls).toHaveLength(1);
    // ...AND the missing endpoint "Google" was auto-created as a node (a 2nd
    // upsertAndLink beyond the compromise node-linking call).
    const allLinkedNames = entityCalls.flatMap((c) => c.entities.map((e) => e.name));
    expect(allLinkedNames).toContain('Google');
  });

  test('relation predicate ("works at") is NOT persisted as a node', async () => {
    const { store: graph } = spyGraph();
    const { store: entityStore, calls: entityCalls } = spyStore();
    // Extractor erroneously returns the verb phrase "works at" as a COMPOUND node
    // (compromise noise). It must be filtered because it is a relation predicate.
    await runExtractionPipeline(
      [{ role: 'user', content: 'John Smith works at Google' }],
      { user_id: 'alice' },
      {
        vectorStore: new StubVectorStore(),
        embedder: makeEmbedder(),
        llm: relLlm(goodRel),
        entityExtractor: makeExtractor([
          { type: 'PROPER', name: 'John Smith' },
          { type: 'PROPER', name: 'Google' },
          { type: 'COMPOUND', name: 'works at' },
        ]),
        memoryEntityStore: entityStore,
        memoryGraphStore: graph,
      },
    );
    const allLinkedNames = entityCalls.flatMap((c) => c.entities.map((e) => e.name));
    expect(allLinkedNames).not.toContain('works at');
    expect(allLinkedNames).toContain('John Smith');
  });
});

describe('Phase 7 — LLM is the PRIMARY (multilingual) node source', () => {
  test('uses LLM-extracted entities as nodes (diacritics preserved) and does NOT call the EN-only extractor', async () => {
    const { store, calls } = spyStore();
    const extractor = makeExtractor([{ type: 'PROPER', name: 'ENGLISH_ONLY_NOISE' }]);
    const llm = makeLlm({
      memory: [{ id: '0', text: 'A Maria trabalha na Acme em São Paulo' }],
      entities: [
        { name: 'Maria', type: 'PERSON' },
        { name: 'Acme', type: 'ORG' },
        { name: 'São Paulo', type: 'PLACE' },
      ],
    });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'A Maria trabalha na Acme em São Paulo' }],
      { user_id: 'alice', workspace_id: 'default' },
      {
        vectorStore: new StubVectorStore(),
        embedder: makeEmbedder(),
        llm,
        entityExtractor: extractor,
        memoryEntityStore: store,
      },
    );
    expect(result).toHaveLength(1);
    const linkedNames = calls.flatMap((c) => c.entities.map((e) => e.name));
    expect(linkedNames).toContain('São Paulo'); // multilingual, diacritics preserved
    expect(linkedNames).toContain('Maria');
    expect(linkedNames).toContain('Acme');
    expect(linkedNames).not.toContain('ENGLISH_ONLY_NOISE'); // compromise NOT used
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  test('falls back to the EN extractor when the LLM returns no entities (infer:false / empty)', async () => {
    const { store, calls } = spyStore();
    const extractor = makeExtractor([{ type: 'PROPER', name: 'John Smith' }]);
    await runExtractionPipeline(
      [{ role: 'user', content: 'John Smith works at Google' }],
      { user_id: 'alice' },
      {
        vectorStore: new StubVectorStore(),
        embedder: makeEmbedder(),
        llm: oneFactLlm(), // { memory: [...] } — no entities
        entityExtractor: extractor,
        memoryEntityStore: store,
      },
    );
    expect(extractor.extract).toHaveBeenCalled();
    const linkedNames = calls.flatMap((c) => c.entities.map((e) => e.name));
    expect(linkedNames).toContain('John Smith');
  });
});
