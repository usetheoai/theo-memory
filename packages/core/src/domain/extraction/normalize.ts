/**
 * Normalize the raw LLM extraction response before the strict zod parse.
 *
 * Self-heals the common LLM divergences so `AdditiveExtractionSchema` stays strict:
 * - numeric `linked_memory_ids: [1, 2]` → string ids (gpt-4o-mini divergence, team report
 *   2026-06-08);
 * - M27 T2.3 (normalize-facts parity): a weaker LLM returns the fact under `fact`
 *   instead of `text`, and/or omits the sequential `id` — coerce both before the parse.
 *
 * Extracted from `pipeline.ts` (single responsibility + keeps that over-budget file from
 * growing further).
 */
import { ExtractedEvidenceSchema } from './prompt.js';

const MISPLACED_DURABILITY_VALUES = new Set(['durable', 'temporary', 'tentative']);

/** Why the evidence of one fact was repaired or dropped. */
export type InvalidEvidenceReason = 'time_in_durability' | 'unreadable';

/**
 * `onInvalidEvidence` is called once for each fact whose evidence was repaired or dropped, so the
 * caller can record it. One malformed evidence used to fail the parse of the whole response, and
 * with it every other fact of the write (#277).
 */
export function coerceExtractionResponse(raw: unknown, onInvalidEvidence?: (reason: InvalidEvidenceReason) => void): unknown {
  const obj: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (
    obj !== null &&
    typeof obj === 'object' &&
    Array.isArray((obj as { memory?: unknown }).memory)
  ) {
    const mem = (obj as { memory: unknown[] }).memory;
    mem.forEach((item, idx) => {
      if (item === null || typeof item !== 'object') return;
      const rec = item as {
        id?: unknown;
        text?: unknown;
        fact?: unknown;
        linked_memory_ids?: unknown;
        evidence?: unknown;
      };
      if (typeof rec.text !== 'string' && typeof rec.fact === 'string') rec.text = rec.fact;
      if (typeof rec.id !== 'string') rec.id = String(idx + 1);
      if (Array.isArray(rec.linked_memory_ids)) {
        rec.linked_memory_ids = rec.linked_memory_ids.map(String);
      }
      // LLMs sometimes place a durability value in `evidence.kind` (e.g.
      // kind="tentative"), although the schema keeps epistemic status
      // (stated/inferred) separate from durability. Preserve the cautious signal
      // in its correct field rather than silently dropping the whole memory.
      if (rec.evidence !== null && typeof rec.evidence === 'object') {
        const evidence = rec.evidence as { kind?: unknown; durability?: unknown };
        if (
          typeof evidence.kind === 'string' &&
          MISPLACED_DURABILITY_VALUES.has(evidence.kind)
        ) {
          evidence.durability = evidence.kind;
          evidence.kind = 'inferred';
        }
        // The tense written where the durability goes: a plan or a past event. It is kept as
        // what was said, with its tense; neither gets an expiry (ADR-0035).
        const record = rec.evidence as Record<string, unknown>;
        if ((record['durability'] === 'future' || record['durability'] === 'past') && record['time'] === undefined) {
          record['time'] = record['durability'];
          record['durability'] = 'temporary';
          onInvalidEvidence?.('time_in_durability');
        }
        // Anything else that the schema would refuse is dropped from this fact alone. The fact
        // stays, with unknown provenance, as a fact from an extractor that sends no evidence.
        if (!ExtractedEvidenceSchema.safeParse(record).success) {
          delete rec.evidence;
          onInvalidEvidence?.('unreadable');
        }
      }
    });
  }
  return obj;
}
