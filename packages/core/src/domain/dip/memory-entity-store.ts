/**
 * MemoryEntityStore DIP — persist-only port for the entity-linking aggregate.
 *
 * The write pipeline (Phase 7) extracts + embeds entity names, then hands them
 * here to be UPSERTed into the `entities` table (deduped by the per-scope EC-1
 * UNIQUE) and linked to their source memory via `memory_entities`. Persist-only:
 * extraction (EntityExtractor) and embedding (Embedder) stay in the domain
 * orchestration; this port owns ONLY the database write.
 *
 */
import type { Filters } from '../scope.js';

/**
 * EntityForgetScopeError — thrown by `forgetEntity` when the scope filter does not carry
 * a confirmed user (M14 T2.4a, fail-closed guard). The direct lesson of the theo-cloud#252
 * cascade-delete incident: a dropped scope filter turned a targeted delete into an
 * open-scope wipe. The guard ABORTS before any write rather than delete across an
 * under-constrained scope (Rule 8 — fail-fast, typed). Kept in this module (not errors.ts,
 * which is already over the size budget) for cohesion with the port that throws it.
 */
export class EntityForgetScopeError extends Error {
  override readonly name = 'EntityForgetScopeError' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(`Entity forget scope not confirmed: ${message}`, options);
    Object.setPrototypeOf(this, EntityForgetScopeError.prototype);
  }
}

/** Result of a `forgetEntity` call — counts of what the scoped delete removed. */
export interface ForgetEntityResult {
  readonly entitiesRemoved: number;
  readonly linksRemoved: number;
  readonly edgesRemoved: number;
}

/** One entity ready to persist: type + name + its embedding vector.
 *
 * `type` is `string` (persisted to a `text` column): it carries the compromise
 * fallback kinds (`PROPER|QUOTED|COMPOUND|NOUN`), the LLM's coarse types
 * (`PERSON|ORG|...`), OR a domain-ontology entity type (`Diagnosis`, `Clause`,
 * ...) when an `Ontology` is configured (Item 15). Widened from the
 * compromise-only `EntityType` union so domain types reach persistence. */
export interface EntityToLink {
  readonly type: string;
  readonly name: string;
  readonly normalizedKey: string;
  readonly embedding: readonly number[];
}

export interface UpsertAndLinkParams {
  readonly memoryId: string;
  readonly workspaceId: string;
  /** Scope tiers of the source memory (one set, others undefined). */
  readonly filters: Filters;
  readonly entities: readonly EntityToLink[];
}

/** One aggregated entity (node) for the listing/graph read side (T4.1, ADR D4). */
export interface EntityNodeSummary {
  readonly id: string;
  readonly name: string;
  /** Entity type — `string` (see `EntityToLink.type`): compromise kind, LLM type,
   *  or a domain-ontology type when an `Ontology` is configured (Item 15). */
  readonly type: string;
  /** Distinct memories this entity is linked to (via memory_entities). */
  readonly memoryCount: number;
  /**
   * Most recent linked-memory `created_at` (ISO string). Sourced from the
   * linked memories, NOT `entities.created_at` (which is first-write per the
   * dedup ON CONFLICT). `memory_entities` carries no per-link timestamp.
   */
  readonly lastSeenAt: string;
  /**
   * M2 — on-demand evolving summary: a deterministic digest of the entity's
   * currently-active outgoing relations (`normalized_relation → target`, over
   * `entity_edges` where `t_invalid IS NULL`), so it reflects the M1
   * supersession/invalidation state. Computed at read time (zero per-write LLM,
   * ADR-M2-1). Empty string when the entity has no active outgoing relations.
   */
  readonly summary: string;
}

export interface ListEntitiesParams {
  readonly workspaceId: string;
  /** Scope tiers (one set, others undefined) — AND-composed via COALESCE. */
  readonly filters: Filters;
}

export interface MemoryEntityStore {
  /**
   * UPSERT the given entities (dedup by the per-scope EC-1 UNIQUE) and link each
   * to the source memory. Idempotent: re-linking the same (memory, entity) is a
   * no-op (composite PK ON CONFLICT DO NOTHING).
   */
  upsertAndLink(params: UpsertAndLinkParams): Promise<void>;

  /**
   * List the entities (nodes) for a scope, deduped, with `memoryCount` +
   * `lastSeenAt`, ordered by `memoryCount` desc. Read side of ADR D4.
   */
  list(params: ListEntitiesParams): Promise<readonly EntityNodeSummary[]>;

  /**
   * M13 T2.1 (#111) — auditable supersede: repoint `memory_entities` links and
   * `entity_edges` endpoints from `oldId` to `newId` and mark
   * `old.superseded_by = newId`, all in ONE transaction. Never DELETE
   * (Princípio 3). Returns `true` when the old row was superseded by THIS call;
   * `false` when it was already superseded (idempotent re-run). A missing/
   * cross-workspace `newId` throws BEFORE any write (fail-closed).
   */
  supersedeEntity(params: { oldId: string; newId: string; workspaceId: string }): Promise<boolean>;

  /**
   * M14 T2.4a — scoped forget of an entity (node) from the graph: removes the entity row,
   * its `memory_entities` links, and its `entity_edges`, all scoped to `(workspaceId,
   * filters)` in ONE transaction. The source MEMORIES are untouched (only the derived,
   * re-extractable graph is removed). FAIL-CLOSED (theo-cloud#252): if `filters` does not
   * carry a confirmed user (`user_id`), throws `EntityForgetScopeError` BEFORE any write —
   * an under-constrained scope never widens into an open-scope delete. Returns the counts
   * removed (0/0/0 when the entity does not exist in scope — idempotent).
   */
  forgetEntity(params: {
    name: string;
    workspaceId: string;
    filters: Filters;
  }): Promise<ForgetEntityResult>;
}
