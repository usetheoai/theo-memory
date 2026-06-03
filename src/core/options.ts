/**
 * Option-bag types for the four public verbs + parity helpers.
 *
 * @see ADR-0004 — API verbs (remember / recall / forget / reflect + parity helpers).
 * @see ADR-0006 — bi-temporal columns (asOf is uniform at the type level; runtime divergence per local v0.1).
 */
import type { ConflictResolutionPolicy } from './dip/conflict-resolution-policy.js';
import type { Filters } from './scope.js';

export interface RememberOptions {
  /** Flat key-value payload attached to the resulting memory items. @see MemoryItem.metadata for the same shape constraints. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;

  /**
   * Default `true`. When `false`, persist text verbatim without invoking the LLM extraction pipeline.
   * Useful for migration / batch import scenarios where the caller has already extracted facts.
   *
   * @see ADR-0001 — `infer: false` escape hatch.
   */
  readonly infer?: boolean;

  /**
   * v1.1 T1.1 (EC-2 absorbed): multi-peer attribution for verbatim-path callers.
   * The perspective owner of the fact — typically a peer ID (user id, agent id,
   * or `'system'` for self-statements). N-valent semantic per blueprint Q5
   * (any string accepted). Hoisted to the `attributed_to` column at persist
   * time. Read by T2.1 when `infer: false`; the LLM-extracted
   * `extracted[i].attributed_to` wins when `infer: true` (the default).
   *
   * ADR-0008 method-count cap preserved (zero new methods; one new optional param).
   *
   * @see .claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md § ADR D2
   */
  readonly attributedTo?: string;
}

export interface RecallOptions {
  /** Default `20` (Mem0 parity). Upper bound on number of memories returned. */
  readonly topK?: number;

  /** Default `0.1` (Mem0 parity). Semantic-similarity gate applied BEFORE BM25 + entity-boost composition. */
  readonly threshold?: number;

  /**
   * Bi-temporal point-in-time query. When set, recall returns the memories that were valid at the given instant.
   *
   * @see ADR-0006 — local v0.1 runtime throws BiTemporalNotSupportedLocally when this field is provided; cloud v0.5+ honors it.
   * @throws BiTemporalNotSupportedLocally — on the local runtime until v0.5+ backports the asOf query support.
   */
  readonly asOf?: Date;

  /**
   * v0.6: when `true`, restrict recall to `kind='skill'` rows. Default `false`.
   * Translated by the runtime into `Filters.kind = 'skill'` before reaching the store.
   *
   * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T2.2
   */
  readonly onlySkills?: boolean;

  /**
   * v0.6: when `false` (default), exclude rows whose `superseded_by IS NOT NULL`.
   * When `true`, include the full supersession history. Translated by the runtime
   * into `Filters.excludeSuperseded = !includeSuperseded` before reaching the store.
   *
   * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T2.2 + EC-3
   */
  readonly includeSuperseded?: boolean;
}

export interface ForgetOptions {
  /**
   * Default `false`. Soft delete via `tInvalid` (bi-temporal). When `true`, removes the row entirely (hard delete) — useful for GDPR-style erasure.
   *
   * @see ADR-0006 — soft delete sets `tInvalid: now()`; hard delete drops the row.
   */
  readonly hard?: boolean;
}

export interface ReflectOptions {
  /**
   * Default `10`. Upper bound on iterations per reflection cycle. The sleep-time worker (v0.4a) uses this as its cap.
   *
   * @see ADR-0005 — reflection trigger (explicit-only at v0.0).
   */
  readonly maxIterations?: number;

  /**
   * v0.7 episodic→semantic distillation per ADR D2. When supplied, the
   * post-derivation phase passes the recall'd memories as a single cluster
   * to `policy.consolidate(candidates, ctx)` and atomically soft-deletes
   * the rejected rows + writes one `consolidation_history` audit row per
   * returned result (EC-8). When omitted, behavior is byte-identical to
   * v0.4a (no consolidation; `NoopConflictPolicy` would also short-circuit
   * to the same result).
   *
   * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T2.1 + ADR D2
   */
  readonly conflictResolution?: ConflictResolutionPolicy;
}

export interface GetAllOptions {
  /** Default `100`. Upper bound on listed memories. */
  readonly topK?: number;

  /** Raw filter access for advanced consumers (admin paths, debugging). Most consumers use ScopedMemory.getAll which derives Filters from the scope. */
  readonly filters?: Filters;

  /**
   * v0.6 (EC-3 absorption): mirrors `RecallOptions.onlySkills` so T3.1's
   * `consolidate()` Orient phase can call `scope.getAll({onlySkills: true,
   * includeSuperseded: false})` with consistent semantics.
   */
  readonly onlySkills?: boolean;

  /**
   * v0.6 (EC-3 absorption): mirrors `RecallOptions.includeSuperseded`.
   */
  readonly includeSuperseded?: boolean;
}
