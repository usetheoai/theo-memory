/**
 * T6.2 RED tests for ZepBenchmarkAdapter.
 *
 * @see plan v1.2 § T6.2 + ADRs D5 / D6 / Drift-T5.1-1 / Drift-T6.x-1
 */
import { describe, expect, it } from 'vitest';

import type { Tokenizer } from '../../dip/tokenizer.js';

import { ZepBenchmarkAdapter, type ZepVendorClient } from './adapter.js';

const tokenizer: Tokenizer = {
  count: (s: string) => Math.ceil(s.length / 4),
};

class StubZepClient implements ZepVendorClient {
  readonly adds: { sessionId: string; text: string }[] = [];
  add(sessionId: string, text: string): Promise<void> {
    this.adds.push({ sessionId, text });
    return Promise.resolve();
  }
  search(
    _sessionId: string,
    query: string,
    _topK: number,
  ): Promise<readonly { text: string; score: number }[]> {
    return Promise.resolve([{ text: `zep hit for ${query}`, score: 0.85 }]);
  }
  synthesize(question: string, _context: readonly string[]): Promise<string> {
    return Promise.resolve(`zep answer: ${question}`);
  }
}

describe('ZepBenchmarkAdapter', () => {
  it('exposes adapter name "zep"', () => {
    const adapter = new ZepBenchmarkAdapter({ client: new StubZepClient(), tokenizer });
    expect(adapter.name).toBe('zep');
  });

  it('add() forwards each item to client.add() under conversationId sessionId', async () => {
    const client = new StubZepClient();
    const adapter = new ZepBenchmarkAdapter({ client, tokenizer });
    await adapter.add({
      conversationId: 'session-1',
      items: [
        { id: 'i1', text: 'fact 1', timestamp: new Date(), metadata: {} },
        { id: 'i2', text: 'fact 2', timestamp: new Date(), metadata: {} },
      ],
    });
    expect(client.adds).toEqual([
      { sessionId: 'session-1', text: 'fact 1' },
      { sessionId: 'session-1', text: 'fact 2' },
    ]);
  });

  it('search() returns SearchResult with modelUsed surfaced from config', async () => {
    const adapter = new ZepBenchmarkAdapter({
      client: new StubZepClient(),
      tokenizer,
      modelId: 'gpt-4o',
    });
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'q?',
      conversationId: 'session-1',
      goldAnswer: 'a',
      category: 'misc',
    });
    expect(result.modelUsed).toBe('gpt-4o');
    expect(result.answer).toMatch(/zep answer:/);
  });

  it('search() returns non-negative latencyMs + non-zero tokensUsed.prompt', async () => {
    const adapter = new ZepBenchmarkAdapter({ client: new StubZepClient(), tokenizer });
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'q?',
      conversationId: 'session-1',
      goldAnswer: 'a',
      category: 'misc',
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.tokensUsed.prompt).toBeGreaterThan(0);
  });
});
