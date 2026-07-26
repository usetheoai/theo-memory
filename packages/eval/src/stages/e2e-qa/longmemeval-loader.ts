/**
 * e2e-qa — LongMemEval oracle dataset loader + deterministic subset selection.
 *
 * Loads + Zod-validates the oracle dataset (500 examples; "oracle" = small
 * haystacks) from the REDACTED reference clone. Selection is DETERMINISTIC
 * (first-match per bucket in dataset order) so the run is reproducible — never
 * random.
 *
 * Dataset shape (per `.claude/tmp/e2e-qa-brief.md`):
 *   question_id       — `_abs` suffix marks an ABSTENTION example
 *   question_type     — temporal-reasoning | multi-session | knowledge-update |
 *                       single-session-{preference,user,assistant}
 *   question, answer, question_date
 *   haystack_dates    — per-session date string (chronological ordering signal)
 *   haystack_sessions — list of sessions; each = list of {role, content}
 */
import { readFileSync } from 'node:fs';

import { z } from 'zod';

const turnSchema = z.object({
  role: z.string(),
  content: z.string(),
  has_answer: z.boolean().optional(),
});

const exampleSchema = z.object({
  question_id: z.string(),
  question_type: z.string(),
  question: z.string(),
  answer: z.union([z.string(), z.number()]).transform((v) => String(v)),
  question_date: z.string(),
  haystack_dates: z.array(z.string()),
  haystack_sessions: z.array(z.array(turnSchema)),
});

export type LongMemEvalExample = z.infer<typeof exampleSchema>;

const datasetSchema = z.array(exampleSchema);

/** Load + validate the full oracle dataset (500 examples). */
export function loadOracleDataset(path: string): LongMemEvalExample[] {
  const raw = readFileSync(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return datasetSchema.parse(parsed);
}

export function isAbstention(example: LongMemEvalExample): boolean {
  return example.question_id.endsWith('_abs');
}

/**
 * Deterministic N=12 subset: 3 abstention (`_abs`) examples first (in dataset
 * order), then fill non-abstention type buckets so the subset spans the main
 * question_types. First-match per bucket — no randomness.
 *
 * Buckets (non-abstention): temporal-reasoning×2, multi-session×2,
 * knowledge-update×2, single-session-preference×1, single-session-user×1,
 * single-session-assistant×1 → 9 + 3 abstention = 12.
 */
export function selectDeterministicSubset(
  dataset: LongMemEvalExample[],
): LongMemEvalExample[] {
  const selected: LongMemEvalExample[] = [];
  const seen = new Set<string>();

  // 1) First 3 abstention examples (dataset order).
  for (const ex of dataset) {
    if (selected.filter(isAbstention).length >= 3) break;
    if (isAbstention(ex) && !seen.has(ex.question_id)) {
      selected.push(ex);
      seen.add(ex.question_id);
    }
  }

  // 2) Fill non-abstention type buckets, first-match per bucket.
  const buckets: ReadonlyArray<readonly [string, number]> = [
    ['temporal-reasoning', 2],
    ['multi-session', 2],
    ['knowledge-update', 2],
    ['single-session-preference', 1],
    ['single-session-user', 1],
    ['single-session-assistant', 1],
  ];

  for (const [type, want] of buckets) {
    let got = 0;
    for (const ex of dataset) {
      if (got >= want) break;
      if (
        !isAbstention(ex) &&
        ex.question_type === type &&
        !seen.has(ex.question_id)
      ) {
        selected.push(ex);
        seen.add(ex.question_id);
        got += 1;
      }
    }
  }

  return selected;
}

/**
 * Select the run subset honoring the `E2E_QA_LIMIT` env mode:
 * - `''` (unset) → the deterministic 12-example smoke subset (backward-compatible default).
 * - `'full'`     → the whole LongMemEval_oracle set (the REDACTED-comparable run).
 * - `'<n>'`      → the first n examples in dataset order (a cheaper smoke/sample).
 *
 * Scoring, judge guard, and coverage-gate are identical across modes — only the
 * example set changes. Keeps run.ts free of the mode branching (SRP).
 */
export function selectRunSubset(
  dataset: LongMemEvalExample[],
  limitEnv: string,
): LongMemEvalExample[] {
  const mode = limitEnv.trim().toLowerCase();
  if (mode === '') return selectDeterministicSubset(dataset);
  if (mode === 'full') return dataset;
  return dataset.slice(0, Math.max(1, Number.parseInt(mode, 10) || 1));
}
