/**
 * Unit tests for linkEntities noise filtering at the upsertNodes chokepoint —
 * EG-2 entity-extraction-noise-filter T2.1. Proves noise is dropped on BOTH the
 * LLM-primary and the compromise-fallback node sources, and that real (incl.
 * multilingual) entities survive.
 *
 */
import type { Tracer } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';

import type { Embedder } from '../dip/embedder.js';
import type { EntityExtractor, ExtractedEntity } from '../dip/entity-extractor.js';
import type { MemoryEntityStore, UpsertAndLinkParams } from '../dip/memory-entity-store.js';
import type { MemoryGraphStore, UpsertEdgesParams } from '../dip/memory-graph-store.js';
import type { MemoryItem } from '../memory-item.js';
import type { Filters } from '../scope.js';
import { keepAnnotationsNamedBy, linkEntities, type EntityLinkingDeps, type LlmEntity, type RelationTriple } from './entity-linking.js';

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
    supersedeEntity: async () => false, forgetEntity: async () => ({ entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 }), linkedKeysForMemories: async () => new Map(),
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

describe('linkEntities — a write with several facts links each entity to the facts that name it', () => {
  /** Records which memory each entity and each edge was linked to. */
  function linkRecorder(): { deps: EntityLinkingDeps; nodeLinks: string[]; edgeLinks: string[] } {
    const nodeLinks: string[] = [];
    const edgeLinks: string[] = [];
    const memoryEntityStore: MemoryEntityStore = {
      upsertAndLink: async (params: UpsertAndLinkParams) => {
        for (const e of params.entities) nodeLinks.push(`${params.memoryId}:${e.normalizedKey}`);
      },
      list: async () => [],
      supersedeEntity: async () => false, forgetEntity: async () => ({ entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 }), linkedKeysForMemories: async () => new Map(),
    };
    const memoryGraphStore: MemoryGraphStore = {
      upsertEdges: async (params: UpsertEdgesParams) => {
        for (const e of params.edges) edgeLinks.push(`${params.memoryId}:${e.normalizedSourceKey}>${e.normalizedTargetKey}`);
      },
      listEdges: async () => [],
    } as unknown as MemoryGraphStore;
    return { deps: { embedder: fakeEmbedder(), memoryEntityStore, memoryGraphStore }, nodeLinks, edgeLinks };
  }

  const facts = [
    { id: 'm1', text: 'Sigvald moved to Bodø last spring' },
    { id: 'm2', text: 'Torunn runs a bakery called Nordlys in Mosjøen' },
    { id: 'm3', text: 'Halvard studies marine biology in Fauske' },
  ];
  const entities: LlmEntity[] = [{ name: 'Sigvald' }, { name: 'Bodø' }, { name: 'Torunn' }, { name: 'Nordlys' }, { name: 'Halvard' }, { name: 'Fauske' }];

  it('links every entity to the fact that names it, not to the first fact', async () => {
    const { deps, nodeLinks } = linkRecorder();

    await linkEntities(facts, FILTERS, deps, undefined, undefined, entities);

    expect(nodeLinks.sort()).toEqual(['m1:bodø', 'm1:sigvald', 'm2:nordlys', 'm2:torunn', 'm3:fauske', 'm3:halvard']);
  });

  it('links an entity named by two facts to both', async () => {
    const { deps, nodeLinks } = linkRecorder();
    const shared = [{ id: 'm1', text: 'Torunn lives in Bodø' }, { id: 'm2', text: 'Torunn runs a bakery' }];

    await linkEntities(shared, FILTERS, deps, undefined, undefined, [{ name: 'Torunn' }]);

    expect(nodeLinks.sort()).toEqual(['m1:torunn', 'm2:torunn']);
  });

  it('keeps an entity that no fact names linked to the first fact', async () => {
    const { deps, nodeLinks } = linkRecorder();

    await linkEntities(facts, FILTERS, deps, undefined, undefined, [{ name: 'Jeremias' }]);

    expect(nodeLinks).toEqual(['m1:jeremias']);
  });

  it('records an edge against the fact that names both of its ends', async () => {
    const { deps, edgeLinks } = linkRecorder();
    const relations: RelationTriple[] = [{ source: 'Torunn', relationship: 'runs', destination: 'Nordlys' }];

    await linkEntities(facts, FILTERS, deps, undefined, relations, entities);

    expect(edgeLinks).toEqual(['m2:torunn>nordlys']);
  });

  it('records an edge whose ends no single fact names against a fact that names one end', async () => {
    const { deps, edgeLinks } = linkRecorder();
    const relations: RelationTriple[] = [{ source: 'Halvard', relationship: 'son of', destination: 'Sigvald' }];

    await linkEntities(facts, FILTERS, deps, undefined, relations, entities);

    expect(edgeLinks).toEqual(['m1:halvard>sigvald']);
  });
});

describe('keepAnnotationsNamedBy — graph annotations when a draft of the call was dropped', () => {
  function recordingTracer(sink: { event: string; attributes: Record<string, unknown> }[]): Tracer {
    return {
      startActiveSpan(name: string, fn: (span: unknown) => void): void {
        const attributes: Record<string, unknown> = {};
        fn({ setAttribute: (k: string, v: unknown) => { attributes[k] = v; }, end: () => undefined });
        sink.push({ event: name, attributes });
      },
    } as unknown as Tracer;
  }
  const kept = [{ text: 'Øyfrid works as a nurse at Vardø Hospital' }];
  const entities: LlmEntity[] = [{ name: 'Øyfrid', type: 'PERSON' }, { name: 'Vardø Hospital', type: 'ORG' }, { name: 'Jeremias', type: 'PERSON' }];
  const relations: RelationTriple[] = [
    { source: 'Øyfrid', relationship: 'works at', destination: 'Vardø Hospital' },
    { source: 'Øyfrid', relationship: 'is married to', destination: 'Jeremias' },
  ];

  it('keeps an entity a surviving fact names, with the type the model gave it', () => {
    const result = keepAnnotationsNamedBy(kept, entities, relations, undefined);

    expect(result.entities).toContainEqual({ name: 'Vardø Hospital', type: 'ORG' });
  });

  it('drops an entity only the dropped draft named', () => {
    const result = keepAnnotationsNamedBy(kept, entities, relations, undefined);

    expect(result.entities?.map((e) => e.name)).not.toContain('Jeremias');
  });

  it('keeps a relation whose two ends a surviving fact names', () => {
    const result = keepAnnotationsNamedBy(kept, entities, relations, undefined);

    expect(result.relations).toContainEqual({ source: 'Øyfrid', relationship: 'works at', destination: 'Vardø Hospital' });
  });

  it('drops a relation with an end only the dropped draft named', () => {
    const result = keepAnnotationsNamedBy(kept, entities, relations, undefined);

    expect(result.relations?.map((r) => r.destination)).not.toContain('Jeremias');
  });

  it('reports how many entities and relations it dropped', () => {
    const events: { event: string; attributes: Record<string, unknown> }[] = [];

    keepAnnotationsNamedBy(kept, entities, relations, recordingTracer(events));

    expect(events).toContainEqual({
      event: 'extraction_evidence_dropped',
      attributes: expect.objectContaining({ reason: 'unassignable_graph_annotations', dropped_entities: 1, dropped_relations: 1 }) as unknown,
    });
  });
});
