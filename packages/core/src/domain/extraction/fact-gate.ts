/**
 * M27 — durable-fact predicates + the deterministic backstop gate.
 *
 * The extraction SYSTEM_PROMPT (T1.1) carries the PRIMARY discipline; this is the
 * belt-and-suspenders net for what a prompt miss still lets through (ADR-2). It is the
 * single source of truth for "is this a durable fact?" — the write-path gate, the one-shot
 * cleanup, and the eval parity metric all import from here (DRY; the review flagged the
 * predicate duplicated across three files). Applies ONLY on the `infer:true` extraction
 * path; the `infer:false` verbatim contract is untouched.
 *
 * `factGate`/predicates are pure (no I/O); `applyFactGate` wires the gate into the pipeline,
 * emitting `extraction_fact_gate_dropped` per drop (Princípio 3). Both live here so the
 * already-over-budget `pipeline.ts` gains only a one-line call.
 */
import type { Tracer } from '@opentelemetry/api';

import { emitEvent } from '../memory-event.js';

/** Atomic-fact length ceiling — a durable fact is short; longer is a dump or multi-fact. */
export const ATOMIC_FACT_MAX_CHARS = 200;
/** Above this, a multi-sentence / multi-line row is a transcript dump, not an atomic fact. */
export const DUMP_MIN_CHARS = 200;

/**
 * First-person conversational opener (case-insensitive, start-of-text) — never a durable fact.
 * Covers the common voices review flagged as bypassing a too-narrow list: recommendations,
 * opinions, intentions, and first-person plural decisions, in PT and EN.
 */
const FIRST_PERSON_OPENER =
  /^\s*(minha recomenda|my recommendation|recomendo que\b|i recommend\b|quer que eu|shall i\b|should i\b|se voc[eê] quer|ok,?\s*vou\s+[a-zà-ú]{2}|vou\s+[a-zà-ú]{2}|acho que\b|i think (we|you|it|that|i)\b|eu acho\b|eu recomendo\b|penso que\b|we decided\b|decidimos\b|here is what|aqui est[aá] o que|na minha (opini|leitura))/i;

/** True when the text is a pure question (ends in a question mark, tolerating a trailing quote). */
export function isInterrogative(text: string): boolean {
  return /[?？]["'”’)\]]*\s*$/.test(text.trim());
}

/** True when the text opens in first-person conversational voice. */
export function isFirstPersonOpener(text: string): boolean {
  return FIRST_PERSON_OPENER.test(text.trim());
}

/**
 * True when the text is a multi-paragraph / multi-sentence transcript dump rather than an
 * atomic fact — the 400-word narration failure mode. Conservative: needs BOTH length AND
 * multi-sentence/multi-line structure, so a single long declarative fact is not caught.
 */
export function isDump(text: string): boolean {
  const t = text.trim();
  if (t.length <= DUMP_MIN_CHARS) return false;
  const sentenceBreaks = (t.match(/[.!?]\s/g) ?? []).length;
  return sentenceBreaks >= 2 || t.includes('\n');
}

export type NonFactReason = 'question' | 'first_person' | 'dump';

/** Classify a CLEAR non-fact, or null when the text is a durable fact. Single source of truth. */
export function classifyNonFact(text: string): NonFactReason | null {
  const t = text.trim();
  if (t.length === 0) return 'question'; // empty is not a durable fact; bucket with the cheapest
  if (isInterrogative(t)) return 'question';
  if (isFirstPersonOpener(t)) return 'first_person';
  if (isDump(t)) return 'dump';
  return null;
}

/** True when the item's text is a CLEAR non-fact (question / first-person / dump). */
export function isNonDurableFact(text: string): boolean {
  return classifyNonFact(text) !== null;
}

/** True when the text is a single, declarative, third-person, atomic durable fact. */
export function isSingleThirdPersonFact(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > ATOMIC_FACT_MAX_CHARS) return false;
  return classifyNonFact(t) === null;
}

export interface FactGateResult<T> {
  readonly kept: readonly T[];
  readonly dropped: readonly (T & { readonly reason: NonFactReason })[];
}

/** Partition extracted drafts into kept (durable facts) and dropped (clear non-facts). */
export function factGate<T extends { readonly text: string }>(
  items: readonly T[],
): FactGateResult<T> {
  const kept: T[] = [];
  const dropped: (T & { reason: NonFactReason })[] = [];
  for (const item of items) {
    const reason = classifyNonFact(item.text);
    if (reason === null) kept.push(item);
    else dropped.push({ ...item, reason });
  }
  return { kept, dropped };
}

/**
 * Apply the gate on the `infer:true` path, emitting `extraction_fact_gate_dropped` per drop
 * (with its reason). Returns the input unchanged when nothing is dropped (byte-identical for
 * clean batches).
 */
export function applyFactGate<T extends { readonly text: string }>(
  extracted: readonly T[],
  tracer: Tracer | undefined,
): readonly T[] {
  const gated = factGate(extracted);
  if (gated.dropped.length === 0) return extracted;
  for (const d of gated.dropped) {
    emitEvent(tracer, 'extraction_fact_gate_dropped', { reason: d.reason, text_len: d.text.length });
  }
  return gated.kept;
}
