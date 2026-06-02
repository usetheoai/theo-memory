/**
 * Barrel re-export for v0.8 benchmark metric primitives.
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T1.1
 */
export { calculateBleuScore, isBleuAvailable } from './bleu.js';
export { calculateExactMatch } from './exact-match.js';
export { calculateF1Score } from './f1.js';
