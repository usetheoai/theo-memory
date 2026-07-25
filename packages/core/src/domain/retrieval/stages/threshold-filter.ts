/**
 * Step 8 threshold gate + the scoring types shared across recall stages (M19 / #124).
 *
 * Extracted from `pipeline.ts` for cohesion — this module owns the per-candidate scoring
 * shapes (`Payload`, `Candidate`, `ScoredRow`, `DroppedCandidate`) and the gate itself, which
 * the initial threshold pass AND the adaptive-relax re-filter both call. Leaf module: it imports
 * only `combineScores` (scoring) and the trace-row type, so no stage cycle is possible.
 */
import type { RecallTraceRow } from '../../dip/recall-trace-store.js';
import { combineScores } from '../../scoring.js';

export type Payload = Record<string, string | number | boolean | null>;

export interface Candidate {
  semantic: number;
  bm25: number;
  entity: number;
  payload: Payload;
}

export interface ScoredRow {
  id: string;
  payload: Payload;
  score: number;
}

/**
 * explainable-recall (S1) — a dropped candidate captured for the recall trace, shaped as a
 * `RecallTraceRow` minus the batch-envelope fields (added by the store). Collected inside
 * `filterAtThreshold` (threshold drops) + the MMR branch (mmr_redundant).
 */
export type DroppedCandidate = Omit<
  RecallTraceRow,
  'recallId' | 'workspaceId' | 'scopeKey' | 'createdAt'
>;

/**
 * Step 8 gate (used by the initial threshold filter AND the adaptive Step 8.6 relax
 * corrective). Applies the semantic gate + additive combine + final-threshold gate + NaN drop,
 * returning the surviving rows (unsorted). Same logic for both call sites so the corrective
 * re-filter is byte-consistent with the initial filter (EC-1 + DRY).
 */
/**
 * Records one dropped candidate with its component breakdown (DRY — the threshold
 * gates AND the post-threshold recency-collapse stage all funnel drops through here).
 */
export function recordDrop(
  drops: DroppedCandidate[] | undefined,
  id: string,
  c: Candidate,
  threshold: number,
  composite: number | null,
  dropReason: DroppedCandidate['dropReason'],
): void {
  drops?.push({
    memoryId: id,
    semantic: c.semantic,
    bm25: c.bm25,
    entity: c.entity,
    composite,
    threshold,
    dropReason,
  });
}

export function filterAtThreshold(
  candidates: ReadonlyMap<string, Candidate>,
  maxScore: number,
  threshold: number,
  // explainable-recall (S1) — optional collector: when present, each dropped candidate is pushed
  // with its component breakdown + drop-reason. Passed ONLY by the initial filter call (NOT the
  // adaptive relax re-filter) so the trace reflects the primary threshold pass.
  drops?: DroppedCandidate[],
): ScoredRow[] {
  const out: ScoredRow[] = [];
  for (const [id, c] of candidates.entries()) {
    if (c.semantic < threshold) {
      // semantic_gate: dropped BEFORE the composite is computed → composite null (EC-6).
      recordDrop(drops, id, c, threshold, null, 'semantic_gate');
      continue;
    }
    const combined = combineScores(
      { semantic: c.semantic, bm25: c.bm25, entityBoostScore: c.entity },
      maxScore,
    );
    if (combined < threshold || Number.isNaN(combined)) {
      const isNan = Number.isNaN(combined);
      recordDrop(drops, id, c, threshold, isNan ? null : combined, isNan ? 'nan' : 'sub_threshold');
      continue;
    }
    out.push({ id, payload: c.payload, score: combined });
  }
  return out;
}
