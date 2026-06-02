/**
 * DMR fixture loader (Deep Memory Retrieval, REDACTED-derived MSC subset).
 *
 * Minimal shape per T2.1; T7.2 derive-dmr-subset.ts will widen the schema
 * when DMR is actually generated from MSC upstream.
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T2.1
 * @see .claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-dmr-REDACTED-REDACTED.md
 */

import { readFile } from 'node:fs/promises';

import { coerceFieldToString } from './_string-coerce.js';

interface RawDmrRow {
  readonly conversation_id?: unknown;
  readonly sessions?: unknown;
  readonly question?: unknown;
  readonly answer?: unknown;
}

export interface DmrItem {
  readonly conversationId: string;
  readonly questionText: string;
  readonly answer: string;
}

export async function loadDmrFixture(path: string): Promise<readonly DmrItem[]> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as readonly RawDmrRow[];
  return parsed.map((row) => ({
    conversationId: coerceFieldToString(row.conversation_id),
    questionText: coerceFieldToString(row.question),
    answer: coerceFieldToString(row.answer),
  }));
}
