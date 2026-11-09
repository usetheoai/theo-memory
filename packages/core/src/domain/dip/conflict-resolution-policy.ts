/**
 * ConflictResolutionPolicy DIP — 9th DIP, strategy for episodic→semantic
 * distillation during `reflect()`. Resolves clusters of cosine-similar
 * memories into a kept-set + rejected-set with verbatim audit trail.
 *
 * Method count of this NEW DIP: 1 required (`consolidate`) + 1 `kind`
 * discriminator. Total 2 entries per plan T1.1 Acceptance.
 *
 * v0.7 ships THREE built-in impls per ADR D2: `NoopConflictPolicy` (DEFAULT
 * — abstain; preserves ADD-only per ADR-0003), `LastWriteWinsConflictPolicy`
 * (EC-1 lex tie-break), `LlmJudgedMergeConflictPolicy` (EC-2+4+6 at T1.3).
 *
 * Pure types — ZERO runtime impl in `src/core/`. Per architecture.md § 3,
 * this file MUST NOT import from `src/local/` or `src/cloud/`. The `LLM` DIP
 * is injected at IMPL constructor (sibling-DIP precedent), NOT in per-call
 * `ConsolidationContext`.
 *
 */
import type { Scope } from '../scope.js';

/**
 * A single memory in a cosine-similar cluster passed to `consolidate()`.
 * `memoryId` is load-bearing for EC-1 (lex tie-break by id) + EC-2 (cluster
 * ID set for LLM-response validation) + audit provenance. `text` is required
 * by `LlmJudgedMergeConflictPolicy` for prompt construction. `createdAt` is
 * required by `LastWriteWinsConflictPolicy` comparator.
 */
export interface ConsolidationCandidate {
  readonly memoryId: string;
  readonly text: string;
  readonly createdAt: Date;
  /** Facts with different authors must never be judged/superseded as one claim. */
  readonly attributedTo?: string;
  /**
   * M9 (session→global consolidation): the memory's `confirmation_count` — the
   * durability signal (Princípio 1) the `SessionToGlobalConsolidationPolicy` reads to
   * decide promotion. OPTIONAL + backward-compatible: the v0.7 distillation policies
   * (Noop / LastWriteWins / LlmJudgedMerge) do not read it, so existing callers that
   * omit it are unaffected. Populated by the reflect-orchestrator from the row's
   * `confirmationCount` when building the M9 candidate cluster.
   */
  readonly confirmationCount?: number;
  readonly distinctSourceCount?: number | null;
  readonly expiresAt?: Date | null;
}

/**
 * Per-call request-scoped context. The LLM collaborator is NOT here by design
 * — see top-of-file JSDoc for constructor-injection rationale.
 */
export interface ConsolidationContext {
  readonly scope: Scope;
  readonly observationDate: Date;
}

/**
 * One consolidation decision. Maps 1:1 to a row in the `consolidation_history`
 * table (T0.1 migration 0007). Field names match SQL column names (camelCase
 * here, snake_case in SQL); persistence is a trivial map. `rejectedMemoryIds`
 * trigger `t_invalid = NOW()` soft-delete per ADR-0006. `reason` is verbatim
 * LLM output OR a policy-name marker for non-LLM policies.
 * `originalEpisodeIds` carries the lineage trail (persisted as JSONB).
 */
export interface ConflictResolutionResult {
  readonly keptMemoryId: string;
  readonly rejectedMemoryIds: readonly string[];
  readonly reason: string;
  readonly policyName: string;
  readonly originalEpisodeIds: readonly string[];
}

/**
 * 9th DIP — strategy for episodic→semantic distillation.
 *
 * `kind`: telemetry + downstream conditional wiring discriminator.
 *
 * `consolidate(candidates, ctx)` — accepts a cluster of cosine-similar
 * memories + per-call context; returns 0..N `ConflictResolutionResult` rows.
 * Empty array = abstain (Noop default; LlmJudgedMerge on parse failure per
 * EC-2 / cluster-too-large per EC-6). One result = single keep + rejected
 * siblings. Multiple results = LLM partitioned the cluster into sub-themes
 * (each kept independently).
 */
export interface ConflictResolutionPolicy {
  readonly kind: string;

  consolidate(
    candidates: readonly ConsolidationCandidate[],
    context: ConsolidationContext,
  ): Promise<readonly ConflictResolutionResult[]>;
}
