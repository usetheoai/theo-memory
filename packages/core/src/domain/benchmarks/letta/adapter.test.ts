/**
 * T6.3 RED tests for LettaBenchmarkAdapter.
 *
 * @see plan v1.2 § T6.3 + ADRs D5 / D6 / Drift-T5.1-1 / Drift-T6.x-1
 */
import { describe, expect, it } from 'vitest';

import type { Tokenizer } from '../../dip/tokenizer.js';

import { LettaBenchmarkAdapter, type LettaVendorClient } from './adapter.js';

const tokenizer: Tokenizer = {
  count: (s: string) => Math.ceil(s.length / 4),
};

class StubLettaClient implements LettaVendorClient {
  readonly adds: { agentId: string; text: string }[] = [];
  add(agentId: string, text: string): Promise<void> {
    this.adds.push({ agentId, text });
    return Promise.resolve();
  }
  search(
    _agentId: string,
    query: string,
    _topK: number,
  ): Promise<readonly { text: string; score: number }[]> {
    return Promise.resolve([{ text: `REDACTED hit for ${query}`, score: 0.8 }]);
  }
  synthesize(question: string, _context: readonly string[]): Promise<string> {
    return Promise.resolve(`REDACTED answer: ${question}`);
  }
}

describe('LettaBenchmarkAdapter', () => {
  it('exposes adapter name "REDACTED"', () => {
    const adapter = new LettaBenchmarkAdapter({ client: new StubLettaClient(), tokenizer });
    expect(adapter.name).toBe('REDACTED');
  });

  it('add() forwards each item to client.add() under conversationId agentId', async () => {
    const client = new StubLettaClient();
    const adapter = new LettaBenchmarkAdapter({ client, tokenizer });
    await adapter.add({
      conversationId: 'agent-42',
      items: [
        { id: 'i1', text: 'mem 1', timestamp: new Date(), metadata: {} },
        { id: 'i2', text: 'mem 2', timestamp: new Date(), metadata: {} },
      ],
    });
    expect(client.adds).toEqual([
      { agentId: 'agent-42', text: 'mem 1' },
      { agentId: 'agent-42', text: 'mem 2' },
    ]);
  });

  it('search() returns SearchResult with modelUsed surfaced from config', async () => {
    const adapter = new LettaBenchmarkAdapter({
      client: new StubLettaClient(),
      tokenizer,
      modelId: 'gpt-4o-mini',
    });
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'q?',
      conversationId: 'agent-42',
      goldAnswer: 'a',
      category: 'misc',
    });
    expect(result.modelUsed).toBe('gpt-4o-mini');
    expect(result.answer).toMatch(/REDACTED answer:/);
  });

  it('search() returns non-negative latencyMs + non-zero tokensUsed.prompt', async () => {
    const adapter = new LettaBenchmarkAdapter({ client: new StubLettaClient(), tokenizer });
    const result = await adapter.search({
      questionId: 'q1',
      questionText: 'q?',
      conversationId: 'agent-42',
      goldAnswer: 'a',
      category: 'misc',
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.tokensUsed.prompt).toBeGreaterThan(0);
  });
});
