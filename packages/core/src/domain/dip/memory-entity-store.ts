/**
 * MemoryEntityStore DIP — persist-only port for the entity-linking aggregate.
 *
 * The write pipeline (Phase 7) extracts + embeds entity names, then hands them
 * here to be UPSERTed into the `entities` table (deduped by the per-scope EC-1
 * UNIQUE) and linked to their source memory via `memory_entities`. Persist-only:
 * extraction (EntityExtractor) and embedding (Embedder) stay in the domain
 * orchestration; this port owns ONLY the database write.
 *
 * @see .claude/knowledge-base/discoveries/blueprints/entity-relation-extraction-no-graphdb-blueprint.md
 * @see .claude/knowledge-base/plans/entity-extraction-nodes-slice1-plan.md § T3.1
 */
import type { Filters } from '../scope.js';

import type { EntityType } from './entity-extractor.js';

/** One entity ready to persist: kind + name + its embedding vector. */
export interface EntityToLink {
  readonly type: EntityType;
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

export interface MemoryEntityStore {
  /**
   * UPSERT the given entities (dedup by the per-scope EC-1 UNIQUE) and link each
   * to the source memory. Idempotent: re-linking the same (memory, entity) is a
   * no-op (composite PK ON CONFLICT DO NOTHING).
   */
  upsertAndLink(params: UpsertAndLinkParams): Promise<void>;
}
