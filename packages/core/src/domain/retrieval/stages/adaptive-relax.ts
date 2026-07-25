/**
 * Step 8.6 — adaptive-retrieval grade-and-correct (Item 13; M19 / #124, extracted from pipeline.ts).
 *
 * Calls the policy's `assess` on the threshold-passing results; on `action:'relax'` with a valid
 * `relaxedThreshold` (EC-1 clamp: `0 <= rt < threshold`), re-filters the pre-threshold `candidates`
 * pool at the lower threshold and returns the (re-sorted) corrected pool + emits
 * `retrieval_corrected`. On `reject`, a relax that surfaces nothing, OR an out-of-range
 * `relaxedThreshold`, emits `retrieval_low_confidence` and returns the original pool. Fail-soft
 * (ADR D4): a policy throw degrades to the original pool + `retrieval_policy_failed{hook:'assess'}`.
 */
import type { Tracer } from '@opentelemetry/api';

import type { AdaptiveRetrievalPolicy, AdaptiveTuning } from '../../dip/adaptive-retrieval-policy.js';
import { emitEvent } from '../../memory-event.js';
import type { MemoryItemWithScore } from '../../memory-item.js';

import { filterAtThreshold, type Candidate, type ScoredRow } from './threshold-filter.js';

export async function applyAdaptiveAssessStage(
  query: string,
  scoredSorted: readonly ScoredRow[],
  candidates: ReadonlyMap<string, Candidate>,
  maxScore: number,
  threshold: number,
  policy: AdaptiveRetrievalPolicy,
  tuning: AdaptiveTuning | undefined,
  rowToItem: (row: ScoredRow) => MemoryItemWithScore,
  scopeTier: string,
  tracer: Tracer | undefined,
): Promise<readonly ScoredRow[]> {
  try {
    const results = scoredSorted.map(rowToItem);
    const assessment = await policy.assess(query, results, tuning);
    if (assessment.action === 'accept') {
      return scoredSorted;
    }
    if (assessment.action === 'reject') {
      emitEvent(tracer, 'retrieval_low_confidence', {
        scope_tier: scopeTier,
        reason: assessment.reason ?? 'rejected',
      });
      return scoredSorted;
    }
    // action === 'relax' — per-call override wins over the policy's value.
    const rt = tuning?.relaxedThreshold ?? assessment.relaxedThreshold;
    // EC-1 clamp: relax ONLY when 0 <= rt < threshold (no no-op widening / no out-of-range
    // surfacing). When a relax WAS requested but the threshold is invalid, the requested
    // correction could not be applied ⇒ the results stay weak ⇒ that IS a low-confidence outcome.
    if (rt === undefined || Number.isNaN(rt) || rt < 0 || rt >= threshold) {
      emitEvent(tracer, 'retrieval_low_confidence', {
        scope_tier: scopeTier,
        reason: 'relax_threshold_invalid',
        requested_threshold: rt ?? -1,
        original_threshold: threshold,
      });
      return scoredSorted;
    }
    const relaxed = filterAtThreshold(candidates, maxScore, rt);
    relaxed.sort((a, b) => b.score - a.score);
    // EC-2: a relax that surfaces nothing new ⇒ low confidence, original pool.
    if (relaxed.length <= scoredSorted.length) {
      emitEvent(tracer, 'retrieval_low_confidence', {
        scope_tier: scopeTier,
        reason: 'relax_surfaced_nothing',
        pool_size: scoredSorted.length,
        relaxed_size: relaxed.length,
      });
      return scoredSorted;
    }
    emitEvent(tracer, 'retrieval_corrected', {
      scope_tier: scopeTier,
      from_threshold: threshold,
      to_threshold: rt,
      surfaced: relaxed.length - scoredSorted.length,
    });
    return relaxed;
  } catch (err) {
    // ADR D4 fail-soft — a policy outage NEVER takes down recall. Emitted as a DISTINCT
    // policy-failure signal so a crash is not conflated with a genuine low-confidence outcome.
    emitEvent(tracer, 'retrieval_policy_failed', {
      scope_tier: scopeTier,
      hook: 'assess',
      error: err instanceof Error ? err.name : 'unknown',
    });
    return scoredSorted;
  }
}
