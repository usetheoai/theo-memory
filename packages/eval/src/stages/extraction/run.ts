/**
 * T3.2 — extraction structural runner (LLM-free tier).
 *
 * Scores the DETERMINISTIC entity-extraction surface (CompromiseEntityExtractor,
 * consumed from the public @usetheo/memory surface) over the golden set:
 *  - precision / recall of extracted entity names vs ground truth, over the
 *    `hard` cases (Jaccard set-overlap matching, ADR D2);
 *  - `accuracy` = noise-rejection rate over the `negative` cases (fraction that
 *    correctly yield zero entities — the #111 signal);
 *  - `ambiguous` cases are excluded (the LLM-measured tier's job).
 *
 * Every number is computed over the golden set at run time, never hardcoded.
 * The result is validated against StageScoreSchema before it is returned
 * (fail-closed).
 */
import { CompromiseEntityExtractor } from '@usetheo/memory';

import { precision, recall } from '../../metrics/index.js';
import { StageScoreSchema, type StageScore } from '../../schema.js';
import { loadExtractionGolden } from './golden.js';

/** Minimal shape the runner needs from an extractor — injectable for tests. */
export interface NamedExtractor {
  extract(text: string): readonly { readonly name: string }[];
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function runExtractionEval(extractor: NamedExtractor = new CompromiseEntityExtractor()): StageScore {
  const start = Date.now();
  const rows = loadExtractionGolden();
  const hard = rows.filter((r) => r.kind === 'hard');
  const negative = rows.filter((r) => r.kind === 'negative');

  const names = (text: string): string[] => extractor.extract(text).map((e) => e.name);

  const precisions = hard.map((r) => precision(names(r.text), r.expectedEntities, 0.5));
  const recalls = hard.map((r) => recall(names(r.text), r.expectedEntities, 0.5));
  const rejected = negative.filter((r) => names(r.text).length === 0).length;
  const accuracy = negative.length === 0 ? 1 : rejected / negative.length;

  const score: StageScore = {
    stage: 'extraction',
    precision: mean(precisions),
    recall: mean(recalls),
    accuracy,
    n: hard.length,
    runtimeMs: Date.now() - start,
  };
  return StageScoreSchema.parse(score);
}
