/**
 * Barrel re-export for v0.8 benchmark metric primitives.
 *
 * BLEU is DEFERRED per Drift-T1.1-1 (ADR D1 of v0-8-fixes-cycle-1).
 * `calculateBleuScore` throws `BleuMetricUnavailable` on any call;
 * surfacing the deferral loudly instead of silently propagating 0.
 *
 * @see .claude/knowledge-base/plans/v0-8-fixes-cycle-1-plan.md § T0.1
 */
export { BleuMetricUnavailable, calculateBleuScore } from './bleu.js';
export { calculateExactMatch } from './exact-match.js';
export { calculateF1Score } from './f1.js';
