/**
 * Importance scoring on write (#238): with `importanceScoring`, every newly stored fact gets a
 * [0, 1] importance from one short LLM rating, written by id inside the write's scope. A failed
 * rating leaves the fact stored and unscored, and says so.
 */
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from './constants.js';
import type { Embedder } from './dip/embedder.js';
import type { LLM } from './dip/llm.js';
import type { Message } from './message.js';
import { runExtractionPipeline } from './extraction/pipeline.js';
import { scoreNewFacts } from './extraction/importance-scoring.js';
import { InMemoryVectorStore } from '../infrastructure/db/in-memory-store.js';
import type { Filters } from './scope.js';

const SCOPE: Filters = { user_id: 'anna' };
const embedder: Embedder = {
  embed: vi.fn(async () => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0))),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0)))),
};
const isRating = (messages: readonly Message[]): boolean => /importance rater/.test(messages[0]?.content ?? '');

function llmWith(facts: readonly string[], rating: string): { llm: LLM; ratings: () => number } {
  let ratings = 0;
  const llm: LLM = {
    generateResponse: vi.fn(async () => ({ memory: facts.map((text, i) => ({ id: String(i), text })) })),
    generateChat: vi.fn(async (messages: readonly Message[]) => {
      if (isRating(messages)) ratings += 1;
      return { role: 'assistant' as const, content: isRating(messages) ? rating : '' };
    }),
  };
  return { llm, ratings: () => ratings };
}

const setupTracer = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
};

describe('runExtractionPipeline importance scoring', () => {
  test('rates each new fact once and stores the [0, 1] importance on it', async () => {
    const store = new InMemoryVectorStore();
    const { llm, ratings } = llmWith(['user lives in Lisbon', 'user owns a cat'], '8');
    const items = await runExtractionPipeline([{ role: 'user', content: 'x' }], SCOPE,
      { vectorStore: store, embedder, llm, importanceScoring: true });
    expect(ratings()).toBe(2);
    for (const item of items) {
      expect(item.llmImportanceScore).toBeCloseTo(7 / 9);
      expect(await store.getImportanceByHash(item.hash)).toBeCloseTo(7 / 9);
    }
  });

  test('is off by default: no rating call and no importance', async () => {
    const { llm, ratings } = llmWith(['user lives in Lisbon'], '8');
    const [item] = await runExtractionPipeline([{ role: 'user', content: 'x' }], SCOPE,
      { vectorStore: new InMemoryVectorStore(), embedder, llm });
    expect(ratings()).toBe(0);
    expect(item?.llmImportanceScore ?? null).toBeNull();
  });

  test('scoreNewFacts skips a fact the store merged into an existing row', async () => {
    const store = new InMemoryVectorStore();
    const { llm, ratings } = llmWith([], '8');
    const [item] = await runExtractionPipeline([{ role: 'user', content: 'x' }], SCOPE,
      { vectorStore: store, embedder, llm: llmWith(['user lives in Lisbon'], '8').llm });
    const out = await scoreNewFacts([item!], [{ id: item!.id, confirmationCount: 2, rejectedAsDuplicate: true }], SCOPE, store, llm, undefined);
    expect(ratings()).toBe(0);
    expect(out[0]?.llmImportanceScore ?? null).toBeNull();
  });

  test('a failed rating keeps the fact, leaves it unscored and emits importance_scoring_failed', async () => {
    const { tracer, exporter } = setupTracer();
    const { llm } = llmWith(['user lives in Lisbon'], 'no idea');
    const items = await runExtractionPipeline([{ role: 'user', content: 'x' }], SCOPE,
      { vectorStore: new InMemoryVectorStore(), embedder, llm, importanceScoring: true, tracer });
    expect(items).toHaveLength(1);
    expect(items[0]?.llmImportanceScore ?? null).toBeNull();
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain('importance_scoring_failed');
  });

  test('a successful pass emits importance_scored', async () => {
    const { tracer, exporter } = setupTracer();
    const { llm } = llmWith(['user lives in Lisbon'], '3');
    await runExtractionPipeline([{ role: 'user', content: 'x' }], SCOPE,
      { vectorStore: new InMemoryVectorStore(), embedder, llm, importanceScoring: true, tracer });
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain('importance_scored');
  });
});

describe('InMemoryVectorStore.setImportance', () => {
  test('writes only inside the given scope', async () => {
    const store = new InMemoryVectorStore();
    const { llm } = llmWith(['user lives in Lisbon'], '8');
    const [item] = await runExtractionPipeline([{ role: 'user', content: 'x' }], SCOPE, { vectorStore: store, embedder, llm });
    expect(await store.setImportance({ user_id: 'bruno' }, item!.id, 0.9)).toBe(false);
    expect(await store.getImportanceByHash(item!.hash)).toBeNull();
    expect(await store.setImportance(SCOPE, item!.id, 0.9)).toBe(true);
    expect(await store.getImportanceByHash(item!.hash)).toBeCloseTo(0.9);
  });
});
