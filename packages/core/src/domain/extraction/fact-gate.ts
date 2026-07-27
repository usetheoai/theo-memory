/**
 * M27 T2.1 — deterministic durable-fact backstop gate.
 *
 * The extraction SYSTEM_PROMPT (T1.1) carries the primary fact discipline; this is the
 * belt-and-suspenders net for the cases a prompt miss still lets through (ADR-2). It is
 * intentionally CONSERVATIVE — it drops only CLEAR non-facts (a pure question, or a
 * first-person conversational opener), never anything ambiguous, to avoid over-filtering
 * a legitimate fact (plan Risk R1). It applies ONLY on the `infer:true` extraction path;
 * the `infer:false` verbatim contract is untouched (ADR-2).
 *
 * `factGate` is pure (no I/O); `applyFactGate` wires it into the pipeline, emitting the
 * `extraction_fact_gate_dropped` audit event per drop (Princípio 3). Both live here so the
 * already-over-budget `pipeline.ts` gains only a one-line call.
 */
import type { Tracer } from '@opentelemetry/api';

import { emitEvent } from '../memory-event.js';

/** A first-person conversational opener (case-insensitive, start-of-text) — never a durable fact. */
const FIRST_PERSON_OPENER =
  /^\s*(minha recomenda|my recommendation|quer que eu|shall i\b|se voc[eê] quer|ok,?\s*vou\b|vou\s|let me\b|here is what|aqui est[aá] o que)/i;

/** True when the item's text is a CLEAR non-fact (pure question or first-person opener). */
export function isNonDurableFact(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  // Pure question: the statement ends in a question mark (tolerating a trailing quote/bracket).
  if (/[?？]["'”’)\]]*\s*$/.test(t)) return true;
  if (FIRST_PERSON_OPENER.test(t)) return true;
  return false;
}

export interface FactGateResult<T> {
  readonly kept: readonly T[];
  readonly dropped: readonly T[];
}

/**
 * Partition extracted drafts into kept (durable facts) and dropped (clear non-facts).
 * Conservative by design — see module docstring.
 */
export function factGate<T extends { readonly text: string }>(
  items: readonly T[],
): FactGateResult<T> {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    if (isNonDurableFact(item.text)) dropped.push(item);
    else kept.push(item);
  }
  return { kept, dropped };
}

/**
 * Apply the gate on the `infer:true` path, emitting `extraction_fact_gate_dropped` per drop.
 * Returns the input array unchanged when nothing is dropped (byte-identical for clean batches).
 */
export function applyFactGate<T extends { readonly text: string }>(
  extracted: readonly T[],
  tracer: Tracer | undefined,
): readonly T[] {
  const gated = factGate(extracted);
  if (gated.dropped.length === 0) return extracted;
  for (const d of gated.dropped) {
    emitEvent(tracer, 'extraction_fact_gate_dropped', { text_len: d.text.length });
  }
  return gated.kept;
}
