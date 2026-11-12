/**
 * M9 — SessionToGlobalConsolidationPolicy: promotes a durable session cluster to global.
 *
 * Each active session memory can promote when its distinct identified original-source
 * count reaches the configured threshold (default two). Assertion counts and retries
 * are not independent confirmations. Promotion keeps the row and its provenance.
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

  /** @param threshold minimum distinct identified origins for promotion; default two. */
  constructor(private readonly threshold = 2) {
    if(!Number.isSafeInteger(threshold)||threshold<2)throw new RangeError('Promotion requires at least two distinct origins.');
  }

  consolidate(
    candidates: readonly ConsolidationCandidate[],
    _context: ConsolidationContext,
  ): Promise<readonly ConflictResolutionResult[]> {
    // Promotion evaluates each memory independently. Below-threshold rows remain
    // session-scoped; rejectedMemoryIds stays empty because promotion is additive.
    const results: ConflictResolutionResult[] = [];
    for (const c of candidates) {
      const count = c.distinctSourceCount ?? 0;
      if (c.expiresAt != null && c.expiresAt.getTime() <= _context.observationDate.getTime()) continue;
      if (count < this.threshold) {
        continue;
      }
      results.push({
        keptMemoryId: c.memoryId,
        rejectedMemoryIds: [],
        reason: `promoted: distinct_source_count ${count} >= ${this.threshold} (Princípio 1)`,
        policyName: POLICY_NAME,
        originalEpisodeIds: [c.memoryId],
      });
    }
    return Promise.resolve(results);
  }
}
