/**
 * LoCoMo fixture loader.
 *
 * Preserves the speaker_a / speaker_b boundary that LoCoMo encodes per
 * conversation; downstream adapters use these to derive per-speaker
 * scope per EC-5.
 *
 * LoCoMo is CC-BY-NC-SA 4.0 — see benchmarks/README.md for distribution
 * constraints. Per ADR D4, fixtures are downloaded at install time;
 * never committed to the repo.
 *
 */

import { readFile } from 'node:fs/promises';

import { coerceFieldToString } from './_string-coerce.js';

interface RawLoCoMoRow {
  readonly sample_id?: unknown;
  readonly speaker_a?: unknown;
  readonly speaker_b?: unknown;
  readonly conversation?: unknown;
  readonly qa?: unknown;
}

interface RawLoCoMoQA {
  readonly question_id?: unknown;
  readonly question?: unknown;
  readonly answer?: unknown;
  readonly category?: unknown;
}

export interface LoCoMoQA {
  readonly questionId: string;
  readonly questionText: string;
  readonly answer: string;
  readonly category: string;
}

export interface LoCoMoConversation {
  readonly sampleId: string;
  readonly speakerA: string;
  readonly speakerB: string;
  readonly qa: readonly LoCoMoQA[];
}

export async function loadLoCoMoFixture(path: string): Promise<readonly LoCoMoConversation[]> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as readonly RawLoCoMoRow[];
  return parsed.map((row) => {
    const rawQa: readonly RawLoCoMoQA[] = Array.isArray(row.qa) ? row.qa : [];
    return {
      sampleId: coerceFieldToString(row.sample_id),
      speakerA: coerceFieldToString(row.speaker_a),
      speakerB: coerceFieldToString(row.speaker_b),
      qa: rawQa.map((q) => ({
        questionId: coerceFieldToString(q.question_id),
        questionText: coerceFieldToString(q.question),
        answer: coerceFieldToString(q.answer),
        category: coerceFieldToString(q.category, 'uncategorized'),
      })),
    };
  });
}
