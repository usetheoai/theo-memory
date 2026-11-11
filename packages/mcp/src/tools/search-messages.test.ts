/**
 * `search_messages` tool: hybrid search over the raw message log (ADR-0031), bound to the
 * authenticated user like `recall`. Exercised over a real in-memory runtime.
 */
import { createLocalMemory, InMemoryMessageLog, InMemoryVectorStore } from '@usetheo/memory';
import type { Memory } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, it } from 'vitest';

import { dispatch } from './dispatch.js';
import { OUTPUT_SCHEMA } from './search-messages-schema.js';

const embedder = {
  embed: async (text: string) => [text.length, 1, 0],
  embedBatch: async (texts: readonly string[]) => texts.map((text) => [text.length, 1, 0]),
};
const noFacts = {
  generateResponse: async () => ({ memory: [] }),
  generateChat: async () => ({ role: 'assistant' as const, content: '' }),
};
const ALICE = { session: { userId: 'alice' } } as const;

async function build(messageLog: InMemoryMessageLog | false = new InMemoryMessageLog()): Promise<Memory> {
  return createLocalMemory({ vectorStore: new InMemoryVectorStore(), llm: noFacts, embedder, embeddingDim: 3, entityBoost: false, messageLog });
}

async function call(memory: Memory, args: unknown) {
  return withScope(ALICE, () => dispatch('search_messages', args, { memoryFactory: () => memory }));
}

describe('search_messages tool', () => {
  it("returns the authenticated user's turn that produced no memory", async () => {
    const memory = await build();
    await memory.user('alice').remember('Try chamomile tea before bed.');
    await memory.user('bob').remember('chamomile is my favourite');

    const result = await call(memory, { query: 'chamomile' });

    expect(result.isError ?? false).toBe(false);
    const sc = OUTPUT_SCHEMA.parse(result.structuredContent);
    expect(sc.messages.map((m) => m.content)).toEqual(['Try chamomile tea before bed.']);
    expect(sc.messages[0]!.score).toBeGreaterThan(0);
  });

  it("with sessionId, searches that session of the same user plus the user's global turns", async () => {
    const memory = await build();
    await memory.user('alice').remember('global tea');
    await memory.session('s1', 'alice').remember('session tea');
    await memory.session('s2', 'alice').remember('other tea');

    const sc = OUTPUT_SCHEMA.parse((await call(memory, { query: 'tea', sessionId: 's1' })).structuredContent);

    expect(sc.messages.map((m) => m.content).sort()).toEqual(['global tea', 'session tea']);
  });

  it('honors limit and rejects one above 100 as invalid params', async () => {
    const memory = await build();
    for (let i = 0; i < 4; i += 1) await memory.user('alice').remember(`tea ${String(i)}`);

    const sc = OUTPUT_SCHEMA.parse((await call(memory, { query: 'tea', limit: 2 })).structuredContent);
    expect(sc.messages).toHaveLength(2);
    await expect(call(memory, { query: 'tea', limit: 101 })).rejects.toThrow(/Invalid params/);
  });

  it('reports an empty result as text, not an error', async () => {
    const result = await call(await build(), { query: 'volcano' });
    expect(result.isError ?? false).toBe(false);
    expect(OUTPUT_SCHEMA.parse(result.structuredContent).messages).toEqual([]);
  });

  it('a runtime without the message log answers a self-correctable execution error', async () => {
    const result = await call(await build(false), { query: 'tea' });
    expect(result.isError).toBe(true);
  });
});
