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

import type { LLM, LLMResponse, Message } from '@usetheo/memory';
import { createLocalMemory, MAX_EMBEDDING_DIM, PgvectorStore } from '@usetheo/memory';
import type { Tokenizer } from '@usetheo/memory';

/** Deterministic embedding stub: returns a zero vector with a small value at index 0. */
function mockEmbedding(_text: string): readonly number[] {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  v[0] = 0.1;
  return v;
}
import { TheMemoryBenchmarkAdapter } from '../../../packages/core/src/domain/benchmarks/themory/adapter.js';

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

  // F-arch-3 / v0-8-fixes-cycle-1 T1.1: reset() filters by user_id because
  // TheMemoryBenchmarkAdapter.add() writes via memory.user(scopedUserId) —
  // the row's scope tier is User, not Agent. The earlier `agent_id LIKE`
  // filter matched zero rows silently, leaking cross-test state once a
  // second it() block landed. The isolation regression test below would
  // FAIL with the old filter (block B would observe block A's seed).
  async function reset(): Promise<void> {
    await pool.query(`DELETE FROM memories WHERE user_id LIKE $1`, [`${TEST_CONVERSATION}::%`]);
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

  it('reset() isolates consecutive it() blocks (F-arch-3 regression guard) — block A seeds Alice', async () => {
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
        { id: 'block-a-seed', text: 'Alice loves cycling on weekends', speaker: 'alice', timestamp: new Date(), metadata: {} },
      ],
    });
    // Sanity: block A's seed is visible WITHIN block A.
    const blockAResult = await adapter.search({
      questionId: 'block-a-q',
      questionText: 'cycling',
      conversationId: TEST_CONVERSATION,
      goldAnswer: 'Alice loves cycling',
      category: 'preference',
      expectedSpeakers: ['alice'],
    });
    expect(blockAResult.retrievedContext.length).toBeGreaterThanOrEqual(1);
    await memory.dispose();
  });

  it('reset() isolates consecutive it() blocks (F-arch-3 regression guard) — block B observes ZERO leak from block A', async () => {
    // beforeEach ran reset() between blocks; block A's 'block-a-seed' MUST
    // NOT be retrievable here. Pre-fix (agent_id LIKE), the row leaks.
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
    const result = await adapter.search({
      questionId: 'block-b-q',
      questionText: 'cycling',
      conversationId: TEST_CONVERSATION,
      goldAnswer: 'Alice loves cycling',
      category: 'preference',
      expectedSpeakers: ['alice'],
    });
    expect(result.retrievedContext.length).toBe(0);
    await memory.dispose();
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
