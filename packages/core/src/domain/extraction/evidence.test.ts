import { describe, expect, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

import { createLocalMemory } from '../../infrastructure/db/factory.js';
import { InMemoryVectorStore } from '../../infrastructure/db/in-memory-store.js';
import type { Embedder } from '../dip/embedder.js';
import type { MemoryEntityStore } from '../dip/memory-entity-store.js';
import type { MemoryGraphStore } from '../dip/memory-graph-store.js';
import { prepareExtractedEvidence } from './evidence.js';
import type { LLM } from '../dip/llm.js';
import { InvalidScope, MemoryStoreError } from '../errors.js';
import { MEMORY_EVIDENCE_KEY } from '../memory-evidence.js';
import { runExtractionPipeline } from './pipeline.js';

const vector = [1, 0, 0];
const embedder: Embedder = {
  embed: async () => vector,
  embedBatch: async (texts) => texts.map(() => vector),
};
function provider(response: unknown): LLM {
  return { generateResponse: vi.fn(async () => response), generateChat: vi.fn() };
}
async function fixture(response: unknown) {
  const llm = provider(response);
  const vectorStore = new InMemoryVectorStore();
  const memory = await createLocalMemory({ vectorStore, llm, embedder, embeddingDim: 3, entityBoost: false });
  return { memory, llm, vectorStore };
}

describe('contextual evidence through the memory SDK', () => {
  test('keeps a stated preference and purchase distinct from inferred understanding', async () => {
    const preference = 'I usually prefer dark colors';
    const purchase = 'I bought a blue jacket';
    const { memory } = await fixture({ memory: [
      { id: '1', text: 'user prefers dark colors', evidence: { kind: 'stated', durability: 'durable', sourceQuote: preference } },
      { id: '2', text: 'user bought a blue jacket', evidence: { kind: 'stated', durability: 'durable', sourceQuote: purchase } },
      { id: '3', text: 'user favors understated style', evidence: { kind: 'inferred', durability: 'durable', sourceQuote: preference, confidence: 0.6 } },
    ] });
    const scope = memory.user('alice');
    const items = await scope.remember(`${preference}. ${purchase}.`, {
      evidence: { kind: 'observed', sourceId: 'session-a:turn-1', modality: 'audio' },
    });
    expect(items.map((item) => item.evidence?.kind)).toEqual(['stated', 'stated', 'inferred']);
    const evidenceById = new Map(items.map((item) => [item.id, item.evidence]));
    for (const item of await scope.getAll()) expect(item.evidence).toEqual(evidenceById.get(item.id));
    for (const item of await scope.recall('style jacket', { threshold: 0 })) expect(item.evidence).toEqual(evidenceById.get(item.id));
    expect((await memory.get(items[0]!.id))?.evidence).toEqual(items[0]!.evidence);
    expect(items[0]!.evidence).toMatchObject({ sourceId: 'session-a:turn-1', modality: 'audio' });
  });

  test('drops a tentative preference and temporary choice before embedding or persistence', async () => {
    const { memory, vectorStore } = await fixture({ memory: [
      { id: '1', text: 'user likes yellow', evidence: { kind: 'inferred', durability: 'tentative' } },
      { id: '2', text: 'user wears yellow today', evidence: { kind: 'stated', durability: 'temporary' } },
    ] });
    expect(await memory.user('alice').remember('Maybe I will wear yellow today')).toEqual([]);
    expect((await vectorStore.list())[1]).toBe(0);
  });

  test('does not retain invented citations or let a caller mark extracted facts observed', async () => {
    const { memory } = await fixture({ memory: [{ id: '1', text: 'user prefers dark colors',
      evidence: { kind: 'stated', durability: 'durable', sourceQuote: 'not in the input' },
    }] });
    const [item] = await memory.user('alice').remember('A conversation about style', {
      evidence: { kind: 'observed', sourceQuote: 'caller citation', confidence: 1 },
    });
    expect(item?.evidence).toEqual({ kind: 'inferred' });
  });

  test('supports legacy extraction responses without silently calling them stated', async () => {
    const { memory } = await fixture({ memory: [{ id: '1', text: 'user prefers dark colors' }] });
    const [item] = await memory.user('alice').remember('I usually prefer dark colors');
    expect(item?.evidence).toEqual({ kind: 'inferred' });
  });

  test('verbatim observation preserves source context and never calls the LLM', async () => {
    const { memory, llm } = await fixture({});
    const evidence = { kind: 'observed' as const, sourceId: 'media:frame-12', modality: 'video' as const };
    const [item] = await memory.session('session-a', 'alice').remember('The dinner invitation says formal attire.', { infer: false, evidence });
    expect(item?.evidence).toEqual(evidence);
    expect(llm.generateResponse).not.toHaveBeenCalled();
    expect((await memory.session('session-b', 'alice').getAll())).toEqual([]);
  });

  test('validates evidence before provider or store I/O and prevents flat metadata impersonation', async () => {
    const { memory, llm } = await fixture({});
    await expect(memory.user('alice').remember('A fact', { evidence: { kind: 'stated', confidence: NaN } })).rejects.toBeInstanceOf(InvalidScope);
    expect(llm.generateResponse).not.toHaveBeenCalled();
    const [item] = await memory.user('alice').remember('A fact', {
      infer: false, metadata: { [MEMORY_EVIDENCE_KEY]: '{"kind":"observed"}' },
    });
    expect(item?.evidence).toBeUndefined();
    expect(item?.metadata[MEMORY_EVIDENCE_KEY]).toBeUndefined();
  });

  test('validates deadlines and rejects unsupported replay before provider work', async () => {
    const {memory,llm} = await fixture({});
    await expect(memory.user('alice').remember('A fact',{expiresAt:new Date(0)})).rejects.toBeInstanceOf(InvalidScope);
    await expect(memory.user('alice').remember('A fact',{idempotencyKey:'unsupported-store'})).rejects.toBeInstanceOf(InvalidScope);
    expect(llm.generateResponse).not.toHaveBeenCalled();
    const [item] = await memory.session('dinner','alice').remember('Formal invitation',{
      infer:false,metadata:{confirmation_count:999,distinct_source_count:999,t_invalid:'2100-01-01',expires_at:'2100-01-01'},
    });
    expect(item?.scope).toEqual({kind:'session',sessionId:'dinner',userId:'alice'});
    expect(item?.metadata['distinct_source_count']).toBeUndefined();
    expect(item?.expiresAt).toBeUndefined();
    expect(item?.confirmationCount).toBe(1);
  });

  test('strict extraction distinguishes malformed output from a valid empty extraction', async () => {
    const { memory } = await fixture('not JSON');
    await expect(memory.user('alice').remember('A fact', { strictExtraction: true })).rejects.toBeInstanceOf(MemoryStoreError);
    expect(await memory.user('alice').remember('A fact')).toEqual([]);
    const empty = await fixture({ memory: [] });
    expect(await empty.memory.user('alice').remember('Hello', { strictExtraction: true })).toEqual([]);
  });

  test('rejected preferences cannot survive as batch graph nodes or edges on a kept fact', async () => {
    const memoryEntityStore = mock<MemoryEntityStore>();
    const memoryGraphStore = mock<MemoryGraphStore>();
    const extract = vi.fn(() => []);
    const vectorStore = new InMemoryVectorStore();
    const items = await runExtractionPipeline([{ role: 'user', content: 'I prefer dark colors. Maybe yellow today.' }],
      { user_id: 'alice' }, { vectorStore, embedder, memoryEntityStore, memoryGraphStore,
        entityExtractor: { extract }, llm: provider({ memory: [
          { id: '1', text: 'user prefers dark colors', evidence: { kind: 'stated', durability: 'durable', sourceQuote: 'I prefer dark colors' } },
          { id: '2', text: 'user likes yellow', evidence: { kind: 'inferred', durability: 'tentative' } },
        ], entities: [{ name: 'Yellow', type: 'CONCEPT' }],
        relations: [{ source: 'user', relationship: 'likes', destination: 'Yellow' }],
      }) });
    expect(items).toHaveLength(1);
    expect(extract).toHaveBeenCalledWith('user prefers dark colors');
    expect(memoryEntityStore.upsertAndLink).not.toHaveBeenCalled();
    expect(memoryGraphStore.upsertEdges).not.toHaveBeenCalled();
  });

  test('drop and downgrade decisions are observable without logging source text', () => {
    const exporter = new InMemorySpanExporter();
    const tracing = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    const tracer = tracing.getTracer('evidence-test');
    prepareExtractedEvidence([
      { text: 'user likes yellow', evidence: { kind: 'inferred', durability: 'tentative' } },
      { text: 'user prefers blue', evidence: { kind: 'stated', durability: 'durable', sourceQuote: 'invented source' } },
    ], [{ role: 'user', content: 'A conversation' }], tracer);
    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(['extraction_evidence_dropped', 'extraction_evidence_downgraded']);
    expect(spans.map((span) => span.attributes)).toEqual([{ reason: 'tentative' }, { reason: 'ungrounded_source' }]);
  });

  test('strict verbatim writes also report incomplete persistence', async () => {
    const { memory, vectorStore } = await fixture({});
    vi.spyOn(vectorStore, 'insert').mockResolvedValue([]);
    await expect(memory.user('alice').remember('A known fact', { infer: false, strictExtraction: true }))
      .rejects.toThrow('persistence was incomplete');
  });

  test('strict extraction reports missing embeddings and incomplete writes', async () => {
    const llm = provider({ memory: [{ id: '1', text: 'user prefers dark colors' }] });
    const vectorStore = new InMemoryVectorStore();
    const messages = [{ role: 'user' as const, content: 'I prefer dark colors' }];
    await expect(runExtractionPipeline(messages, { user_id: 'alice' }, {
      vectorStore, llm, embedder: { ...embedder, embedBatch: async () => [[]] },
    }, { strictExtraction: true })).rejects.toThrow('embeddings');
    vi.spyOn(vectorStore, 'insert').mockResolvedValue([]);
    await expect(runExtractionPipeline(messages, { user_id: 'alice' }, {
      vectorStore, llm, embedder,
    }, { strictExtraction: true })).rejects.toThrow('persistence was incomplete');
  });
});

describe('remember — a fact about a named person keeps that person (#257)', () => {
  test('stores the person the draft relation names, not user', async () => {
    const { memory } = await fixture({
      memory: [{ id: '1', text: 'user travaille comme apicultrice', evidence: { kind: 'stated', durability: 'durable', sourceQuote: 'Perrine travaille comme apicultrice.' } }],
      entities: [{ name: 'Perrine', type: 'PERSON' }, { name: 'apicultrice', type: 'CONCEPT' }],
      relations: [{ source: 'Perrine', relationship: 'travaille comme', destination: 'apicultrice' }],
    });

    const items = await memory.user('alice').remember('Perrine travaille comme apicultrice.');

    expect(items.map((i) => i.text)).toEqual(['Perrine travaille comme apicultrice']);
  });
});
