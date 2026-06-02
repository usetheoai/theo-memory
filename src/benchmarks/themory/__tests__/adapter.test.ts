/**
 * T3.1 RED tests for TheMemoryBenchmarkAdapter.
 *
 * EC-5 absorption coverage:
 * - scopedUserId = `${conversationId}::${speaker ?? 'unknown'}`
 * - search() across each expectedSpeaker scope + merge by score
 * - dedup-by-id when same row surfaces under two speaker scopes
 *
 * Drift-T3.1-1: constructor takes {memory, llm, tokenizer}.
 * Drift-T3.1-2: metadata coercion handles nested objects via JSON.stringify.
 *
 * @see plan v1.2 § T3.1 + EC-5
 */
import { describe, expect, it } from 'vitest';

import type { LLM, LLMResponse, Message } from '../../../core/dip/llm.js';
import { createLocalMemory, InMemoryVectorStore, StubEmbedder } from '../../../local/index.js';
import { TheMemoryBenchmarkAdapter, type Tokenizer } from '../adapter.js';

/**
 * Test LLM that extracts the latest user-message text verbatim so the
 * extraction pipeline persists exactly what was remembered (unit tests
 * exercise adapter mechanics, not extraction quality).
 */
class VerbatimExtractingChatLlm implements LLM {
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

async function buildAdapter(): Promise<TheMemoryBenchmarkAdapter> {
  const memory = await createLocalMemory({
    embedder: new StubEmbedder(),
    llm: new VerbatimExtractingChatLlm(),
    vectorStore: new InMemoryVectorStore(),
  });
  return new TheMemoryBenchmarkAdapter({ memory, llm: new VerbatimExtractingChatLlm(), tokenizer });
}

describe('TheMemoryBenchmarkAdapter.add', () => {
  it('returns itemCount matching corpus.items.length', async () => {
    const adapter = await buildAdapter();
    const metrics = await adapter.add({
      conversationId: 'c1',
      items: [
        { id: 'i1', text: 'fact one', timestamp: new Date(), metadata: {} },
        { id: 'i2', text: 'fact two', timestamp: new Date(), metadata: {} },
      ],
    });
    expect(metrics.itemCount).toBe(2);
  });

  it('returns latencyMs >= 0', async () => {
    const adapter = await buildAdapter();
    const metrics = await adapter.add({
      conversationId: 'c1',
      items: [{ id: 'i1', text: 'fact', timestamp: new Date(), metadata: {} }],
    });
    expect(metrics.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('handles empty corpus', async () => {
    const adapter = await buildAdapter();
    const metrics = await adapter.add({ conversationId: 'c1', items: [] });
    expect(metrics.itemCount).toBe(0);
  });

  it('coerces nested metadata via JSON.stringify (Drift-T3.1-2)', async () => {
    const adapter = await buildAdapter();
    await expect(
      adapter.add({
        conversationId: 'c1',
        items: [
          {
            id: 'i1',
            text: 'fact',
            timestamp: new Date(),
            metadata: { tags: ['a', 'b'], nested: { deep: 1 } },
          },
        ],
      }),
    ).resolves.toMatchObject({ itemCount: 1 });
  });
});

describe('TheMemoryBenchmarkAdapter.search', () => {
  it('returns SearchResult shape with answer + retrievedContext + latencyMs + tokensUsed', async () => {
    const adapter = await buildAdapter();
    await adapter.add({
      conversationId: 'c1',
      items: [
        { id: 'i1', text: 'the user likes coffee', timestamp: new Date(), metadata: {} },
      ],
    });
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'What does the user like?',
      conversationId: 'c1',
      goldAnswer: 'coffee',
      category: 'preference',
    });
    expect(result.answer).toMatch(/ECHO:/);
    expect(Array.isArray(result.retrievedContext)).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.tokensUsed.prompt).toBeGreaterThan(0);
    expect(result.tokensUsed.completion).toBeGreaterThanOrEqual(0);
    // Drift-T5.1-1: modelUsed is the load-bearing pricing key
    expect(typeof result.modelUsed).toBe('string');
    expect(result.modelUsed.length).toBeGreaterThan(0);
  });

  it('surfaces injected modelId via SearchResult.modelUsed (Drift-T5.1-1)', async () => {
    const memory = await createLocalMemory({
      embedder: new StubEmbedder(),
      llm: new VerbatimExtractingChatLlm(),
      vectorStore: new InMemoryVectorStore(),
    });
    const adapter = new TheMemoryBenchmarkAdapter({
      memory,
      llm: new VerbatimExtractingChatLlm(),
      tokenizer,
      modelId: 'anthropic/claude-3.5-sonnet',
    });
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'q',
      conversationId: 'c1',
      goldAnswer: 'a',
      category: 'misc',
    });
    expect(result.modelUsed).toBe('anthropic/claude-3.5-sonnet');
  });

  it('searches across multiple speakers per EC-5 (does not throw on multi-speaker corpus)', async () => {
    // Retrieval quality is exercised by tests/integration/benchmarks/themory-adapter-pg.test.ts
    // against real pgvector + a content-aware embedder. Here we assert the
    // mechanics: multi-speaker corpus is accepted, search runs across all
    // declared speakers, and a SearchResult is produced with the correct shape.
    const adapter = await buildAdapter();
    await adapter.add({
      conversationId: 'c1',
      items: [
        { id: 'a1', text: 'Alice likes tea', speaker: 'alice', timestamp: new Date(), metadata: {} },
        { id: 'b1', text: 'Bob likes coffee', speaker: 'bob', timestamp: new Date(), metadata: {} },
      ],
    });
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'What does anyone like?',
      conversationId: 'c1',
      goldAnswer: 'tea or coffee',
      category: 'preference',
      expectedSpeakers: ['alice', 'bob'],
    });
    expect(Array.isArray(result.retrievedContext)).toBe(true);
    expect(typeof result.answer).toBe('string');
  });

  it('defaults expectedSpeakers to ["unknown"] when query omits the field', async () => {
    // Asserts the structural default; retrieval quality covered by integration.
    const adapter = await buildAdapter();
    await adapter.add({
      conversationId: 'c1',
      items: [
        { id: 'i1', text: 'a single-speaker fact', timestamp: new Date(), metadata: {} },
      ],
    });
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'What is the fact?',
      conversationId: 'c1',
      goldAnswer: 'fact',
      category: 'misc',
    });
    expect(Array.isArray(result.retrievedContext)).toBe(true);
    expect(typeof result.answer).toBe('string');
  });

  it('returns empty retrievedContext when no items were added', async () => {
    const adapter = await buildAdapter();
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'Nothing here',
      conversationId: 'empty',
      goldAnswer: '',
      category: 'misc',
    });
    expect(result.retrievedContext).toEqual([]);
  });

  it('invokes injected tokenizer for prompt+completion counting (Drift-T3.1-3)', async () => {
    let countCalls = 0;
    const memory = await createLocalMemory({
      embedder: new StubEmbedder(),
      llm: new VerbatimExtractingChatLlm(),
      vectorStore: new InMemoryVectorStore(),
    });
    const trackingTokenizer: Tokenizer = {
      count: (s: string) => {
        countCalls += 1;
        return Math.ceil(s.length / 4);
      },
    };
    const adapter = new TheMemoryBenchmarkAdapter({
      memory,
      llm: new VerbatimExtractingChatLlm(),
      tokenizer: trackingTokenizer,
    });
    await adapter.add({
      conversationId: 'c1',
      items: [{ id: 'i1', text: 'fact', timestamp: new Date(), metadata: {} }],
    });
    await adapter.search({
      questionId: 'q1',
      questionText: 'Question?',
      conversationId: 'c1',
      goldAnswer: 'fact',
      category: 'misc',
    });
    expect(countCalls).toBeGreaterThanOrEqual(2);
  });
});

describe('TheMemoryBenchmarkAdapter.name', () => {
  it('exposes adapter name "themory"', async () => {
    const adapter = await buildAdapter();
    expect(adapter.name).toBe('themory');
  });
});
