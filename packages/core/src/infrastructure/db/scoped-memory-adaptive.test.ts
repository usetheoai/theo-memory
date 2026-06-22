/**
 * Façade unit tests for the adaptive-retrieval Self-RAG `shouldRetrieve` gate
 * (Item 13 T3.1). Exercised against the real InMemoryVectorStore (in-process,
 * no I/O) so it runs in the always-on contract suite. Asserts:
 *   - shouldRetrieve=false ⇒ recall returns [] WITHOUT embedding (embed-spy 0)
 *   - shouldRetrieve throw ⇒ fail-soft, normal retrieval (never skips on error)
 *   - no retrievalPolicy ⇒ default path byte-unchanged (EC-3: option alone is a no-op)
 *
 * @see .claude/knowledge-base/plans/adaptive-retrieval-plan.md § T3.1 + ADR D2 + D4 + EC-3
 */
import { describe, expect, test, vi } from 'vitest';

import type { AdaptiveRetrievalPolicy } from '../../domain/dip/adaptive-retrieval-policy.js';
import type { Embedder, LLM } from '../../index.js';
import { createLocalMemory } from '../../index.js';
import { InMemoryVectorStore } from './in-memory-store.js';

const DIM = 1536;

function mkEmbedder(): Embedder & { embed: ReturnType<typeof vi.fn> } {
  // Constant unit vector for ALL text ⇒ cosine 1.0 for every (query, stored)
  // pair. Ranking quality is irrelevant for a GATE test — we only assert that
  // retrieval RUNS (returns the stored row) vs is SKIPPED.
  const vec = (): readonly number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[0] = 1;
    return v;
  };
  const embed = vi.fn(async () => vec());
  return {
    embed,
    embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => vec())),
  } as Embedder & { embed: ReturnType<typeof vi.fn> };
}

function echoLlm(): LLM {
  return {
    generateResponse: vi.fn(async (messages: readonly { role: string; content: string }[]) => {
      const content = messages.find((m) => m.role === 'user')?.content ?? '';
      const line = content.split('\n').find((l) => l.startsWith('user: ')) ?? '';
      const text = line.replace(/^user:\s*/, '') || content || 'fact';
      return { memory: [{ id: '0', text, attributed_to: 'user' }] };
    }),
    generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
  };
}

const alwaysSkip: AdaptiveRetrievalPolicy = {
  shouldRetrieve: async () => ({ retrieve: false, reason: 'no-retrieval-needed' }),
  assess: async () => ({ sufficient: true, action: 'accept' }),
};

const throwingGate: AdaptiveRetrievalPolicy = {
  shouldRetrieve: async () => {
    throw new Error('gate boom');
  },
  assess: async () => ({ sufficient: true, action: 'accept' }),
};

describe('adaptive-retrieval shouldRetrieve gate (façade)', () => {
  test('shouldRetrieve=false ⇒ recall returns [] WITHOUT embedding the query', async () => {
    const embedder = mkEmbedder();
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder,
      llm: echoLlm(),
      entityBoost: false,
      retrievalPolicy: alwaysSkip,
    });
    const session = memory.session('s1');
    await session.remember('I like dark mode');
    embedder.embed.mockClear(); // ignore the remember-path embed

    const results = await session.recall('anything');
    expect(results).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled(); // the skip avoided the embed
  });

  test('shouldRetrieve throws ⇒ fail-soft: normal retrieval, never skips on error', async () => {
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: mkEmbedder(),
      llm: echoLlm(),
      entityBoost: false,
      retrievalPolicy: throwingGate,
    });
    const session = memory.session('s1');
    await session.remember('I like dark mode');

    const results = await session.recall('dark mode');
    // fail-soft → the gate error is swallowed and retrieval runs normally.
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test('EC-3: no retrievalPolicy wired ⇒ default path retrieves normally', async () => {
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: mkEmbedder(),
      llm: echoLlm(),
      entityBoost: false,
    });
    const session = memory.session('s1');
    await session.remember('I like dark mode');

    const results = await session.recall('dark mode');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
