/**
 * M27 T1.2 + T2.1 (pipeline-level) — durable-fact quality on the infer:true path.
 *
 * Proves the backstop gate is WIRED into runExtractionPipeline: a stubbed LLM that
 * (despite the T1.1 prompt) still emits a question has that draft dropped before persist,
 * with an `extraction_fact_gate_dropped` audit event; a clean multi-fact batch persists
 * every atomic fact unchanged.
 */
import { describe, expect, test, vi } from 'vitest';

import { InMemoryVectorStore } from '../../infrastructure/db/in-memory-store.js';
import { MAX_EMBEDDING_DIM } from '../constants.js';
import type { Embedder } from '../dip/embedder.js';
import type { LLM } from '../dip/llm.js';
import { runExtractionPipeline } from './pipeline.js';

const vec = (): readonly number[] => {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  v[0] = 0.1;
  return v;
};
const embedder = (): Embedder => ({
  embed: vi.fn(async () => vec()),
  embedBatch: vi.fn(async (t: readonly string[]) => t.map(() => vec())),
});
const llmEmitting = (memory: unknown): LLM => ({
  generateResponse: vi.fn(async () => ({ memory })),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

async function run(memory: unknown[], tracer?: unknown): ReturnType<typeof runExtractionPipeline> {
  return runExtractionPipeline(
    [{ role: 'assistant', content: 'turn' }],
    { user_id: 'alice' },
    {
      vectorStore: new InMemoryVectorStore(),
      embedder: embedder(),
      llm: llmEmitting(memory),
      ...(tracer !== undefined ? { tracer: tracer as never } : {}),
    },
  );
}

describe('extraction fact quality — pipeline (M27)', () => {
  test('the backstop gate drops a question draft before persist (only the declarative survives)', async () => {
    const result = await run([
      { id: '0', text: 'Quer que eu prossiga com o escopo estreito…?' },
      { id: '1', text: 'user migrou o auth para JWT' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('user migrou o auth para JWT');
  });

  test('a clean multi-fact batch persists every atomic fact (no over-filtering)', async () => {
    const result = await run([
      { id: '0', text: 'hono foi atualizado de 4.12.25 para 4.12.31' },
      { id: '1', text: 'O alvo de deploy é container Linux' },
      { id: '2', text: 'user prefere café torra escura' },
    ]);
    expect(result).toHaveLength(3);
  });

  test('emits extraction_fact_gate_dropped when a draft is gated (Princípio 3)', async () => {
    const events: string[] = [];
    const span = { setAttribute: () => {}, setStatus: () => {}, recordException: () => {}, end: () => {} };
    const tracer = {
      startActiveSpan: (name: string, cb: (s: typeof span) => unknown) => {
        events.push(name);
        return cb(span);
      },
    };
    await run([{ id: '0', text: 'Shall I proceed?' }, { id: '1', text: 'user usa pnpm' }], tracer);
    expect(events).toContain('extraction_fact_gate_dropped');
  });
});
