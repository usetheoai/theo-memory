/**
 * EntityExtractor DIP — adapter contract for extracting entities (nodes) from text.
 *
 * The domain owns this contract; infrastructure implements it (default:
 * `CompromiseEntityExtractor`, a JS-native NLP extractor with a regex fallback).
 * Extraction is SYNCHRONOUS and deterministic — embedding of the extracted names
 * is a separate async step performed by the write pipeline (Phase 7), not by this
 * contract. Relations (edges) are out of scope for this contract (a later slice).
 *
 * @see .claude/knowledge-base/discoveries/blueprints/entity-relation-extraction-no-graphdb-blueprint.md
 * @see .claude/knowledge-base/plans/entity-extraction-nodes-slice1-plan.md § T1.1
 */

/** Closed set of entity kinds an extractor may emit. */
export type EntityType = 'PROPER' | 'QUOTED' | 'COMPOUND' | 'NOUN';

/** One extracted entity: its kind + its surface name. */
export interface ExtractedEntity {
  readonly type: EntityType;
  readonly name: string;
}

export interface EntityExtractor {
  /**
   * Extract entities from a single text. Synchronous + deterministic.
   * Implementations MUST drop blank/too-short candidates (no empty-name entities).
   */
  extract(text: string): ReadonlyArray<ExtractedEntity>;
}
