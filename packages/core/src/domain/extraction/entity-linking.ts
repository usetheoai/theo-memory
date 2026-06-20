/**
 * Phase 7 — entity + relation linking (FAIL-SOFT), extracted from the write
 * pipeline so the orchestrator stays cohesive (slice2 T2.2). Both halves run
 * only when their ports are present (the factory threads them when
 * `config.entityBoost !== false`). NODES (`linkEntities`) come from the entity
 * extractor; EDGES (`linkEdges`) come from the LLM's `relations` (ADR D1). A
 * `remember()` MUST NEVER fail because linking failed (ADR D3, Princípio 3) —
 * nodes and edges have INDEPENDENT try/catch so a node success still emits
 * `entity_linked` even when edge linking throws.
 *
 * @see .claude/knowledge-base/plans/entity-relation-extraction-slice2-plan.md § T2.2
 */
import type { Tracer } from '@opentelemetry/api';

import type { Embedder } from '../dip/embedder.js';
import type { EntityExtractor } from '../dip/entity-extractor.js';
import type { EntityToLink, MemoryEntityStore } from '../dip/memory-entity-store.js';
import type { EdgeToLink, MemoryGraphStore } from '../dip/memory-graph-store.js';
import type { MemoryItem } from '../memory-item.js';
import { emitEvent } from '../memory-event.js';
import type { Filters } from '../scope.js';

/** EC-3 — cap entities/edges persisted per memory (a pathological LLM/extractor
 *  cannot spawn unbounded rows + resolution queries). */
const MAX_ENTITIES_PER_MEMORY = 50;
const MAX_EDGES_PER_MEMORY = 50;
/** EC-4 — a relation label longer than this is sentence-as-predicate noise. */
const MAX_RELATION_LEN = 64;

/** One relation triple as the LLM emits it (surface names; resolved downstream). */
export interface RelationTriple {
  readonly source: string;
  readonly relationship: string;
  readonly destination: string;
}

/** The Phase-7 slice of ExtractionDeps (narrowed to avoid a pipeline import cycle). */
export interface EntityLinkingDeps {
  readonly embedder: Embedder;
  readonly tracer?: Tracer;
  readonly entityExtractor?: EntityExtractor;
  readonly memoryEntityStore?: MemoryEntityStore;
  readonly memoryGraphStore?: MemoryGraphStore;
}

/** Lowercase + underscore the surface name → the per-scope dedup key (EC-1). */
export function normalizeEntityKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Phase 7 entry. Links NODES per item, then (when `relations` is provided — the
 * infer:true path) links EDGES once for the call. `relations === undefined`
 * (infer:false path) skips edge linking entirely.
 */
export async function linkEntities(
  items: readonly MemoryItem[],
  filters: Filters,
  deps: EntityLinkingDeps,
  tracer: Tracer | undefined,
  relations?: readonly RelationTriple[],
): Promise<void> {
  const entityExtractor = deps.entityExtractor;
  const memoryEntityStore = deps.memoryEntityStore;
  if (entityExtractor === undefined || memoryEntityStore === undefined) return;
  try {
    for (const item of items) {
      const cleaned = entityExtractor
        .extract(item.text)
        .slice(0, MAX_ENTITIES_PER_MEMORY) // EC-3
        .map((e) => ({ type: e.type, name: e.name.trim(), normalizedKey: normalizeEntityKey(e.name) }))
        .filter((e) => e.name.length >= 2 && e.normalizedKey.length >= 2); // EC-2
      if (cleaned.length === 0) continue;
      const embeddings = await deps.embedder.embedBatch(cleaned.map((e) => e.name));
      // F-M2: drop any entity whose embedding is empty so a zero-dim '[]'::vector
      // never reaches the INSERT (would roll back the whole batch).
      const entities: EntityToLink[] = cleaned
        .map((e, i) => ({ type: e.type, name: e.name, normalizedKey: e.normalizedKey, embedding: embeddings[i] ?? [] }))
        .filter((e) => e.embedding.length > 0);
      if (entities.length === 0) continue;
      await memoryEntityStore.upsertAndLink({
        memoryId: item.id,
        workspaceId: filters.workspace_id ?? 'default',
        filters,
        entities,
      });
    }
    emitEvent(tracer, 'entity_linked', { memory_count: items.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitEvent(tracer, 'entity_linking_failed', { error: msg });
    // eslint-disable-next-line no-console
    console.warn(`[themory] entity linking failed: ${msg}`);
  }

  // Edge linking is INDEPENDENT (own try/catch) so a node-link success above is
  // not undone by an edge failure. Skipped when relations were not provided.
  if (relations !== undefined) {
    await linkEdges(items, filters, deps, tracer, relations);
  }
}

/**
 * Link relation EDGES for the call. Provenance `source_memory_id = items[0].id`
 * (the representative memory of THIS remember() call — the same triple from a
 * separate call yields a different first-memory → `memoryCount` aggregates per
 * EC-1). Endpoints are resolved by name in the store; unresolved → skipped (D5).
 */
async function linkEdges(
  items: readonly MemoryItem[],
  filters: Filters,
  deps: EntityLinkingDeps,
  tracer: Tracer | undefined,
  relations: readonly RelationTriple[],
): Promise<void> {
  const memoryGraphStore = deps.memoryGraphStore;
  if (memoryGraphStore === undefined) return;
  const anchorId = items[0]?.id;
  if (anchorId === undefined) return; // no representative memory → no provenance
  try {
    const edges: EdgeToLink[] = relations
      .slice(0, MAX_EDGES_PER_MEMORY) // EC-3
      .filter(
        (r) =>
          typeof r.source === 'string' &&
          typeof r.relationship === 'string' &&
          typeof r.destination === 'string' &&
          r.source.trim().length >= 1 &&
          r.destination.trim().length >= 1 &&
          r.relationship.trim().length >= 1 &&
          r.relationship.trim().length <= MAX_RELATION_LEN, // EC-4
      )
      .map((r) => ({
        sourceName: r.source,
        relation: r.relationship,
        normalizedRelation: normalizeEntityKey(r.relationship),
        targetName: r.destination,
        normalizedSourceKey: normalizeEntityKey(r.source),
        normalizedTargetKey: normalizeEntityKey(r.destination),
      }));
    if (edges.length === 0) return;
    await memoryGraphStore.upsertEdges({
      memoryId: anchorId,
      workspaceId: filters.workspace_id ?? 'default',
      filters,
      edges,
    });
    emitEvent(tracer, 'entity_edge_linked', { edge_count: edges.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitEvent(tracer, 'entity_edge_linking_failed', { error: msg });
    // eslint-disable-next-line no-console
    console.warn(`[themory] entity edge linking failed: ${msg}`);
  }
}
