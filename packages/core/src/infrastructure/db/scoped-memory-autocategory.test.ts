/**
 * Fixes-cycle-1 (F-H1) — the auto-categorization off-switch + default-on must be
 * reachable through the PUBLIC factory (`createLocalMemory` → `LocalMemoryConfig.autoCategorize`),
 * not only by injecting `ExtractionDeps` directly. Exercised against the real
 * InMemoryVectorStore (in-process, no I/O) so it runs in the always-on contract suite.
 *
 * @see .claude/knowledge-base/reviews/auto-categorization-write-pipeline-review-2026-07-12.md § F-H1
 */
import { describe, expect, test, vi } from 'vitest';

import type { Embedder, LLM } from '../../index.js';
import { createLocalMemory } from '../../index.js';
import { InMemoryVectorStore } from './in-memory-store.js';

const DIM = 1536;
function mkEmbedder(): Embedder {
  const vec = (): readonly number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[0] = 1;
    return v;
  };
  return { embed: vi.fn(async () => vec()), embedBatch: vi.fn(async (t: readonly string[]) => t.map(() => vec())) };
}
// An LLM that always emits a per-fact category='work'.
function categorizingLlm(): LLM {
  return {
    generateResponse: vi.fn(async () => ({ memory: [{ id: '0', text: 'a fact', attributed_to: 'user', category: 'work' }] })),
    generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
  };
}

async function rememberedCategory(autoCategorize?: { enabled?: boolean }): Promise<string | undefined> {
  const memory = await createLocalMemory({
    vectorStore: new InMemoryVectorStore(),
    embedder: mkEmbedder(),
    llm: categorizingLlm(),
    ...(autoCategorize !== undefined ? { autoCategorize } : {}),
  });
  const items = await memory.user('alice').remember('some input');
  return items[0]?.metadata?.['category'] as string | undefined;
}

describe('auto-categorization through the public factory (F-H1)', () => {
  test('test_factory_default_on_autocategorizes', async () => {
    // No autoCategorize config → default-on → the LLM category lands.
    expect(await rememberedCategory()).toBe('work');
  });

  test('test_factory_off_switch_disables_autocategory', async () => {
    // autoCategorize.enabled:false MUST be reachable via createLocalMemory and
    // restore operator-only behavior (no auto category).
    expect(await rememberedCategory({ enabled: false })).toBeUndefined();
  });
});
