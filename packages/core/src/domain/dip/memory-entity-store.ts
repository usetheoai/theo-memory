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
}
