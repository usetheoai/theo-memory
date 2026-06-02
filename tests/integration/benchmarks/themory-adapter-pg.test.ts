/**
 * T3.1 integration test for TheMemoryBenchmarkAdapter against real
 * pgvector + content-aware embedder + content-aware LLM.
 *
 * Gated on THEOMEM_PG_URI per the established `describe.skipIf` pattern
 * (skill-isolation.test.ts:44 precedent + EC-14 absorption).
 *
 * Verifies the end-to-end add() + search() flow: corpus seeded under
 * scoped (conversationId::speaker) user ids, cross-speaker recall
 * surfaces the seeded text, LLM-synthesized answer references the
 * retrieved context.
 *
 * @see plan v1.2 § T3.1
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { mockEmbedding } from '../../../src/__tests__/_helpers/mock-embedding.js';
import type { LLM, LLMResponse, Message } from '../../../src/core/dip/llm.js';
import { createLocalMemory, PgvectorStore } from '../../../src/local/index.js';
import { TheMemoryBenchmarkAdapter, type Tokenizer } from '../../../src/benchmarks/themory/adapter.js';

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

class ContentEchoLlm implements LLM {
  private nextId = 0;
  generateResponse(messages: readonly Message[]): Promise<unknown> {
    const last = messages.at(-1)?.content ?? '';
    const id = String(this.nextId);
    this.nextId += 1;
    return Promise.resolve({ memory: [{ id, text: last }] });
  }
  generateChat(messages: readonly Message[]): Promise<LLMResponse> {
    const last = messages.at(-1)?.content ?? '';
    return Promise.resolve({ role: 'assistant', content: `ECHO: ${last}` });
  }
}

const tokenizer: Tokenizer = {
  count: (s: string) => Math.ceil(s.length / 4),
};

describe.skipIf(PG_URI === '')('TheMemoryBenchmarkAdapter — pgvector integration', () => {
  let pool: pg.Pool;
  const TEST_CONVERSATION = 't3-1-integration-conv';

  async function reset(): Promise<void> {
    await pool.query(`DELETE FROM memories WHERE agent_id LIKE $1`, [`${TEST_CONVERSATION}::%`]);
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: PG_URI });
  });
  afterAll(async () => {
    await reset();
    await pool.end();
  });
  beforeEach(async () => {
    await reset();
  });

  it('seeds + recalls a multi-speaker corpus end-to-end', async () => {
    const memory = await createLocalMemory({
      vectorStore: new PgvectorStore(pool),
      embedder: { embed: async (t: string) => mockEmbedding(t), embedBatch: async (ts) => ts.map(mockEmbedding) },
      llm: new ContentEchoLlm(),
    });
    const adapter = new TheMemoryBenchmarkAdapter({
      memory,
      llm: new ContentEchoLlm(),
      tokenizer,
    });

    await adapter.add({
      conversationId: TEST_CONVERSATION,
      items: [
        { id: 'a1', text: 'Alice loves cycling on weekends', speaker: 'alice', timestamp: new Date(), metadata: {} },
        { id: 'b1', text: 'Bob is a passionate baker', speaker: 'bob', timestamp: new Date(), metadata: {} },
      ],
    });

    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'cycling',
      conversationId: TEST_CONVERSATION,
      goldAnswer: 'Alice loves cycling',
      category: 'preference',
      expectedSpeakers: ['alice', 'bob'],
    });

    expect(result.answer).toMatch(/ECHO:/);
    expect(result.retrievedContext.length).toBeGreaterThanOrEqual(1);
    expect(result.tokensUsed.prompt).toBeGreaterThan(0);

    await memory.dispose();
  });
});
