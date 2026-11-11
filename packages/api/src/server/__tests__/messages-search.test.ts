/**
 * GET /v1/scopes/:type/:id/messages/search — BM25 search over the scope's raw message log,
 * exercised end to end over a real in-memory runtime (no SDK mocks).
 */
import { createLocalMemory, InMemoryMessageLog, InMemoryVectorStore } from '@usetheo/memory';
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test } from 'vitest';

import { createServer } from '../index.js';

const embedder = {
  embed: async (text: string) => [text.length, 1, 0],
  embedBatch: async (texts: readonly string[]) => texts.map((text) => [text.length, 1, 0]),
};
const noFacts = {
  generateResponse: async () => ({ memory: [] }),
  generateChat: async () => ({ role: 'assistant' as const, content: '' }),
};

async function build(messageLog: InMemoryMessageLog | false = new InMemoryMessageLog()): Promise<Memory> {
  return createLocalMemory({ vectorStore: new InMemoryVectorStore(), llm: noFacts, embedder, embeddingDim: 3, entityBoost: false, messageLog });
}

async function search(memory: Memory, path: string): Promise<Response> {
  return createServer({ memory }).fetch(new Request(`http://localhost${path}`));
}

interface Body {
  items: { id: string; role: string; content: string; score: number; observed_at: string | null; logged_at: string }[];
}

describe('GET /v1/scopes/:type/:id/messages/search', () => {
  test('returns a turn that produced no memory, with its score and times', async () => {
    const memory = await build();
    await memory.user('ana').remember('If the insomnia continues, try chamomile tea.', { observedAt: new Date('2024-03-01T08:00:00Z') });
    await memory.user('ana').remember('The weather was lovely.');

    const res = await search(memory, '/v1/scopes/user/ana/messages/search?q=chamomile');

    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ role: 'user', content: 'If the insomnia continues, try chamomile tea.', observed_at: '2024-03-01T08:00:00.000Z' });
    expect(body.items[0]!.score).toBeGreaterThan(0);
  });

  test('honors limit', async () => {
    const memory = await build();
    for (let i = 0; i < 4; i += 1) await memory.user('ana').remember(`tea note ${String(i)}`);

    const body = (await (await search(memory, '/v1/scopes/user/ana/messages/search?q=tea&limit=2')).json()) as Body;

    expect(body.items).toHaveLength(2);
  });

  test('without a user Principal, a session search sees that session only', async () => {
    const memory = await build();
    await memory.user('ana').remember('global tea');
    await memory.session('s1', 'ana').remember('session tea');
    await memory.session('s2', 'ana').remember('other tea');

    const body = (await (await search(memory, '/v1/scopes/session/s1/messages/search?q=tea')).json()) as Body;

    expect(body.items.map((m) => m.content).sort()).toEqual(['session tea']);
  });

  test.each([
    ['missing q', '/v1/scopes/user/ana/messages/search'],
    ['limit 0', '/v1/scopes/user/ana/messages/search?q=tea&limit=0'],
    ['limit 101', '/v1/scopes/user/ana/messages/search?q=tea&limit=101'],
    ['invalid asOf', '/v1/scopes/user/ana/messages/search?q=tea&asOf=yesterday'],
    ['unknown parameter', '/v1/scopes/user/ana/messages/search?q=tea&topK=3'],
  ])('rejects %s with 422', async (_name, path) => {
    const res = await search(await build(), path);
    expect(res.status).toBe(422);
  });

  test('an unknown scope type is 404', async () => {
    expect((await search(await build(), '/v1/scopes/repo/r/messages/search?q=tea')).status).toBe(404);
  });

  test('a runtime without the message log answers 501', async () => {
    const res = await search(await build(false), '/v1/scopes/user/ana/messages/search?q=tea');
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ code: 'MESSAGE_LOG_DISABLED' });
  });
});
