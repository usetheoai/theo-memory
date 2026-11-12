/**
 * e2e-qa — LongMemEval dataset loader + deterministic subset selection.
 *
 * Loads + Zod-validates Oracle, S, or M dataset files from the out-of-tree
 * dataset path. Selection is DETERMINISTIC (first-match per bucket in dataset
 * order) so the run is reproducible — never random.
 *
 * Dataset shape:
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

/** Load and validate an Oracle, S, or M LongMemEval dataset file. */
export function loadLongMemEvalDataset(path: string): LongMemEvalExample[] {
  const raw = readFileSync(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return datasetSchema.parse(parsed);
}

/** @deprecated Use loadLongMemEvalDataset; retained for existing Oracle callers. */
export const loadOracleDataset = loadLongMemEvalDataset;

export function isAbstention(example: LongMemEvalExample): boolean {
  return example.question_id.endsWith('_abs');
}

/** Session timestamp in ms; unparseable dates sort last (`Number.MAX_SAFE_INTEGER`). */
export function parseHaystackDate(value: string): number {
  const cleaned = value.replace(/\([A-Za-z]{3}\)/, '').replace(/\s+/g, ' ').trim();
  const parsed = Date.parse(cleaned);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

/** Flatten all source sessions chronologically; maxTurns=0 preserves the complete history. */
export function chronologicalTurns(
  example: LongMemEvalExample,
  maxTurns = 0,
): { role: string; content: string; sourceDate: string }[] {
  if (!Number.isInteger(maxTurns) || maxTurns < 0) throw new Error('maxTurns must be a non-negative integer');
  const indexed = example.haystack_sessions.map((session, i) => ({
    session,
    date: parseHaystackDate(example.haystack_dates[i] ?? ''),
    sourceDate: example.haystack_dates[i] ?? '',
    order: i,
  }));
  indexed.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date - b.date));

  const turns: { role: string; content: string; sourceDate: string }[] = [];
  for (const { session, sourceDate } of indexed) {
    for (const turn of session) {
      if (maxTurns > 0 && turns.length >= maxTurns) return turns;
      turns.push({ role: turn.role, content: turn.content, sourceDate });
    }
  }
  return turns;
}

/** Return complete chronological sessions; a positive cap truncates only the final session. */
export function chronologicalSessions(
  example: LongMemEvalExample,
  maxTurns = 0,
): { turns: { role: string; content: string }[]; sourceDate: string }[] {
  if (!Number.isInteger(maxTurns) || maxTurns < 0) throw new Error('maxTurns must be a non-negative integer');
  const indexed = example.haystack_sessions.map((turns, i) => ({
    turns,
    date: parseHaystackDate(example.haystack_dates[i] ?? ''),
    sourceDate: example.haystack_dates[i] ?? '',
    order: i,
  }));
  indexed.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date - b.date));

  const sessions: { turns: { role: string; content: string }[]; sourceDate: string }[] = [];
  let remaining = maxTurns;
  for (const session of indexed) {
    if (maxTurns > 0 && remaining === 0) break;
    const turns = maxTurns > 0 ? session.turns.slice(0, remaining) : session.turns;
    if (turns.length > 0) sessions.push({ turns, sourceDate: session.sourceDate });
    if (maxTurns > 0) remaining -= turns.length;
  }
  return sessions;
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
  const buckets: readonly (readonly [string, number])[] = [
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
 * - `'full'`     → the whole dataset selected by `E2E_QA_DATASET`.
 * - `'<n>'`      → the first n examples in dataset order (a cheaper smoke/sample).
 *
 * Prompts and scoring are identical across modes; only the example set changes. Keeps run.ts free of the mode branching (SRP).
 */
export function selectRunSubset(
  dataset: LongMemEvalExample[],
  limitEnv: string,
  idsEnv = '',
): LongMemEvalExample[] {
  const requestedIds = idsEnv.split(',').map((id) => id.trim()).filter(Boolean);
  if (requestedIds.length > 0) {
    const byId = new Map(dataset.map((example) => [example.question_id, example]));
    const unknownIds = requestedIds.filter((id) => !byId.has(id));
    if (unknownIds.length > 0) {
      throw new Error(`Unknown LongMemEval question IDs: ${unknownIds.join(', ')}`);
    }
    return requestedIds.map((id) => byId.get(id) as LongMemEvalExample);
  }
  const mode = limitEnv.trim().toLowerCase();
  if (mode === '') return selectDeterministicSubset(dataset);
  if (mode === 'full') return dataset;
  return dataset.slice(0, Math.max(1, Number.parseInt(mode, 10) || 1));
}
