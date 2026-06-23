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
import type { SkillExecutionOptions, SkillExecutionResult } from './dip/skill-executor.js';
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
 *
 * **Identity / dedup invariant (v0.6.1+):** the row hash is derived from
 * `description` only via the canonical `hashFact` helper (architecture.md
 * § 4). Two `add()` calls with IDENTICAL `description` but DIFFERENT `code`
 * COLLIDE on `UNIQUE(hash)`; the second call surfaces the raw Postgres
 * unique-violation error (no domain wrapper at v0.6.1). To rewrite an
 * existing skill with new code, use `forget(id) + add(...)` AND revise the
 * `description` so the new row carries a distinct hash. Rationale:
 * `description` IS the embedding target (recall semantics), so it IS the
 * canonical identity — keeping code out of the hash recipe keeps semantic
 * dedup stable across refactors that leave description unchanged.
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
 * skills-cross-repo-flat-list — a skill returned by the cross-repo listing,
 * carrying the bare `repoId` it belongs to (the `agent_id` with the
 * `'{subject}:'` namespace prefix stripped). Lets a flat list across every repo
 * render a repo column without a second lookup.
 */
export interface SkillWithRepo extends Skill {
  /** The repo this skill belongs to (namespace prefix stripped from agent_id). */
  readonly repoId: string;
}

/**
 * Options consumed by the cross-repo skills listing (`Memory.listSkillsBySubject`).
 * Offset pagination mirrors the memories listing; `q` is an optional
 * case-insensitive description substring filter.
 */
export interface SkillsBySubjectOptions {
  /** When `true`, include superseded skills. Default `false`. */
  readonly includeSuperseded?: boolean;
  /** Max rows per page (listing cap). Implementation default: 100. */
  readonly limit?: number;
  /** Rows to skip (offset pagination). Default 0. */
  readonly offset?: number;
  /** Optional case-insensitive description substring filter. */
  readonly q?: string;
}

/** Page returned by the cross-repo skills listing — rows + the full match total. */
export interface SkillsBySubjectPage {
  readonly skills: readonly SkillWithRepo[];
  /** Total matching rows across all repos for the subject (NOT just this page). */
  readonly total: number;
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
 * Options consumed by `ScopedSkillMemory.getAll()`. Read-only enumeration of a
 * repo's skills — distinct from `recall()` (semantic search): `getAll` lists the
 * repo's skills without a query, for a browse/listing surface.
 */
export interface SkillListOptions {
  /**
   * When `true`, include skills whose `supersededBy IS NOT NULL`. Default `false`
   * — only the head-of-version-chain skills are returned. Mirrors
   * `SkillRecallOptions.includeSuperseded`.
   */
  readonly includeSuperseded?: boolean;

  /** Maximum number of rows. Implementation default: 100 (listing cap). */
  readonly topK?: number;
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
 *   - `add`         — write a new skill (no LLM extraction; payload is the contract).
 *                     Identity is `hashFact(description)` per architecture.md § 4;
 *                     same-description-different-code pairs collide on UNIQUE(hash).
 *                     See `SkillDraft` JSDoc for the full dedup invariant.
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
  /**
   * Read-only enumeration of the repo's skills (no query). Returns the
   * head-of-version-chain skills by default (superseded ancestors excluded
   * unless `options.includeSuperseded`). Soft-deleted rows are excluded.
   * Returns `[]` for a repo with no skills (never null). Powers the read-only
   * skills browse surface (dashboard) — distinct from `recall()` semantic search.
   */
  getAll(options?: SkillListOptions): Promise<readonly Skill[]>;
  consolidate(options?: ConsolidateOptions): Promise<ConsolidationResult>;
  forget(skillId: string): Promise<void>;
  /**
   * Execute a stored skill inside the configured `SkillExecutor` sandbox and
   * return its captured result. Opt-in/gated (ADR D3): when no executor was
   * wired into the memory, throws `SkillExecutionNotConfiguredError` — STORE-only
   * is the default. A `skillId` that is not a current skill in this repo's scope
   * (absent / superseded / cross-scope / cross-workspace) throws `MemoryNotFound`
   * (→ 404, no existence leak). A guard denial throws `ToolInvocationDeniedError`.
   *
   * @see .claude/knowledge-base/plans/agentic-skill-execution-sandbox-plan.md § T2.1 + ADR D3
   */
  execute(
    skillId: string,
    args: Readonly<Record<string, unknown>>,
    opts?: SkillExecutionOptions,
  ): Promise<SkillExecutionResult>;
}
