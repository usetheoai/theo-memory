/**
 * LastWriteWinsConflictPolicy — deterministic `ConflictResolutionPolicy` per
 * ADR D2. Picks the candidate with the most recent `createdAt` as kept;
 * remaining candidates are rejected (soft-deleted by the wiring layer T2.1
 * via `t_invalid = NOW()` per ADR-0006).
 *
 * EC-1 absorption (plan v1.1 edge-case review): when two or more candidates
 * share the SAME `createdAt` timestamp — a realistic scenario when N rows
 * commit in a single transaction with a request-start timestamp captured
 * once — the comparator falls back to a deterministic lexicographic DESC
 * tie-break on `memoryId`. Without this guard,
 * `Array.prototype.sort` callbacks of the shape `(a, b) => b.createdAt -
 * a.createdAt` return 0 for ties and the V8 TimSort preserves insertion
 * order, but consumer-side input ordering varies (DB row-order is
 * non-deterministic across reflect() invocations). The 10-run stability
 * test asserts the comparator + sort combination yields identical winners.
 *
 * Pure function: zero LLM calls, zero I/O, zero stateful side effects.
 *
 */
import type {
  ConflictResolutionPolicy,
  ConflictResolutionResult,
  ConsolidationCandidate,
  ConsolidationContext,
} from '../dip/conflict-resolution-policy.js';

/**
 * Total-order comparator: createdAt DESC primary, memoryId DESC tie-break.
 * Exported for tests that need to assert the comparator independently of
 * the policy class wiring.
 */
export function compareCandidatesDesc(
  a: ConsolidationCandidate,
  b: ConsolidationCandidate,
): number {
  const dt = b.createdAt.getTime() - a.createdAt.getTime();
  return dt !== 0 ? dt : b.memoryId.localeCompare(a.memoryId);
}

/**
 * /review v0-7 F-C1 mass-tombstone guard.
 *
 * The shipped `recallConsolidationCandidates` returns the ENTIRE active
 * scope as one bag — no cosine clustering at ≥ 0.95 (which plan T2.1's
 * entity-link clustering precedent declared). Combined with LWW returning
 * `{ kept: 1, rejected: N-1 }`, a single `reflect({ conflictResolution:
 * LWW })` against a 50-memory scope would soft-delete 49 unrelated facts.
 *
 * Plan v1.2 amendment (next commit) dismisses the cluster-by-cosine
 * decision and pivots to "whole-scope LWW with caller-supplied guard"
 * because (a) cosine clustering at the recall layer changes the entire
 * v0.7 wiring contract, (b) per-policy guard at the decision layer is
 * the minimal surface that mitigates the risk while preserving the
 * existing 9/9 task delivery.
 *
 * Default `maxRejectionRatio` = 0.95: a LWW call that would reject MORE
 * than 95% of the active scope ABSTAINS (returns []). At 20 candidates
 * (19 rejected, ratio 0.95) the policy still consolidates; at 21 (20
 * rejected, ratio ~0.952) it abstains. This empirical line blocks the
 * mass-tombstone risk (50-row scope → 49 deleted) while preserving the
 * normal "consolidate 2-20 semantic duplicates" use case. Consumer can
 * opt out (set to 1.0) when they have already scope-isolated the
 * candidate set OR opt INTO a stricter ratio for sensitive scopes.
 */
export interface LastWriteWinsConflictPolicyOptions {
  /**
   * If the LWW pick would reject MORE than `maxRejectionRatio * N` rows
   * out of `N` candidates, the policy ABSTAINS (returns []). Default: 0.95.
   *
   * Set to `1.0` to opt out (e.g. when the caller has already cluster-
   * isolated the input set by cosine similarity OR the caller intends
   * the whole-scope semantics). Values < 0 or > 1.0 are clamped.
   */
  readonly maxRejectionRatio?: number;
}

const DEFAULT_MAX_REJECTION_RATIO = 0.95;

export class LastWriteWinsConflictPolicy implements ConflictResolutionPolicy {
  readonly kind = 'last-write-wins' as const;
  readonly #maxRejectionRatio: number;

  constructor(options?: LastWriteWinsConflictPolicyOptions) {
    const raw = options?.maxRejectionRatio ?? DEFAULT_MAX_REJECTION_RATIO;
    // Clamp [0, 1]. A value of 0 means "never reject anything" → policy
    // becomes a no-op which is effectively `NoopConflictPolicy`; a value
    // of 1.0 means "no guard" (matches v0.7 v1.1 original behavior).
    this.#maxRejectionRatio = Math.max(0, Math.min(1, raw));
  }

  async consolidate(
    candidates: readonly ConsolidationCandidate[],
    context: ConsolidationContext,
  ): Promise<readonly ConflictResolutionResult[]> {
    void context;
    await Promise.resolve();
    if (candidates.length < 2) return [];
    const sorted = [...candidates].sort(compareCandidatesDesc);
    const [keep, ...rejected] = sorted;
    if (keep === undefined) return [];
    // /review v0-7 F-C1: mass-tombstone guard.
    const rejectionRatio = rejected.length / candidates.length;
    if (rejectionRatio > this.#maxRejectionRatio) {
      // ABSTAIN: refuse to mass-tombstone. Returning [] means the wiring
      // layer persists nothing — no consolidation_history audit row, no
      // soft-delete. Caller can opt out via `{ maxRejectionRatio: 1.0 }`.
      return [];
    }
    return [
      {
        keptMemoryId: keep.memoryId,
        rejectedMemoryIds: rejected.map((r) => r.memoryId),
        reason: 'last-write-wins',
        policyName: this.kind,
        originalEpisodeIds: candidates.map((c) => c.memoryId),
      },
    ];
  }
}
