/**
 * MemoryGraphStore DIP — persist + read port for the relation-edge aggregate.
 *
 * Slice 2 companion to `MemoryEntityStore` (which owns nodes). The write pipeline
 * (Phase 7) resolves relation triples into endpoint entity ids and hands them
 * here to be UPSERTed into `entity_edges` (deduped by the per-scope EC-1 UNIQUE
 * that INCLUDES `source_memory_id`, so `memoryCount` aggregates across memories).
 * The read side serves the EDGES half of `GET /graph`; the NODES half stays on
 * `MemoryEntityStore.list` (the handler composes both — ISP per ADR-0008, this
 * port is exactly 2 methods and does NOT duplicate node listing).
 *
 * @see .claude/knowledge-base/discoveries/blueprints/entity-relation-extraction-no-graphdb-blueprint.md
 * @see .claude/knowledge-base/plans/entity-relation-extraction-slice2-plan.md § T2.0
 */
import type { Filters } from '../scope.js';

/** One relation triple ready to persist. Endpoint names are resolved to entity
 *  ids by the impl via `(scope, normalized_key)`; the relation is stored as the
 *  human label + its normalized (lowercased/underscored) dedup key. */
export interface EdgeToLink {
  readonly sourceName: string;
  readonly relation: string;
  readonly normalizedRelation: string;
  readonly targetName: string;
  readonly normalizedSourceKey: string;
  readonly normalizedTargetKey: string;
}

export interface UpsertEdgesParams {
  readonly memoryId: string;
  readonly workspaceId: string;
  /** Scope tiers of the source memory (one set, others undefined). */
  readonly filters: Filters;
  readonly edges: readonly EdgeToLink[];
}

/** One aggregated edge for the `{nodes, edges}` graph read side (ADR D4). Source
 *  and target are entity NAMES (byte-compatible with `EntityNodeSummary.id`) so
 *  a frontend can match an edge to its visible nodes without a second lookup. */
export interface EdgeSummary {
  readonly source: string;
  readonly relation: string;
  readonly target: string;
  /** Distinct memories that asserted this triple (count(DISTINCT source_memory_id)). */
  readonly memoryCount: number;
}

export interface ListEdgesParams {
  readonly workspaceId: string;
  /** Scope tiers (one set, others undefined) — AND-composed via COALESCE. */
  readonly filters: Filters;
  /**
   * M1 — default `false`: list only currently-active edges (`t_invalid IS NULL`).
   * `true` includes superseded/invalidated edges (audit view). Injection-safe: a
   * boolean selects between two constant SQL fragments.
   */
  readonly includeSuperseded?: boolean;
}

export interface MemoryGraphStore {
  /**
   * UPSERT the given relation edges (dedup by the per-scope EC-1 UNIQUE that
   * includes `source_memory_id`) and link them to their source memory. Endpoints
   * that do not resolve to an existing entity node are skipped (fail-soft, D5).
   * Idempotent: re-asserting the same triple from the same memory is a no-op.
   */
  upsertEdges(params: UpsertEdgesParams): Promise<void>;

  /**
   * M1 — forget-propagation: mark every currently-active edge produced by
   * `memoryId` (`source_memory_id = memoryId`) as invalid (`t_invalid = now()`),
   * so an edge never outlives the memory that produced it. `memoryId` is a
   * globally-unique UUID, so no scope is needed. Idempotent (already-invalid rows
   * are skipped). Fail-soft at the call site: a forget of the memory must still
   * succeed if this fails.
   */
  invalidateEdgesByMemory(memoryId: string): Promise<void>;

  /**
   * List the relation edges for a scope, aggregated by `(source, relation,
   * target)` with `memoryCount = count(DISTINCT source_memory_id)`, ordered by
   * `memoryCount` desc. Read side of ADR D4 (the edges half of `{nodes,edges}`).
   */
  listEdges(params: ListEdgesParams): Promise<readonly EdgeSummary[]>;
}
