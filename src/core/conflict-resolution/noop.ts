/**
 * NoopConflictPolicy — DEFAULT `ConflictResolutionPolicy` implementation per
 * ADR D2. Consolidates nothing: returns the empty array for ANY input,
 * preserving the ADD-only invariant (ADR-0003).
 *
 * Used by `Memory.reflect({ conflictResolution })` when the consumer either
 * omits the option entirely OR passes `new NoopConflictPolicy()` explicitly.
 * Zero LLM calls; zero side effects; pure function.
 *
 * The DEFAULT keeps v0.4a `reflect()` behavior byte-identical for consumers
 * who do not opt into the v0.7 distillation moat. Opt-in to consolidation
 * by constructing `LastWriteWinsConflictPolicy` (T1.2) or
 * `LlmJudgedMergeConflictPolicy` (T1.3).
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T1.2 + ADR D2
 */
import type {
  ConflictResolutionPolicy,
  ConflictResolutionResult,
  ConsolidationCandidate,
  ConsolidationContext,
} from '../dip/conflict-resolution-policy.js';

export class NoopConflictPolicy implements ConflictResolutionPolicy {
  readonly kind = 'noop' as const;

  async consolidate(
    candidates: readonly ConsolidationCandidate[],
    context: ConsolidationContext,
  ): Promise<readonly ConflictResolutionResult[]> {
    void candidates;
    void context;
    await Promise.resolve();
    return [];
  }
}
