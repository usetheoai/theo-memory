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
 */
import type { Tracer } from '@opentelemetry/api';

import type { Embedder } from '../dip/embedder.js';
import type { EntityExtractor } from '../dip/entity-extractor.js';
import type { EntityToLink, MemoryEntityStore } from '../dip/memory-entity-store.js';
import type { EdgeToLink, MemoryGraphStore } from '../dip/memory-graph-store.js';
import { entityKeysNamedIn, normalizeEntityKey } from '../entity-key.js';
import { emitEvent } from '../memory-event.js';
import type { MemoryItem } from '../memory-item.js';
import { ONTOLOGY_FALLBACK_TYPE } from '../ontology.js';
import type { Filters } from '../scope.js';

import { isEntityNoise } from './entity-noise-filter.js';

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

export { normalizeEntityKey };

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
 */
/** ISP slice of MemoryItem — linkEntities only reads the anchor id + text, so
 *  batch callers (reextract) can pass a minimal row without fabricating the
 *  full MemoryItem envelope. Full MemoryItem satisfies the Pick structurally. */
export type LinkableItem = Pick<MemoryItem, 'id' | 'text'>;

/**
 * The facts of one write that name `key`, by the same word rule recall uses to decide which
 * entities a query names. One extraction call returns its entities for the whole input, not
 * per fact; linking all of them to the first fact left the other facts without the entities
 * they name, and gave the first fact entities it does not name.
 */
function factsNaming(key: string, items: readonly LinkableItem[]): string[] {
  return items.filter((item) => entityKeysNamedIn(item.text, [key]).length > 0).map((item) => item.id);
}

export async function linkEntities(
  items: readonly LinkableItem[],
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

  /** Embed + upsert candidate names as nodes, each linked to the memories `targetsOf`
   *  names for its key. Drops EC-2 short names, relation-verb noise, in-batch dups, and
   *  F-M2 empty embeddings. Each name is embedded once, however many memories it links to. */
  const upsertNodes = async (
    candidates: readonly { type: EntityToLink['type']; name: string; normalizedKey: string }[],
    targetsOf: (normalizedKey: string) => readonly string[],
  ): Promise<void> => {
    const seen = new Set<string>();
    const sized = candidates.filter((e) => e.name.length >= 2 && e.normalizedKey.length >= 2); // EC-2
    // EG-2: drop pronoun/contraction/generic/verb-fragment noise (both node sources).
    const denoised = sized.filter((e) => !isEntityNoise(e.name));
    // Princípio 3 — the IGNORE is observable: emit an aggregated count (never silent;
    // mirrors recall_threshold_filtered). NOT emitted when nothing was dropped.
    const noiseFiltered = sized.length - denoised.length;
    if (noiseFiltered > 0) emitEvent(tracer, 'entity_noise_filtered', { filtered_count: noiseFiltered });
    const cleaned = denoised
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
    const byMemory = new Map<string, EntityToLink[]>();
    for (const entity of entities) {
      for (const memoryId of targetsOf(entity.normalizedKey)) {
        byMemory.set(memoryId, [...(byMemory.get(memoryId) ?? []), entity]);
      }
    }
    for (const [memoryId, linked] of byMemory) {
      await memoryEntityStore.upsertAndLink({
        memoryId,
        workspaceId: filters.workspace_id ?? 'default',
        filters,
        entities: linked,
      });
    }
    for (const e of entities) linkedKeys.add(e.normalizedKey);
  };

  const anchorId = items[0]?.id;
  const useLlmEntities = llmEntities !== undefined && llmEntities.length > 0;
  const entityExtractor = deps.entityExtractor;

  try {
    if (useLlmEntities && anchorId !== undefined) {
      // PRIMARY (multilingual): LLM-extracted nodes, linked to every fact of the call that
      // names them. A name no fact contains (the model normalized or translated it) stays
      // on the first fact, as before, so no extracted entity loses its only link.
      await upsertNodes(
        llmEntities.map((e) => ({
          // M13 T1.1 (ADR D1, #111) — the SEMANTIC type is honored on EVERY path:
          // the pipeline already coerced it against exactly one vocabulary (the
          // configured ontology OR the closed default taxonomy), so here a missing
          // type simply defaults to OTHER. The old PROPER placeholder was the
          // mechanism label the M13 DoD zeroes (review F-dom-db-1's identity-
          // fragmentation concern is resolved by the D2 supersede migration, not
          // by keeping the placeholder).
          type: e.type ?? ONTOLOGY_FALLBACK_TYPE,
          name: e.name.trim(),
          normalizedKey: normalizeEntityKey(e.name),
        })),
        (key) => {
          const naming = factsNaming(key, items);
          return naming.length > 0 ? naming : [anchorId];
        },
      );
    } else if (entityExtractor !== undefined) {
      // FALLBACK (English-only): compromise, per-item. Used on the infer:false
      // fast-path or when the LLM returned no entities.
      for (const item of items) {
        await upsertNodes(
          entityExtractor
            .extract(item.text)
            // M13 T1.1 — the compromise fallback emits MECHANISM labels
            // (PROPER/COMPOUND/QUOTED); they carry no domain semantics and the
            // M13 DoD zeroes them, so fallback entities persist as OTHER.
            .map((e) => ({ type: ONTOLOGY_FALLBACK_TYPE, name: e.name.trim(), normalizedKey: normalizeEntityKey(e.name) })),
          () => [item.id],
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
 * Link relation EDGES for the call. Provenance `source_memory_id` is the first fact of the
 * call that names both ends of the edge; failing that, the first that names either end;
 * failing that, the call's first fact. The same triple from a separate call has a different
 * source memory, so `memoryCount` aggregates per EC-1. Endpoints are resolved by name in the
 * store; unresolved → skipped (D5).
 */
async function linkEdges(
  items: readonly LinkableItem[],
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

    const provenanceOf = (edge: EdgeToLink): string => {
      const source = new Set(factsNaming(edge.normalizedSourceKey, items));
      const target = new Set(factsNaming(edge.normalizedTargetKey, items));
      const both = items.find((item) => source.has(item.id) && target.has(item.id));
      const either = items.find((item) => source.has(item.id) || target.has(item.id));
      return (both ?? either)?.id ?? anchorId;
    };
    const edgesByMemory = new Map<string, EdgeToLink[]>();
    for (const edge of edges) {
      const memoryId = provenanceOf(edge);
      edgesByMemory.set(memoryId, [...(edgesByMemory.get(memoryId) ?? []), edge]);
    }

    // EC-5: the LLM's relation endpoints are authoritative entities. compromise
    // may have missed some (e.g. single-token "NASA"); without the node the edge
    // cannot resolve (D5 skip) — the live test showed this drops most edges. For
    // every endpoint NOT already a node, upsert it as a node (embedded via the
    // SAME embedder) linked to the facts that name it, or to the provenance fact of
    // the first edge that needs it, so the edge resolves. Endpoints already linked
    // (in linkedKeys) are skipped to avoid dup rows.
    const memoryEntityStore = deps.memoryEntityStore;
    if (memoryEntityStore !== undefined) {
      const missing = new Map<string, string>(); // normalizedKey -> surface name
      const fallbackFor = new Map<string, string>(); // normalizedKey -> provenance memory
      for (const e of edges) {
        for (const [key, name] of [[e.normalizedSourceKey, e.sourceName], [e.normalizedTargetKey, e.targetName]] as const) {
          if (linkedKeys.has(key) || missing.has(key)) continue;
          missing.set(key, name.trim());
          fallbackFor.set(key, provenanceOf(e));
        }
      }
      const names = [...missing.values()].filter((n) => n.length >= 2);
      if (names.length > 0) {
        const embeddings = await deps.embedder.embedBatch(names);
        const endpointEntities: EntityToLink[] = names
          .map((name, i) => ({
            // domain-ontologies (F-dom-2) + M13 T1.1 — auto-created relation-endpoint
            // nodes have no LLM type to coerce; they take the OTHER fallback
            // unconditionally (mechanism labels are never persisted post-M13).
            type: ONTOLOGY_FALLBACK_TYPE,
            name,
            normalizedKey: normalizeEntityKey(name),
            embedding: embeddings[i] ?? [],
          }))
          .filter((e) => e.embedding.length > 0 && e.normalizedKey.length >= 2);
        const byMemory = new Map<string, EntityToLink[]>();
        for (const entity of endpointEntities) {
          const naming = factsNaming(entity.normalizedKey, items);
          for (const memoryId of naming.length > 0 ? naming : [fallbackFor.get(entity.normalizedKey) ?? anchorId]) {
            byMemory.set(memoryId, [...(byMemory.get(memoryId) ?? []), entity]);
          }
        }
        for (const [memoryId, linked] of byMemory) {
          await memoryEntityStore.upsertAndLink({
            memoryId,
            workspaceId: filters.workspace_id ?? 'default',
            filters,
            entities: linked,
          });
        }
        for (const e of endpointEntities) linkedKeys.add(e.normalizedKey);
      }
    }

    for (const [memoryId, grouped] of edgesByMemory) {
      await memoryGraphStore.upsertEdges({
        memoryId,
        workspaceId: filters.workspace_id ?? 'default',
        filters,
        edges: grouped,
      });
    }
    emitEvent(tracer, 'entity_edge_linked', { edge_count: edges.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitEvent(tracer, 'entity_edge_linking_failed', { error: msg });
    // eslint-disable-next-line no-console
    console.warn(`[themory] entity edge linking failed: ${msg}`);
  }
}
