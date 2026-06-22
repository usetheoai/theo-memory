/**
 * T2.2 façade unit tests for LocalScopedMemory.episodes() — first-class-episodes (M2).
 *
 * Closes the review gap (F-tests-1 / F-xval-1): the façade carries logic NOT
 * covered by the store unit tests or the pgvector-gated GOAL test — the
 * asOf-NaN boundary guard, nextCursor computation, hasMore detection, and
 * composeFilters scope isolation. Exercised against the real InMemoryVectorStore
 * (in-process, no I/O) so it runs in the always-on contract suite.
 *
 * @see .claude/knowledge-base/plans/first-class-episodes-plan.md § T2.2
 */
import { describe, expect, test, vi } from 'vitest';

import type { Embedder, LLM } from '../../index.js';
import { createLocalMemory } from '../../index.js';
import { decodeEpisodeCursor } from '../../domain/episode.js';
import { InvalidScope } from '../../domain/errors.js';
import { InMemoryVectorStore } from './in-memory-store.js';

const DIM = 1536; // matches createLocalMemory's default dimension probe

function mkEmbedder(): Embedder {
  const vec = (t: string): readonly number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[t.length % DIM] = 1;
    return v;
  };
  return {
    embed: vi.fn(async (t: string) => vec(t)),
    embedBatch: vi.fn(async (texts: readonly string[]) => texts.map((t) => vec(t))),
  };
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

function buildMemory(): ReturnType<typeof createLocalMemory> {
  return createLocalMemory({
    vectorStore: new InMemoryVectorStore(),
    embedder: mkEmbedder(),
    llm: echoLlm(),
    entityBoost: false,
  });
}

async function rememberSeq(
  scoped: { remember: (t: string) => Promise<unknown> },
  texts: readonly string[],
): Promise<void> {
  for (const t of texts) {
     
    await scoped.remember(t);
  }
}

describe('LocalScopedMemory.episodes() façade', () => {
  test('asOf NaN throws InvalidScope BEFORE any query (boundary guard)', async () => {
    const memory = await buildMemory();
    await expect(memory.session('s1').episodes({ asOf: new Date('not-a-date') })).rejects.toThrow(
      InvalidScope,
    );
  });

  test('computes nextCursor when more rows follow; omits it on the last page', async () => {
    const memory = await buildMemory();
    const session = memory.session('s1');
    await rememberSeq(session, ['e1', 'e2', 'e3']);

    const firstPage = await session.episodes({ limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeDefined();
    // the cursor decodes to the last kept row's (created_at, id)
    const last = firstPage.items[firstPage.items.length - 1];
    if (last === undefined) throw new Error('expected an item');
    expect(decodeEpisodeCursor(firstPage.nextCursor as string).id).toBe(last.id);

    const fullPage = await session.episodes({ limit: 100 });
    expect(fullPage.items).toHaveLength(3);
    expect(fullPage.nextCursor).toBeUndefined();
  });

  test('reuses composeFilters isolation — a foreign session sees no rows', async () => {
    const memory = await buildMemory();
    await rememberSeq(memory.session('s1'), ['a', 'b']);
    await rememberSeq(memory.session('s2'), ['c']);

    const s1 = await memory.session('s1').episodes({ limit: 100 });
    expect(s1.items).toHaveLength(2);
    const foreign = await memory.session('nobody').episodes({ limit: 100 });
    expect(foreign.items).toEqual([]);
    expect(foreign.nextCursor).toBeUndefined();
  });

  test('an empty page returns { items: [] } with no nextCursor', async () => {
    const memory = await buildMemory();
    const page = await memory.session('empty').episodes();
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });
});
