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
  // dashboard-memories-tab-standardization T2.2 — Princípio 3 auditability per
  // ADR D2: fires when LocalScopedMemory.getAll consumed N rows whose
  // VectorStoreResult.createdAt was undefined (stale-impl adapter that did
  // NOT project the column). Attributes carry `count: N` per EC-7 per-request
  // aggregation discipline — emit ONCE per getAll call with aggregated count,
  // NOT per-row (a 10k-row legacy scope would explode logs otherwise).
  // NOT emitted when count = 0 (no-op observability mirror of
  // recall_threshold_filtered).
  // @see .claude/knowledge-base/plans/dashboard-memories-tab-standardization-plan.md § ADR D2 + EC-7
  'getall_temporal_fallback',
  // code-review-fixes-v0-2-1 T2.1 — LLM parse/validation error (SyntaxError or ZodError)
  // distinct from network error (which propagates). Princípio 3 observability.
  'extraction_parse_failure',
  // code-review-fixes-v0-2-1 T2.2 — embedder returned zero-dim vector in per-row fallback.
  'embed_zero_dim_skipped',
  // code-review-fixes-v0-2-1 T2.3 — history persist failed (non-fatal; surfaces silently swallowed error).
  'history_persist_failed',
  // entity-extraction-nodes-slice1 T3.1 — Phase 7 entity linking failed (non-fatal;
  // fail-soft per ADR D3 — a remember() MUST NEVER fail because entity linking
  // failed. Mirrors history_persist_failed. @see CLAUDE.md § IMPORTANTE Princípio 3
  'entity_linking_failed',
  // entity-relation-extraction-slice2 T2.0 — Phase 7 edge linking succeeded; attr
  // `edge_count` = relation edges persisted for the memory. Princípio 3 observability.
  'entity_edge_linked',
  // entity-relation-extraction-slice2 T2.0 — Phase 7 edge linking failed (non-fatal;
  // fail-soft via an INDEPENDENT try/catch from node linking, so a node-link success
  // still emits entity_linked even when edge linking throws — a remember() MUST NEVER
  // fail because edge linking failed). @see CLAUDE.md § IMPORTANTE Princípio 3
  'entity_edge_linking_failed',
  // themory-scoped-forget-and-retrieval-counter T2.3 — the per-scope recall
  // counter increment failed (non-fatal; fail-soft per Princípio 3 — a recall()
  // MUST NEVER fail because `retrieval_api_usage` could not be bumped). Mirrors
  // history_persist_failed. @see CLAUDE.md § IMPORTANTE Princípio 3
  'retrieval_counted_failed',
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
