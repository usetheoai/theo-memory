/**
 * v0.6: argument shapes for the local-store skill insertion methods.
 *
 * These types are NOT on the `VectorStore` DIP (per skill-library plan
 * § T2.1 design note — duck-typed extension matching the v0.4a
 * `insertDerivedMemory` precedent). They live here so both `PgvectorStore` and
 * `InMemoryVectorStore` reference the same shape, and the conformance suite
 * narrows the store type via runtime `typeof` guard.
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T2.1
 */
import type { SkillLanguage } from '../core/skill.js';

/**
 * Args for `insertSkill` — writes a `kind='skill'` row to the local store.
 *
 * `description` is the embedding target (consumer pre-embeds, store is dumb);
 * `code` is the verbatim payload; `codeLanguage` discriminates the runtime.
 * The store rejects empty `description` / invalid `codeLanguage` with
 * `InvalidSkillError` BEFORE any SQL write.
 */
export interface InsertSkillArgs {
  readonly embedding: readonly number[];
  readonly hash: string;
  readonly code: string;
  readonly description: string;
  readonly codeLanguage: SkillLanguage;
  readonly scope: {
    readonly userId?: string | null;
    readonly sessionId?: string | null;
    readonly agentId?: string | null;
  };
}

/**
 * Args for `insertDerivedSkill` — writes a `kind='skill'` row with non-empty
 * `derived_from` provenance (output of the v0.6 consolidate orchestrator).
 * The store rejects empty `derivedFrom` with `InvalidSkillError`.
 */
export interface InsertDerivedSkillArgs extends InsertSkillArgs {
  readonly derivedFrom: readonly string[];
}

/**
 * Type guard: narrow a `VectorStore` reference to one that supports skill
 * insertion. Mirrors the v0.4a `VectorStoreWithDerivedInsert` pattern in
 * `src/local/index.ts`.
 */
export interface VectorStoreWithSkillInsert {
  insertSkill(args: InsertSkillArgs): Promise<string>;
  insertDerivedSkill(args: InsertDerivedSkillArgs): Promise<string>;
}
