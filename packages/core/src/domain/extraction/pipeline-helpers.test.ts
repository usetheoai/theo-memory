/**
 * D1 of the multilingual-entity-extraction blueprint (#111): the `infer:false`
 * verbatim path performs NO inline entity extraction — upstream parity
 * (the established shape skips entity linking on `infer=False`).
 *
 * The 2026-06-20 "item-2 fix" wired the English-only heuristic fallback into this
 * path; over a global (pt-BR/technical) import corpus it produced 83% graph noise
 * (issue #111 evidence). The graph for verbatim memories is populated by the
 * ASYNC LLM batch backfill (blueprint D2), never by an inline heuristic.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Embedder } from '../dip/embedder.js';
import type { EntityExtractor } from '../dip/entity-extractor.js';
import type { MemoryEntityStore } from '../dip/memory-entity-store.js';
import type { Filters } from '../scope.js';
import { runInferFalsePath } from './pipeline-helpers.js';
import type { ExtractionDeps } from './pipeline-helpers.js';

const FILTERS: Filters = { user_id: 'alice', workspace_id: 'default' };

function deps(): { deps: ExtractionDeps; extractSpy: ReturnType<typeof vi.fn>; upsertSpy: ReturnType<typeof vi.fn> } {
  const extractSpy = vi.fn(() => [{ type: 'PROPER' as const, name: 'Should Never Happen' }]);
  const upsertSpy = vi.fn(async () => undefined);
  const embedder: Embedder = {
    embed: async () => [0.1, 0.2],
    embedBatch: async (texts: readonly string[]) => texts.map(() => [0.1, 0.2]),
  };
  const entityExtractor: EntityExtractor = { extract: extractSpy };
  const memoryEntityStore: MemoryEntityStore = { upsertAndLink: upsertSpy, list: async () => [], supersedeEntity: async () => false, forgetEntity: async () => ({ entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 }), linkedKeysForMemories: async () => new Map() };
  const vectorStore = {
    insert: vi.fn(async (_v: unknown, ids: readonly string[]) =>
      ids.map((id) => ({ id, rejectedAsDuplicate: false })),
    ),
  };
  return {
    deps: { embedder, vectorStore, entityExtractor, memoryEntityStore } as unknown as ExtractionDeps,
    extractSpy,
    upsertSpy,
  };
}

describe('runInferFalsePath — no inline entity extraction (blueprint D1, #111)', () => {
  it('persists verbatim memories WITHOUT invoking the entity extractor or entity store', async () => {
    const { deps: d, extractSpy, upsertSpy } = deps();
    const items = await runInferFalsePath(
      [{ role: 'user', content: 'O Paulo prefere café coado toda manhã em São Paulo.' }],
      FILTERS,
      d,
      { infer: false },
    );
    expect(items).toHaveLength(1);
    expect(extractSpy).not.toHaveBeenCalled(); // EN-only heuristic NEVER runs on verbatim writes
    expect(upsertSpy).not.toHaveBeenCalled(); // no entity rows from this path — backfill owns the graph
  });
});
