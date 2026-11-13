import { describe, expect, it } from 'vitest';

import { InMemoryVectorStore } from './in-memory-store.js';

const VECTOR = [1, 0, 0];

async function seeded(): Promise<{ store: InMemoryVectorStore; summary: string; second: string; unrelated: string }> {
  const store = new InMemoryVectorStore();
  await store.insert(
    [VECTOR, VECTOR],
    ['source', 'other'],
    [
      { text: 'Paulo takes a medicine for epilepsy', hash: 'h-source', user_id: 'u' },
      { text: 'Paulo walks to work', hash: 'h-other', user_id: 'u' },
    ],
  );
  const scope = { userId: 'u' };
  const summary = await store.insertDerivedMemory({ text: 'Paulo manages epilepsy and walks', hash: 'h-1', embedding: VECTOR, derivedFrom: ['source', 'other'], scope });
  const second = await store.insertDerivedMemory({ text: 'Paulo has a health routine', hash: 'h-2', embedding: VECTOR, derivedFrom: [summary], scope });
  const unrelated = await store.insertDerivedMemory({ text: 'Paulo commutes on foot', hash: 'h-3', embedding: VECTOR, derivedFrom: ['other'], scope });
  return { store, summary, second, unrelated };
}

describe('InMemoryVectorStore.delete', () => {
  it('deletes the summaries derived from the row, and the summaries of those', async () => {
    const { store, summary, second, unrelated } = await seeded();

    await store.delete('source');

    expect(await store.get('source')).toBeNull();
    expect(await store.get(summary)).toBeNull();
    expect(await store.get(second)).toBeNull();
    expect(await store.get('other')).not.toBeNull();
    expect(await store.get(unrelated)).not.toBeNull();
  });

  it('leaves a summary in another workspace that lists the same id', async () => {
    const store = new InMemoryVectorStore();
    await store.insert([VECTOR], ['source'], [{ text: 'a fact', hash: 'h', user_id: 'u', workspace_id: 'one' }]);
    const elsewhere = await store.insertDerivedMemory({ text: 'a summary', hash: 'h-4', embedding: VECTOR, derivedFrom: ['source'], scope: { userId: 'u', workspaceId: 'two' } });

    await store.delete('source');

    expect(await store.get(elsewhere)).not.toBeNull();
  });
});
