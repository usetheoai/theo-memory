/**
 * Observable events emitted by the v0.1 extraction + retrieval pipelines.
 * T4.2 of v0-1-local-runtime plan v1.3.
 *
 * Each phase boundary emits ONE event via the optional OpenTelemetry tracer
 * (per ADR D1.3). When the tracer is absent (config.tracer undefined), `emitEvent`
 * is a zero-cost no-op.
 *
 * EC-10 absorbed: `extraction_failed` fires when the LLM response fails Zod parse —
 * pipeline returns [] without throwing.
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T4.2 + ADR D1.4
 */
import type { Tracer } from '@opentelemetry/api';

export const MEMORY_EVENTS = [
  'extraction_started',
  'extraction_completed',
  'extraction_failed',
  'embedding_batch_started',
  'embedding_batch_completed',
  'embedding_batch_fallback',
  'dedup_skipped',
  'persist_started',
  'persist_completed',
  'persist_fallback',
  'history_persisted',
  'entity_linked',
  'messages_saved',
  // principles-alignment-hardening T1.1 — Princípio 3 IGNORE auditability per
  // ADR D2: fires when PgvectorStore.insert's ON CONFLICT branch UPDATEs an
  // existing row's confirmation_count instead of inserting a new one.
  // @see CLAUDE.md § IMPORTANTE Princípio 3
  'dedup_collision_confirmed',
  // principles-alignment-hardening T3.1 — Princípio 3 IGNORE auditability per
  // ADR D2: fires when runExtractionPipeline's LLM phase returns drafts=[]
  // (extracted.length === 0). Without this event, remember() returns []
  // indistinguishably from "no input" — the IGNORE decision was silent.
  // @see CLAUDE.md § IMPORTANTE Princípio 3
  'extraction_zero_facts',
  // principles-alignment-hardening T4.1 — Princípio 3 IGNORE auditability per
  // ADR D2: fires when retrieval pipeline's threshold-filter step drops N
  // sub-threshold candidates. Attributes include filtered_count so consumers
  // can dashboard the IGNORE volume. NOT emitted when filtered_count = 0
  // (no-op observability discipline).
  // @see CLAUDE.md § IMPORTANTE Princípio 3
  'recall_threshold_filtered',
] as const;

export type MemoryEvent = (typeof MEMORY_EVENTS)[number];

/** Attribute value type accepted by OTel spans. */
export type AttributeValue = string | number | boolean;

/**
 * Emit one span for the given event. No-op when tracer is undefined.
 * Each attribute is set on the active span via `setAttribute`; span ends inline.
 */
export function emitEvent(
  tracer: Tracer | undefined,
  event: MemoryEvent,
  attributes?: Readonly<Record<string, AttributeValue>>,
): void {
  if (tracer === undefined) {
    return;
  }
  tracer.startActiveSpan(event, (span) => {
    if (attributes !== undefined) {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
      }
    }
    span.end();
  });
}
