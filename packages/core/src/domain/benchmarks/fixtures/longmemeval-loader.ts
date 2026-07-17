/**
 * LongMemEval fixture loader.
 *
 * EC-1 absorption: the HF dataset card flags a JSON schema defect where
 * the `answer` field mixes integer + object + string types across rows.
 * `normalizeLongMemEvalAnswer` collapses the union to a single string;
 * unexpected shapes fall through to JSON.stringify (honest, not silent)
 * so downstream code can flag them rather than silently failing.
 *
 */

import { readFile } from 'node:fs/promises';

import { coerceFieldToString } from './_string-coerce.js';

interface RawLongMemEvalRow {
  readonly question_id?: unknown;
  readonly question?: unknown;
  readonly answer?: unknown;
  readonly category?: unknown;
  readonly haystack_sessions?: unknown;
}

export interface LongMemEvalItem {
  readonly questionId: string;
  readonly questionText: string;
  readonly answer: string;
  readonly category: string;
}

export function normalizeLongMemEvalAnswer(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (typeof raw === 'number') {
    return String(raw);
  }
  if (raw !== null && typeof raw === 'object' && 'text' in raw && typeof raw.text === 'string') {
    return raw.text;
  }
  return JSON.stringify(raw);
}

export async function loadLongMemEvalFixture(path: string): Promise<readonly LongMemEvalItem[]> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as readonly RawLongMemEvalRow[];
  return parsed.map((row) => ({
    questionId: coerceFieldToString(row.question_id),
    questionText: coerceFieldToString(row.question),
    answer: normalizeLongMemEvalAnswer(row.answer),
    category: coerceFieldToString(row.category, 'uncategorized'),
  }));
}
