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
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T1.2 + ADR D2
 * @see .claude/knowledge-base/reviews/v0-7-distillation-pipeline-edge-cases-2026-06-01.md § EC-1
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

export class LastWriteWinsConflictPolicy implements ConflictResolutionPolicy {
  readonly kind = 'last-write-wins' as const;

  async consolidate(
    candidates: readonly ConsolidationCandidate[],
    _context: ConsolidationContext,
  ): Promise<readonly ConflictResolutionResult[]> {
    await Promise.resolve();
    if (candidates.length < 2) return [];
    const sorted = [...candidates].sort(compareCandidatesDesc);
    const [keep, ...rejected] = sorted;
    if (keep === undefined) return [];
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
