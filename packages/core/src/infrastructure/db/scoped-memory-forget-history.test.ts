/**
 * Forget and the audit trail (#236): a history failure never blocks a forget, but it is an
 * observable event instead of a silent swallow; a hard forget records nothing, because the
 * erasure removes the memory's history by cascade.
 */
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { HistoryManager } from '../../domain/dip/history-manager.js';
import type { LLM } from '../../domain/dip/llm.js';

import { InMemoryVectorStore } from './in-memory-store.js';
import { createLocalMemory } from './index.js';

const vector = (): readonly number[] => new Array<number>(MAX_EMBEDDING_DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0));
const embedder: Embedder = { embed: () => Promise.resolve(vector()), embedBatch: (t) => Promise.resolve(t.map(vector)) };
const llm: LLM = {
  generateResponse: () => Promise.resolve({ memory: [{ id: '0', text: 'user likes tea' }] }),
  generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
};

function history(addHistory: HistoryManager['addHistory']): HistoryManager {
  return { addHistory, getHistory: () => Promise.resolve([]), reset: () => Promise.resolve(), close: () => undefined };
}

/** Records remember normally and fails only the forget row, so the event can only come from forget. */
const failOnForget: HistoryManager['addHistory'] = (_id, _prev, _next, action) =>
  action === 'forget' ? Promise.reject(new Error('history down')) : Promise.resolve();

async function setup(addHistory: HistoryManager['addHistory']) {
  const exporter = new InMemorySpanExporter();
  const tracer = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).getTracer('test');
  const memory = await createLocalMemory({ vectorStore: new InMemoryVectorStore(), embedder, llm, embeddingDim: MAX_EMBEDDING_DIM,
    historyManager: history(addHistory), tracer });
  const [item] = await memory.user('anna').remember('I like tea');
  return { memory, item: item!, events: () => exporter.getFinishedSpans().map((span) => span.name) };
}

describe('forget and history', () => {
  test('a scoped forget whose history write fails still forgets, and the failure is an event', async () => {
    const { memory, item, events } = await setup(failOnForget);
    await memory.user('anna').forget(item.id);
    expect(await memory.user('anna').getAll()).toEqual([]);
    expect(events()).toContain('history_persist_failed');
  });

  test('a global forget whose history write fails still forgets, and the failure is an event', async () => {
    const { memory, item, events } = await setup(failOnForget);
    await memory.forget(item.id);
    expect(await memory.get(item.id)).toBeNull();
    expect(events()).toContain('history_persist_failed');
  });

  test('a hard forget records no history row: the erasure removes the memory history by cascade', async () => {
    const addHistory = vi.fn().mockResolvedValue(undefined);
    const { memory, item } = await setup(addHistory);
    addHistory.mockClear();
    await memory.user('anna').forget(item.id, { hard: true });
    expect(addHistory).not.toHaveBeenCalled();
  });
});
