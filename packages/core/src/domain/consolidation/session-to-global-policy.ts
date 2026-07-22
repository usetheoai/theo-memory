/**
 * M9 — SessionToGlobalConsolidationPolicy: promotes a durable session cluster to global.
 *
 * A `ConflictResolutionPolicy` impl (reuses the shipped DIP — ADR D1) whose decision is:
 * a cosine-similar cluster of session memories is PROMOTED when its representative (the
 * highest `confirmation_count`) is durable — `confirmation_count ≥ threshold` (Princípio 1;
 * the ≥3 default is a theo-memory design choice, NOT a copied reference pattern — ADR D3).
 * The representative is kept; the rest of the cluster are rejected (soft-deleted at
 * persistence, T2.1); the promotion itself (session_id→NULL) is T2.1's `promoteToGlobal`.
 *
 * PURE — no I/O. `reason` records the trigger; `originalEpisodeIds` carries the lineage.
 */
import type {
  ConflictResolutionPolicy,
  ConflictResolutionResult,
  ConsolidationCandidate,
  ConsolidationContext,
} from '../dip/conflict-resolution-policy.js';

const POLICY_NAME = 'session-to-global';

export class SessionToGlobalConsolidationPolicy implements ConflictResolutionPolicy {
  readonly kind = POLICY_NAME;

  /** @param threshold minimum `confirmation_count` for promotion (Princípio 1; default 3, ADR D3). */
  constructor(private readonly threshold = 3) {}

  consolidate(
    candidates: readonly ConsolidationCandidate[],
    _context: ConsolidationContext,
  ): Promise<readonly ConflictResolutionResult[]> {
    if (candidates.length === 0) {
      return Promise.resolve([]);
    }
    // The representative = the highest-confirmation candidate (the durable mention).
    const representative = candidates.reduce((best, c) =>
      (c.confirmationCount ?? 0) > (best.confirmationCount ?? 0) ? c : best,
    );
    const maxCount = representative.confirmationCount ?? 0;
    if (maxCount < this.threshold) {
      // One-off / below threshold → abstain; it decays via the shipped triadic eviction.
      return Promise.resolve([]);
    }
    const rejectedMemoryIds = candidates
      .filter((c) => c.memoryId !== representative.memoryId)
      .map((c) => c.memoryId);
    return Promise.resolve([
      {
        keptMemoryId: representative.memoryId,
        rejectedMemoryIds,
        reason: `promoted: confirmation_count ${maxCount} >= ${this.threshold} (Princípio 1)`,
        policyName: POLICY_NAME,
        originalEpisodeIds: candidates.map((c) => c.memoryId),
      },
    ]);
  }
}
