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
  // M27 T2.1 — durable-fact backstop gate. Fires once per extracted draft the
  // deterministic gate drops as a CLEAR non-fact (a pure question or a first-person
  // conversational opener) on the infer:true path. Without it, the IGNORE decision
  // (an assistant question never stored) would be silent. Backstop to the T1.1 prompt
  // discipline; infer:false verbatim is never gated. @see CLAUDE.md § Princípio 3
  'extraction_fact_gate_dropped',
  // M27 T4.1 — one-shot write-quality cleanup (reversible soft-delete of pre-fix pollution).
  // `_forgot` fires per retired row (with its reason), `_skipped` when a per-row soft-delete
  // fails and the run degrades gracefully. Princípio 3 — the cleanup's decisions are auditable.
  'write_quality_cleanup_forgot',
  'write_quality_cleanup_skipped',
  // M13 T3.1 (#111) — `themory reextract` observability: fires once per chunk
  // with processed/skipped counters so the operator can watch backfill progress
  // (Princípio 3 — the job's IGNORE decisions are visible, never silent).
  'reextract_chunk_done',
  // m13-noise-retirement T1.1 (#111) — fires once per `--retire-mechanism` run
  // with candidates/retired/links/edges counts (dry-run included). Princípio 3:
  // the bulk forget decision is observable, never silent.
  'reextract_noise_retired',
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
  'getall_temporal_fallback',
  // code-review-fixes-v0-2-1 T2.1 — LLM parse/validation error (SyntaxError or ZodError)
  // distinct from network error (which propagates). Princípio 3 observability.
  'extraction_parse_failure',
  // A malformed provider response received one schema-repair retry before the pipeline
  // either completed successfully or emitted extraction_parse_failure.
  'extraction_parse_retry',
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
  // entity-extraction-noise-filter EG-2 — Phase 7 node linking dropped N candidate
  // entities as noise (pronoun/contraction/generic-role/verb-fragment) before
  // persist. Attribute `filtered_count` = how many were dropped. NOT emitted when
  // filtered_count = 0 (mirrors recall_threshold_filtered). Makes the IGNORE
  // decision observable. @see CLAUDE.md § IMPORTANTE Princípio 3
  'entity_noise_filtered',
  // #110 — a hard forget garbage-collected entity rows that lost their LAST
  // memory link (targeted refcount GC in the same transaction as the delete).
  // Attributes `entities_collected` + `edges_collected`. Makes graph shrinkage
  // observable (Princípio 3) — orphan entities were 48% of the dev graph before.
  'entity_gc_collected',
  // M14 T2.4a — a scoped `delete_entities`/`forgetEntity` removed a derived entity
  // (node) + its links + edges from the (workspace, user) graph. The source memories
  // are UNTOUCHED (the graph is a re-extractable projection). Attributes `entities_removed`
  // + `links_removed` + `edges_removed`. Makes the (only) destructive graph decision
  // observable — the audit trail that replaces a soft-delete tombstone (the entities
  // table has no `t_invalid`; ADR-M14-2 amendment). @see CLAUDE.md § Princípio 3
  'entity_forgotten',
  // M15 T3.1 (#122) — the recall entity boost could not be computed (the entity store
  // threw: timeout, connection reset, …) and the query proceeded WITHOUT the third
  // signal. Recall is a read path, so losing the boost beats returning an error to the
  // caller — but the degradation is never silent, because a permanently-zero boost that
  // nobody can see is exactly the defect #122 was. Attribute `error`.
  // @see CLAUDE.md § Princípio 3
  'entity_boost_degraded',
  // M15 /review (#122) — the entity boost RAN and produced a result. Attributes
  // `candidates` (how many were looked up) and `boosted` (how many received a non-zero
  // boost). Emitted on every recall where an entity store is configured, INCLUDING when
  // `boosted` is 0.
  //
  // `entity_boost_degraded` only fires when the store THROWS. An empty graph, a
  // normalization drift, or a scope mismatch all yield an empty map with no exception —
  // byte-identical to the dead path this milestone exists to fix. Without a liveness
  // signal the defect could return silently and nobody would see it. `boosted = 0`
  // sustained across a busy scope is the alarm.
  // @see CLAUDE.md § Princípio 3
  'entity_boost_applied',
  // themory-scoped-forget-and-retrieval-counter T2.3 — the per-scope recall
  // counter increment failed (non-fatal; fail-soft per Princípio 3 — a recall()
  // MUST NEVER fail because `retrieval_api_usage` could not be bumped). Mirrors
  // history_persist_failed. @see CLAUDE.md § IMPORTANTE Princípio 3
  'retrieval_counted_failed',
  // ADR-0027 — reading or appending the raw message log failed. Non-fatal: the write already
  // committed (or extraction proceeds without context). Attribute `operation` is recent|append|embed
  // (embed: the messages were logged without embeddings, findable by their words only; ADR-0031).
  'message_log_failed',
  'memory_superseded',
  'supersession_rejected',
  'supersession_skipped',
  'supersession_failed',
  // #238 — importance scoring on write (opt-in). `importance_scored` carries `count`;
  // `importance_scoring_failed` carries `reason` and `count`. The fact stays stored either way.
  'importance_scored',
  'importance_scoring_failed',
  // agentic-skill-execution-sandbox T1.2 — a sandbox guard denied a skill
  // execution. Attribute `reason` carries the ToolInvocationDeniedReason literal.
  // Every denial is observable (Princípio 3 — no silent IGNORE on an RCE surface).
  // @see CLAUDE.md § IMPORTANTE Princípio 3
  'tool_invocation_denied',
  // agentic-skill-execution-sandbox T1.2 — a skill executed successfully inside the
  // sandbox. Attribute `skill_id`. Pairs with tool_invocation_denied for the
  // execute-path success/deny audit ratio.
  'skill_executed',
  // cross-encoder-reranker T2.2 / ADR D4 — the post-threshold cross-encoder
  // rerank failed (non-fatal; fail-soft per Princípio 3 — recall() degrades to
  // the original cosine order and NEVER throws on a reranker outage). Attribute
  // `error` carries the error name. Mirrors history_persist_failed.
  // @see CLAUDE.md § IMPORTANTE Princípio 3
  'recall_rerank_failed',
  // #132 — the recall-cache write (a write-behind optimization) failed; recall returned its
  // freshly-computed results anyway. A cache-write failure must NEVER break the read path.
  'recall_cache_write_failed',
  // domain-ontologies T2.2 / ADR D2 (Item 15) — an LLM-extracted entity type fell
  // outside the configured domain ontology vocabulary and was coerced to OTHER.
  // Attributes `{ontology, from, to, entity}`. Every coercion is observable so a
  // too-narrow ontology vocabulary surfaces (Princípio 3 — no silent typing loss).
  'ontology_type_coerced',
  // adaptive-retrieval T2.1 / ADR D4 (Item 13) — the pre-embed retrieval-decision gate
  // (`AdaptiveRetrievalPolicy.shouldRetrieve`) returned `{retrieve:false}`, so
  // recall() returned [] WITHOUT embedding the query. Attribute `{scope_tier,
  // reason}`. Princípio 3 — a skip is never silent.
  'retrieval_skipped',
  // adaptive-retrieval T2.1 / ADR D4 (Item 13) — the grade-and-correct hook
  // (`AdaptiveRetrievalPolicy.assess`) recommended a relax and the pipeline
  // re-filtered the already-fetched pool at a lower threshold. Attribute
  // `{from_threshold, to_threshold, surfaced}`. Princípio 3 — every corrective is observable.
  'retrieval_corrected',
  // adaptive-retrieval T2.1 / ADR D4 (Item 13) — `assess` judged the pool
  // unusable (reject) OR a relax surfaced nothing. recall() returns the original
  // (possibly empty) results; NEVER throws. Attribute `{scope_tier, reason}`.
  'retrieval_low_confidence',
  // adaptive-retrieval (Item 13, fail-soft ADR D4) — a wired AdaptiveRetrievalPolicy
  // hook (`shouldRetrieve` or `assess`) THREW; recall degraded to the normal
  // (non-adaptive) path and NEVER crashed. Attribute `{scope_tier, hook, error}`.
  // DISTINCT from `retrieval_low_confidence` so a policy CRASH is not conflated
  // with a genuine low-confidence outcome (Princípio 3, mirrors recall_rerank_failed).
  'retrieval_policy_failed',
  // graph-aware-recall (ADR D4) — the pipeline Step 8.7 graph-expansion stage
  // pool-expanded the results with memories connected by a shared entity / relation
  // edge over the existing entity-graph tables. Attribute `{seeds, expanded, hops}`.
  // NOT emitted when nothing was surfaced (no-op discipline). Princípio 3.
  'recall_graph_expanded',
  // graph-aware-recall (ADR D4, fail-soft) — the graph traversal/expansion threw;
  // recall degraded to the non-graph pool and NEVER crashed. Attribute
  // `{error}`. Mirrors recall_rerank_failed / retrieval_policy_failed.
  'recall_graph_failed',
  // M22 recency-collapse (#141) — the opt-in recall-time most-recent-wins collapse
  // pruned N older near-duplicate candidates. Attribute `{collapsed_count, pool_size}`.
  // Emitted whenever the stage runs (collapsed_count MAY be 0), so the IGNORE decision
  // is observable even without a recall-trace store wired. Princípio 3; mirrors
  // scope_reweight_applied.
  'recency_collapse_applied',
  // extraction-language-determinism-fixes-cycle-1 T3.1 / ADR D3 — the post-extraction
  // language guard detected (over the JOINED fact text) that the persisted facts are in
  // a different language than the deterministically-detected input language (EG-4
  // residual) and attempted a focused corrective rewrite. Attributes
  // `{input_language, facts_language, fact_count, corrected}` where `fact_count` = facts
  // in the batch and `corrected` = how many were rewritten into the input language
  // (corrected < fact_count means a residual leaked past correction — still observable).
  // The guard NEVER drops a fact nor fails remember() (fail-soft). NOT emitted when the
  // facts already match the input language (no-op discipline).
  // @see CLAUDE.md § IMPORTANTE Princípio 3
  'extraction_language_mismatch',
  // #254: the input language could not be named before extraction, so no language
  // directive was injected. Attributes `{reason, language?, error?}`: `reason` is
  // `unsupported_language` (with the ISO 639-1 code given), `malformed_answer`, or
  // `llm_error` (with the error class name). remember() continues.
  // @see CLAUDE.md § IMPORTANTE Princípio 3
  'extraction_language_identification_failed',
  // entity-label-language-determinism EG-5 — the post-extraction label guard rewrote N
  // entity/relation LABELS into the input language (the live-test showed `entities[]`
  // names + `relations[]` labels drift to a different language than the input even when
  // the fact text is correct). Attributes `{input_language, label_count, corrected}`
  // where `label_count` = distinct non-speaker labels considered and `corrected` = how
  // many were rewritten. The guard NEVER drops an entity/relation nor fails remember()
  // (fail-soft). NOT emitted when nothing was corrected (no-op discipline).
  // @see CLAUDE.md § IMPORTANTE Princípio 3
  'extraction_label_language_mismatch',

  // auto-categorization-write-pipeline T1.1: fires when the write pipeline assigns a
  // model-derived category to a fact (only when the caller supplied none and the value
  // passed the 1-64 trim/bound check). Attributes `{source, fact_count}` where `source`
  // = 'taxonomy' (a fixed-list label) or 'suggested' (a free-form fallback label). NOT
  // emitted on operator-supplied category nor on a dropped/oversized/empty value (fail-soft).
  // @see CLAUDE.md § IMPORTANTE Princípio 3
  'category_auto_assigned',

  // auto-categorization-write-pipeline F-M1: fires when the LLM PROPOSED a category
  // label but it failed the 1-64 trim/bound check (EC-1 oversized / EC-5 whitespace) and
  // was dropped fail-soft. Attribute `{reason}`. Makes a real drop observable (Princípio 3
  // — never a silent IGNORE); NOT emitted when the LLM proposed no category at all.
  // @see CLAUDE.md § IMPORTANTE Princípio 3
  'category_auto_dropped',
  // explainable-recall T3.1 — the recall-trace write (accountable forgetting) failed;
  // fail-soft (D3): recall STILL returns its results, the failure is observable, never
  // silently swallowed. Attribute `{error}`. @see CLAUDE.md § IMPORTANTE Princípio 3
  'recall_trace_write_failed',
  // explainable-recall T3.1 — the dropped-candidate set exceeded the store's
  // maxRowsPerRecall cap so the trace was truncated (EC-4: no silent truncation).
  // Attributes `{dropped_total, persisted}`. @see CLAUDE.md § IMPORTANTE Princípio 3
  'recall_trace_truncated',
  // M9 (session→global consolidation, T3.1) — the SessionToGlobalConsolidationPolicy
  // promoted N durable session clusters to the user's global scope at the reflect
  // boundary. Attributes `{scope_tier, promoted_count}`. Princípio 3 — every promotion
  // (a governed placement decision) is observable. @see CLAUDE.md § IMPORTANTE Princípio 3
  'consolidation_promoted',
  // M10 (scope-aware recall reweight, T3.1) — the opt-in scopeAwareReweight stage
  // re-ordered the threshold-survivor pool by scope-of-origin (session recency-boost,
  // global stability-boost) before top-K. Attributes `{scope_tier, reweighted_count}`.
  // Princípio 3 — the reweight (a governed ranking decision) is observable.
  'scope_reweight_applied',
  // M11 (routing governance, T2.1) — a best-effort placement-decision audit write to the
  // RoutingAuditStore FAILED; the routing/promotion decision itself still succeeded (fail-soft,
  // Rule 8). Attributes `{workspace_tier, error}`. Princípio 3 — even the audit's own failure is
  // observable, never a silent swallow.
  'routing_audit_write_failed',
  // M24 T3.2 (#145) — a reflect draft failed provenance validation or its
  // source set became unavailable before commit and was QUARANTINED rather than
  // aborting otherwise-good drafts. Attributes include scope_tier, draft_index
  // and reason. Princípio 3 — the IGNORE decision is observable.
  'reflection_draft_quarantined',
  'extraction_evidence_dropped',
  'extraction_evidence_downgraded',
  // A fact written about `user` got back the person its own relation names (#257).
  'extraction_subject_restored',
  // A write carried only reference material, so nothing was extracted (ADR-0039).
  'extraction_reference_only',
  // A physical delete took the summaries derived from the memory with it (migration 0039).
  'forget_reached_derived',
  // A fact written about `user` got the name of the author the caller gave for its message (#244).
  'extraction_author_named',
  // ADR-0035: a draft the extractor labeled temporary or tentative is stored, not dropped.
  'extraction_short_lived_kept',
  // ADR-0035: the date of a fact's event was counted in code from its quote.
  'event_time_resolved',
  // ADR-0035: the quote names two times, so no event date was set.
  'event_time_ambiguous',
  // ADR-0035: a passing state of the moment got an end, so recall stops showing it later.
  'short_lived_expiry_set',
  // #253: a new fact arrived after a newer value of the same thing and was stored as already ended.
  'memory_ended_on_arrival',
  // ADR-0036: how many pairs of one write went to the update judge, and how many it said replace.
  'update_judged',
  // ADR-0036: the update judge gave no verdict for a pair; the pair is left alone.
  'update_judge_failed',
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
