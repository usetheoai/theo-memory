/**
 * T6.1 RED tests for Mem0BenchmarkAdapter.
 *
 * @see plan v1.2 § T6.1 + ADRs D5 / D6 / Drift-T5.1-1 / Drift-T6.x-1
 */
import { describe, expect, it } from 'vitest';

import type { Tokenizer } from '../../../dip/tokenizer.js';
import { Mem0BenchmarkAdapter, type Mem0VendorClient } from '../adapter.js';

const tokenizer: Tokenizer = {
  count: (s: string) => Math.ceil(s.length / 4),
};

class StubMem0Client implements Mem0VendorClient {
  readonly adds: { userId: string; text: string }[] = [];
  readonly searches: { userId: string; query: string; topK: number }[] = [];
  add(userId: string, text: string): Promise<void> {
    this.adds.push({ userId, text });
    return Promise.resolve();
  }
  search(
    userId: string,
    query: string,
    topK: number,
  ): Promise<readonly { text: string; score: number }[]> {
    this.searches.push({ userId, query, topK });
    return Promise.resolve([{ text: `match for ${query}`, score: 0.9 }]);
  }
  synthesize(question: string, _context: readonly string[]): Promise<string> {
    return Promise.resolve(`answer: ${question}`);
  }
}

describe('Mem0BenchmarkAdapter', () => {
  it('exposes adapter name "mem0"', () => {
    const adapter = new Mem0BenchmarkAdapter({ client: new StubMem0Client(), tokenizer });
    expect(adapter.name).toBe('mem0');
  });

  it('add() forwards items to client.add() under the conversationId userId', async () => {
    const client = new StubMem0Client();
    const adapter = new Mem0BenchmarkAdapter({ client, tokenizer });
    await adapter.add({
      conversationId: 'c1',
      items: [
        { id: 'i1', text: 't1', timestamp: new Date(), metadata: {} },
        { id: 'i2', text: 't2', timestamp: new Date(), metadata: {} },
      ],
    });
    expect(client.adds).toEqual([
      { userId: 'c1', text: 't1' },
      { userId: 'c1', text: 't2' },
    ]);
  });

  it('add() returns itemCount + non-negative latencyMs', async () => {
    const adapter = new Mem0BenchmarkAdapter({ client: new StubMem0Client(), tokenizer });
    const metrics = await adapter.add({
      conversationId: 'c1',
      items: [{ id: 'i1', text: 't1', timestamp: new Date(), metadata: {} }],
    });
    expect(metrics.itemCount).toBe(1);
    expect(metrics.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('search() returns SearchResult with answer + context + tokensUsed + modelUsed', async () => {
    const adapter = new Mem0BenchmarkAdapter({
      client: new StubMem0Client(),
      tokenizer,
      modelId: 'gpt-4o-mini',
    });
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'what is the answer?',
      conversationId: 'c1',
      goldAnswer: 'a',
      category: 'misc',
    });
    expect(result.answer).toMatch(/answer:/);
    expect(result.retrievedContext.length).toBeGreaterThan(0);
    expect(result.modelUsed).toBe('gpt-4o-mini');
    expect(result.tokensUsed.prompt).toBeGreaterThan(0);
  });

  it('search() defaults modelUsed when modelId omitted', async () => {
    const adapter = new Mem0BenchmarkAdapter({ client: new StubMem0Client(), tokenizer });
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'q?',
      conversationId: 'c1',
      goldAnswer: 'a',
      category: 'misc',
    });
    expect(typeof result.modelUsed).toBe('string');
    expect(result.modelUsed.length).toBeGreaterThan(0);
  });
});
