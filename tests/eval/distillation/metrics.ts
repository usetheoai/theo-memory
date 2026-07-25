/**
 * M21 re-export shim. The metric primitives moved to their authoritative home
 * at `packages/eval/src/metrics/index.ts` (one definition — ADR D2 / DRY).
 * This shim is kept so the existing distillation importers
 * (`tests/unit/distillation/precision-recall.test.ts`,
 * `tests/integration/distillation/the-goal-test*.test.ts`) keep resolving
 * unchanged. No definitions live here.
 */
export {
  tokenize,
  bleuScore,
  entityOverlapJaccard,
  precision,
  recall,
  conflictResolutionAccuracy,
  type ConflictResolutionDecision,
} from '../../../packages/eval/src/metrics/index.js';
