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

/** The `kind`/`policyName` of the M9 promotion policy — shared so the reflect-orchestrator's
 * promote-gate and the policy cannot drift (F-arch-5: a silent mismatch would disable promotion). */
export const SESSION_TO_GLOBAL_KIND = 'session-to-global';
const POLICY_NAME = SESSION_TO_GLOBAL_KIND;

export class SessionToGlobalConsolidationPolicy implements ConflictResolutionPolicy {
  readonly kind = POLICY_NAME;

  /** @param threshold minimum `confirmation_count` for promotion (Princípio 1; default 3, ADR D3). */
  constructor(private readonly threshold = 3) {}

  consolidate(
    candidates: readonly ConsolidationCandidate[],
    _context: ConsolidationContext,
  ): Promise<readonly ConflictResolutionResult[]> {
    // `candidates` is the session scope's extracted rows (NOT a pre-clustered set), so M9
    // promotes EACH durable memory INDIVIDUALLY — it never rejects a distinct fact as a
    // "duplicate". The "3 mentions → 1 promoted row" case works because 3 exact mentions
    // already dedup to ONE row with confirmation_count = 3 (Princípio 1 composite UPSERT).
    // A memory below threshold is left untouched — it decays via the shipped triadic
    // eviction. `rejectedMemoryIds` stays empty: promotion is additive, not a merge.
    const results: ConflictResolutionResult[] = [];
    for (const c of candidates) {
      const count = c.confirmationCount ?? 0;
      if (count < this.threshold) {
        continue;
      }
      results.push({
        keptMemoryId: c.memoryId,
        rejectedMemoryIds: [],
        reason: `promoted: confirmation_count ${count} >= ${this.threshold} (Princípio 1)`,
        policyName: POLICY_NAME,
        originalEpisodeIds: [c.memoryId],
      });
    }
    return Promise.resolve(results);
  }
}
