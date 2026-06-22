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
import { emitEvent } from '../memory-event.js';
import type { MemoryItem } from '../memory-item.js';
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

/** One named entity as the LLM emits it — multilingual surface name (original
 *  language/script, diacritics preserved) + a coarse type hint. */
export interface LlmEntity {
  readonly name: string;
  readonly type?: string | undefined;
}

/**
 * Phase 7 entry. Links NODES for the call, then (when `relations` is provided —
 * the infer:true path) links EDGES once. NODES come from the LLM (`llmEntities`)
 * as the PRIMARY, MULTILINGUAL source (the LLM emits entity surface names in the
 * input language/script); `compromise` is an English-only FALLBACK used only when
 * the LLM emitted no entities (e.g. the infer:false fast-path). The LLM-primary
 * node decision + its prior-art survey live in the plan (cited below).
 * `relations === undefined` skips edge linking.
 *
 * @see .claude/knowledge-base/plans/entity-relation-extraction-slice2-plan.md
 */
export async function linkEntities(
  items: readonly MemoryItem[],
  filters: Filters,
  deps: EntityLinkingDeps,
  tracer: Tracer | undefined,
  relations?: readonly RelationTriple[],
  llmEntities?: readonly LlmEntity[],
): Promise<void> {
  const memoryEntityStore = deps.memoryEntityStore;
  if (memoryEntityStore === undefined) return;

  // Relation predicates ("works at", "lives in") are NOT entities — drop any
  // candidate whose key matches one so a predicate never becomes a node.
  const relationPredicates = new Set(
    (relations ?? []).map((r) => normalizeEntityKey(r.relationship)),
  );
  // Keys that actually became nodes → linkEdges only auto-creates genuinely
  // missing endpoints (EC-5), avoiding duplicate rows.
  const linkedKeys = new Set<string>();

  /** Embed + upsert candidate names as nodes linked to ONE memory. Drops EC-2
   *  short names, relation-verb noise, in-batch dups, and F-M2 empty embeddings. */
  const upsertNodes = async (
    candidates: readonly { type: EntityToLink['type']; name: string; normalizedKey: string }[],
    memoryId: string,
  ): Promise<void> => {
    const seen = new Set<string>();
    const cleaned = candidates
      .filter((e) => e.name.length >= 2 && e.normalizedKey.length >= 2) // EC-2
      .filter((e) => !relationPredicates.has(e.normalizedKey))
      .filter((e) => {
        if (seen.has(e.normalizedKey)) return false;
        seen.add(e.normalizedKey);
        return true;
      })
      .slice(0, MAX_ENTITIES_PER_MEMORY); // EC-3
    if (cleaned.length === 0) return;
    const embeddings = await deps.embedder.embedBatch(cleaned.map((e) => e.name));
    const entities: EntityToLink[] = cleaned
      .map((e, i) => ({ type: e.type, name: e.name, normalizedKey: e.normalizedKey, embedding: embeddings[i] ?? [] }))
      .filter((e) => e.embedding.length > 0); // F-M2: no zero-dim '[]'::vector
    if (entities.length === 0) return;
    await memoryEntityStore.upsertAndLink({
      memoryId,
      workspaceId: filters.workspace_id ?? 'default',
      filters,
      entities,
    });
    for (const e of entities) linkedKeys.add(e.normalizedKey);
  };

  const anchorId = items[0]?.id;
  const useLlmEntities = llmEntities !== undefined && llmEntities.length > 0;
  const entityExtractor = deps.entityExtractor;

  try {
    if (useLlmEntities && anchorId !== undefined) {
      // PRIMARY (multilingual): LLM-extracted nodes, anchored to the call's
      // representative memory (mirrors EC-5 edge-endpoint anchoring).
      await upsertNodes(
        llmEntities.map((e) => ({
          // domain-ontologies T4.1 — persist the LLM's emitted type (now
          // ontology-coerced upstream when an Ontology is configured) instead of
          // the old hardcoded 'PROPER' placeholder. Falls back to 'PROPER' only
          // when the LLM omitted a type. This is what makes domain types reach
          // `entities.type` (the slice-1/2 hardcode discarded the LLM type).
          type: e.type ?? 'PROPER',
          name: e.name.trim(),
          normalizedKey: normalizeEntityKey(e.name),
        })),
        anchorId,
      );
    } else if (entityExtractor !== undefined) {
      // FALLBACK (English-only): compromise, per-item. Used on the infer:false
      // fast-path or when the LLM returned no entities.
      for (const item of items) {
        await upsertNodes(
          entityExtractor
            .extract(item.text)
            .map((e) => ({ type: e.type, name: e.name.trim(), normalizedKey: normalizeEntityKey(e.name) })),
          item.id,
        );
      }
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
    await linkEdges(items, filters, deps, tracer, relations, linkedKeys);
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
  linkedKeys: Set<string>,
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

    // EC-5: the LLM's relation endpoints are authoritative entities. compromise
    // may have missed some (e.g. single-token "NASA"); without the node the edge
    // cannot resolve (D5 skip) — the live test showed this drops most edges. For
    // every endpoint NOT already a node, upsert it as a node (embedded via the
    // SAME embedder) linked to the anchor memory, so the edge resolves. Endpoints
    // compromise already extracted (in linkedKeys) are skipped to avoid dup rows.
    const memoryEntityStore = deps.memoryEntityStore;
    if (memoryEntityStore !== undefined) {
      const missing = new Map<string, string>(); // normalizedKey -> surface name
      for (const e of edges) {
        if (!linkedKeys.has(e.normalizedSourceKey)) missing.set(e.normalizedSourceKey, e.sourceName.trim());
        if (!linkedKeys.has(e.normalizedTargetKey)) missing.set(e.normalizedTargetKey, e.targetName.trim());
      }
      const names = [...missing.values()].filter((n) => n.length >= 2);
      if (names.length > 0) {
        const embeddings = await deps.embedder.embedBatch(names);
        const endpointEntities: EntityToLink[] = names
          .map((name, i) => ({
            type: 'PROPER' as const,
            name,
            normalizedKey: normalizeEntityKey(name),
            embedding: embeddings[i] ?? [],
          }))
          .filter((e) => e.embedding.length > 0 && e.normalizedKey.length >= 2);
        if (endpointEntities.length > 0) {
          await memoryEntityStore.upsertAndLink({
            memoryId: anchorId,
            workspaceId: filters.workspace_id ?? 'default',
            filters,
            entities: endpointEntities,
          });
          for (const e of endpointEntities) linkedKeys.add(e.normalizedKey);
        }
      }
    }

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
