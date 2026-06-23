/**
 * v0.6: argument shapes for the local-store skill insertion methods.
 *
 * These types are NOT on the `VectorStore` DIP (per voyager-skill-library plan
 * § T2.1 design note — duck-typed extension matching the v0.4a
 * `insertDerivedMemory` precedent). They live here so both `PgvectorStore` and
 * `InMemoryVectorStore` reference the same shape, and the conformance suite
 * narrows the store type via runtime `typeof` guard.
 *
 * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T2.1
 */
import type { VectorStoreResult } from '../../domain/dip/vector-store.js';
import type { SkillLanguage } from '../../domain/skill.js';

/**
 * skills-cross-repo-flat-list T1.1 — args for the tenant-safe cross-repo skills
 * listing. `subject` is the namespace prefix (the gateway's authenticated
 * customer); the store filters `agent_id LIKE '{subject}:%'` (wildcards escaped)
 * AND `workspace_id`, returning skill rows across every repo for that subject.
 */
export interface ListSkillsBySubjectArgs {
  readonly workspaceId: string;
  readonly subject: string;
  readonly limit: number;
  readonly offset: number;
  readonly includeSuperseded: boolean;
  /** Optional case-insensitive description substring filter (bound param). */
  readonly q?: string;
}

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
    /**
     * multi-tenant-rbac-and-slice1-completion T3.1 — the workspace the skill
     * belongs to. Defaults to `'default'` at the store layer for unbound
     * callers (ADR D7), matching the `workspace_id` column default.
     */
    readonly workspaceId?: string | null;
  };
}

/**
 * Args for `insertDerivedSkill` — writes a `kind='skill'` row with non-empty
 * `derived_from` provenance (output of the v0.6 consolidate orchestrator).
 * The store rejects empty `derivedFrom` with `InvalidSkillError`.
 *
 * v0.6.1 T0.2 (F1 absorption): `code` and `codeLanguage` are nullable on the
 * derived variant — `consolidate()` writes NULL for both (the LLM-merged
 * narrative lives in `description` only; structured-draft extraction defers
 * per voyager-skill-library-fixes-v0-6-1 plan ADR D2). `InsertSkillArgs`
 * (used by `add()`) keeps both required-non-null — consumers writing skills
 * must always supply code.
 */
export interface InsertDerivedSkillArgs extends Omit<InsertSkillArgs, 'code' | 'codeLanguage'> {
  readonly code: string | null;
  readonly codeLanguage: SkillLanguage | null;
  readonly derivedFrom: readonly string[];
}

/**
 * Type guard: narrow a `VectorStore` reference to one that supports skill
 * insertion. Mirrors the v0.4a `VectorStoreWithDerivedInsert` pattern in
 * `src/local/index.ts`.
 *
 * v0.6 T3.1 additions: `markSuperseded` + `insertDerivedSkillAtomic` carry the
 * supersession contract. The atomic combo is the consolidate orchestrator's
 * preferred entry-point (pgvector wraps INSERT + UPDATE in BEGIN/COMMIT per
 * plan EC-2 absorption; in-memory runs them sequentially as best-effort).
 */
export interface VectorStoreWithSkillInsert {
  insertSkill(args: InsertSkillArgs): Promise<string>;
  insertDerivedSkill(args: InsertDerivedSkillArgs): Promise<string>;
  markSuperseded(sourceIds: readonly string[], supersededBy: string): Promise<void>;
  insertDerivedSkillAtomic(
    args: InsertDerivedSkillArgs,
    sourceIdsToSupersede: readonly string[],
  ): Promise<string>;
  /**
   * skills-cross-repo-flat-list T1.1 — list ALL skill rows for a subject across
   * every repo (tenant-safe `agent_id` prefix scan). Returns `[rows, total]`
   * mirroring `VectorStore.list`; the caller decodes each row + strips the
   * `'{subject}:'` prefix to derive `repoId`. Live-only, newest-first.
   */
  listSkillsBySubject(
    args: ListSkillsBySubjectArgs,
  ): Promise<readonly [readonly VectorStoreResult[], number]>;
}
