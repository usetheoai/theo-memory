/**
 * v0.6 — code-as-skill procedural memory contract.
 *
 * `Skill` is the persisted skill row: a `MemoryItem` extended with the
 * code-as-skill payload (`code`/`description`/`codeLanguage`) and a
 * supersession chain (`supersededBy`) that lets newer skills point back to
 * the ancestor they replaced. `ScopedSkillMemory` is the sub-object returned
 * by `Memory.skills(repoId)` exposing the 4 skill verbs.
 *
 * The orchestrator that materializes `Skill` rows (`consolidate()`) wraps
 * the v0.4a `Memory.reflect()` chain at `src/local/index.ts:189-280` per
 * plan ADR D1 (REUSE, no sibling chain).
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § ADRs D1-D5
 * @see .claude/knowledge-base/discoveries/blueprints/skill-library-blueprint.md § ADRs D1-D3
 */
import type { MemoryItem } from './memory-item.js';

/** v0.6: language tag of a skill's executable payload. */
export type SkillLanguage = 'typescript' | 'javascript';

/**
 * Persisted skill row.
 *
 * Structurally extends `MemoryItem` so existing `recall()` / `getAll()` paths
 * see a Skill as a MemoryItem when the caller drops the discriminant.
 * Adds the v0.6 fields (discriminant + code-as-skill payload + supersession
 * chain + reflection provenance).
 *
 * Wire shape per plan ADR D2: `description` is the embedding target; `code`
 * is the verbatim payload preserved at the column level (NULL on non-skill
 * rows; required on Skill).
 */
export interface Skill extends MemoryItem {
  /** Discriminator on the v0.4a `kind` column. v0.6: `'skill'` is the third value alongside `'extracted'`/`'derived'`. */
  readonly kind: 'skill';

  /**
   * Executable code-as-skill payload preserved verbatim. NULL on derived skills
   * produced by `consolidate()` in v0.6.1 (the LLM-merged narrative lives in
   * `description` only; structured-draft extraction defers to a future cycle
   * per skill-library-fixes-v0-6-1 plan ADR D2). Skills written via
   * `add(SkillDraft)` always carry non-null code — see `SkillDraft.code`.
   */
  readonly code: string | null;

  /** Natural-language description of the skill. Embedding target for recall. */
  readonly description: string;

  /**
   * Language tag of the `code` payload. NULL on derived skills (mirrors `code`).
   * Skills written via `add(SkillDraft)` always carry a non-null language tag.
   */
  readonly codeLanguage: SkillLanguage | null;

  /**
   * Supersession chain — id of the newer skill that replaced this row.
   * `null` ⇒ this row is the current head (returned by recall when `includeSuperseded=false`).
   */
  readonly supersededBy: string | null;

  /**
   * Provenance for skills produced via `consolidate()`. Empty for skills written via `add()`.
   * Mirrors v0.4a `derivedFrom` for kind='derived' rows; same JSONB column at the storage layer.
   */
  readonly derivedFrom: readonly string[];
}

/**
 * Input shape to `ScopedSkillMemory.add()`. The caller supplies just the
 * code-as-skill payload; the implementation assigns the id, hash, scope,
 * timestamps, `kind='skill'`, empty `derivedFrom`, and `supersededBy=null`.
 */
export interface SkillDraft {
  readonly code: string;
  readonly description: string;
  readonly codeLanguage: SkillLanguage;
}

/** Recall result for skills — adds the additive composite score to `Skill`. */
export interface SkillWithScore extends Skill {
  /** Additive composite score in [0, 1]. Higher = better match. */
  readonly score: number;
}

/**
 * Options consumed by `ScopedSkillMemory.recall()`. Mirrors the v0.4a
 * `RecallOptions` shape with the v0.6 `includeSuperseded` filter added per
 * plan v1.1 EC-3 absorption (filter must be honored on BOTH recall and getAll).
 */
export interface SkillRecallOptions {
  /** Maximum number of results. Implementation default: 10. */
  readonly topK?: number;

  /** Semantic-similarity floor in [0, 1]. Implementation default: 0.3. */
  readonly threshold?: number;

  /**
   * When `true`, include skills whose `supersededBy IS NOT NULL` in the result set.
   * Default `false` — recall returns only the tip-of-version-chain.
   */
  readonly includeSuperseded?: boolean;
}

/**
 * Options consumed by `ScopedSkillMemory.consolidate()`. The 4-phase
 * orchestrator (Orient → Gather → Consolidate → Report) clusters skills
 * whose embedding cosine ≥ `clusterThreshold`.
 */
export interface ConsolidateOptions {
  /** Embedding-cosine threshold for cluster membership. Default 0.85 per plan ADR D4 Deep Dives. */
  readonly clusterThreshold?: number;
}

/**
 * A single cluster surfaced by `consolidate()` Phase 2 (Gather): N source
 * skills whose embeddings cluster together, candidates for consolidation
 * into one derived skill in Phase 3.
 */
export interface SourceCluster {
  readonly sourceIds: readonly string[];
  readonly skills: readonly Skill[];
}

/**
 * Return shape of `consolidate()` — Phase 4 (Report) output.
 *
 * Invariants:
 *   - every entry in `derivedSkills` has `derivedFrom.length >= 2`
 *   - every id in `supersededIds` matches a `sourceIds` entry from some `sourceClusters` row
 *   - `supersededIds.length === sourceClusters.flatMap(c => c.sourceIds).length`
 */
export interface ConsolidationResult {
  readonly sourceClusters: readonly SourceCluster[];
  readonly derivedSkills: readonly Skill[];
  readonly supersededIds: readonly string[];
  readonly durationMs: number;
}

/**
 * Scoped sub-object returned by `Memory.skills(repoId)`.
 *
 * Exposes 4 verbs (per plan ADR D4):
 *   - `add`         — write a new skill (no LLM extraction; payload is the contract)
 *   - `recall`      — semantic search over skill descriptions
 *   - `consolidate` — 4-phase orchestrator (Orient → Gather → Consolidate → Report)
 *   - `forget`      — hard-delete (scope-isolated); appends 'forget' to history;
 *                     throws `MemoryNotFound` for cross-scope or non-existent ids.
 *                     v0.6.1 T4.1 / F10 + v1.1 EC-2 absorption.
 *
 * `reflect` is intentionally NOT exposed here — consolidation IS the skill-specific
 * sleep-time work; users invoke it explicitly via `consolidate()` per ADR-0005 + D5.
 */
export interface ScopedSkillMemory {
  add(skill: SkillDraft): Promise<Skill>;
  recall(query: string, options?: SkillRecallOptions): Promise<readonly SkillWithScore[]>;
  consolidate(options?: ConsolidateOptions): Promise<ConsolidationResult>;
  forget(skillId: string): Promise<void>;
}
