/**
 * Unit tests for linkEntities noise filtering at the upsertNodes chokepoint —
 * EG-2 entity-extraction-noise-filter T2.1. Proves noise is dropped on BOTH the
 * LLM-primary and the compromise-fallback node sources, and that real (incl.
 * multilingual) entities survive.
 *
 */
import { describe, expect, it } from 'vitest';

import type { Embedder } from '../dip/embedder.js';
import type { EntityExtractor, ExtractedEntity } from '../dip/entity-extractor.js';
import type { MemoryEntityStore, UpsertAndLinkParams } from '../dip/memory-entity-store.js';
import type { MemoryItem } from '../memory-item.js';
import type { Filters } from '../scope.js';
import { linkEntities, type LlmEntity } from './entity-linking.js';

function fakeEmbedder(): Embedder {
  return {
    embed: async () => [0.1, 0.2],
    embedBatch: async (texts: readonly string[]) => texts.map(() => [0.1, 0.2]),
  };
}

/** Records every entity name handed to the store. */
function recordingStore(): { store: MemoryEntityStore; names: string[] } {
  const names: string[] = [];
  const store: MemoryEntityStore = {
    upsertAndLink: async (params: UpsertAndLinkParams) => {
      for (const e of params.entities) names.push(e.name);
    },
    list: async () => [],
  };
  return { store, names };
}

const FILTERS: Filters = { user_id: 'alice', workspace_id: 'default' };
const ITEMS: readonly MemoryItem[] = [{ id: 'm1', text: 'irrelevant' } as MemoryItem];

describe('linkEntities — noise filtering at the chokepoint', () => {
  it('drops noise from the LLM-primary path (store receives real entities only)', async () => {
    const { store, names } = recordingStore();
    const llmEntities: LlmEntity[] = [
      { name: 'Dune' },
      { name: 'Frank Herbert' },
      { name: 'user' },
      { name: 'love science' },
    ];
    await linkEntities(ITEMS, FILTERS, { embedder: fakeEmbedder(), memoryEntityStore: store }, undefined, undefined, llmEntities);
    expect(names.sort()).toEqual(['Dune', 'Frank Herbert']);
  });

  it('drops noise from the compromise fallback path (store receives real entities only)', async () => {
    const { store, names } = recordingStore();
    const extractor: EntityExtractor = {
      extract: (): readonly ExtractedEntity[] => [
        { type: 'PROPER', name: 'Dune' },
        { type: 'NOUN', name: "I'm" },
        { type: 'COMPOUND', name: 'm reading' },
      ],
    };
    await linkEntities(ITEMS, FILTERS, { embedder: fakeEmbedder(), memoryEntityStore: store, entityExtractor: extractor }, undefined);
    expect(names).toEqual(['Dune']);
  });

  it('preserves real + multilingual entities (recall not regressed)', async () => {
    const { store, names } = recordingStore();
    const llmEntities: LlmEntity[] = [{ name: 'São Paulo' }, { name: 'José' }];
    await linkEntities(ITEMS, FILTERS, { embedder: fakeEmbedder(), memoryEntityStore: store }, undefined, undefined, llmEntities);
    expect(names.sort()).toEqual(['José', 'São Paulo']);
  });
});
