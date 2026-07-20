---
slug: explainable-recall
date: 2026-07-20
questions_asked: 6
decisions_resolved: 6
verdict: READY_FOR_PLAN
---

# Grill: explainable-recall (accountable forgetting — Slice 1)

Scopes the FIRST slice of the "accountable forgetting" differentiator (blueprint `accountable-forgetting-blueprint.md`, ADR D2) into a single implementable plan.

## Decision tree resolved

1. **Slice #1 = S1: persist-the-reason + recall trace, core-only.** The foundation every other slice depends on (S2 `explain(recallId)` is a *read* of this trace). Smallest shippable; proves the core thesis (we persist the WHY) with least API surface.
2. **Persistence = a dedicated, queryable Postgres table (`recall_traces`) behind a new DIP (`RecallTraceStore`).** NOT the OTel event sink (fire-and-forget, not queryable per-recall; `architecture.md §2` keeps domain event separate from infra sink). Mirrors existing audit tables (`history`, `consolidation_history`); DIP keeps persistence swappable (default pg, like other stores).
3. **Trigger = opt-in at deployment level via factory config** (`createLocalMemory({ recallTrace: {...} })`), default OFF; when ON, EVERY recall is traced (not a per-call flag). Mirrors the `recallCache`/`eviction` opt-in precedent (no-op + zero overhead when off). Deployment-level (not per-call) keeps `explain()` deterministic — any `recall_id` is explainable.
4. **Scope = recall-time only.** Only `recall_threshold_filtered` is recall-time; `dedup_collision_confirmed` + `extraction_zero_facts` are WRITE-time (in `remember`) and belong to a separate "remember trace" slice (S1b). S1 touches the retrieval pipeline + the new store, NOT the write pipeline.
5. **Payload = rich, per dropped candidate:** `memory_id`, composite `score` + component breakdown (`semantic` / `bm25` / `entity_boost`), the `threshold` applied, and a drop-reason enum (`below_threshold` / `mmr_redundant`). The differentiator's value is the *why* — a bare composite score explains nothing; the breakdown shows which signal was missing. Pipeline already computes the components (additive scoring) — surfacing them out of the 520-LoC pipeline is the invasive part. `recall_id` = server-generated UUID at recall start (convention, not a preference).
6. **Goal (SMART) + metric:** Add an opt-in `RecallTraceStore` DIP that persists, per recall, one queryable trace row per dropped candidate (sub-threshold / MMR) with the component-score breakdown — proven by an integration test vs real `ankane/pgvector:v0.5.1` where a recall dropping ≥1 candidate writes the matching rows retrievable by `recall_id`; mirror case: recall with 0 drops → 0 rows (mirrors the `filtered_count=0` no-emit convention). Single metric = that integration test passes (THE GOAL TEST).

## Q&A log

### Q1: Which slice is #1?
**Recommended**: S1 — persist-the-reason + recall trace, core-only (the foundation; S2 explain reads it).
**User decision**: Accepted.

### Q2: Where is the trace persisted?
**Recommended**: Dedicated queryable Postgres table (`recall_traces`) behind a new `RecallTraceStore` DIP — not the OTel event sink.
**User decision**: Accepted.

### Q3: Always-on or opt-in?
**Recommended**: Opt-in at deployment level via factory config, default OFF; when on, all recalls traced (mirrors recallCache/eviction).
**User decision**: Accepted.

### Q4: Recall-time only, deferring write-time?
**Recommended**: Yes — S1 = recall-time only (threshold-filtered + MMR drops); write-time IGNOREs (dedup, zero-facts) are a later slice.
**User decision**: Accepted.

### Q5: Minimal or rich payload?
**Recommended**: Rich — memory_id + composite score + component breakdown (semantic/bm25/entity) + threshold + drop-reason enum. recall_id = server UUID.
**User decision**: Accepted.

### Q6: The SMART Goal + metric?
**Recommended**: Opt-in `RecallTraceStore` persists a trace row per dropped candidate with component breakdown; THE GOAL TEST = integration vs real pgvector, recall dropping ≥1 candidate writes rows retrievable by recall_id; 0 drops → 0 rows.
**User decision**: Accepted.

## Unresolved questions (carry into the plan)

- **Retention / rotation of `recall_traces` rows.** Unbounded growth when tracing is on (one+ rows per recall). Deferred from S1 (YAGNI) — surface as a Drawback/Unresolved in the plan; a TTL/rotation policy is a follow-up (cf. `audit-trail-rotation.md` philosophy). S1 ships the capture; retention is not gated on S1.
- **Whether to also stamp `recall_id` onto the existing `recall_threshold_filtered` OTel event** (correlation between the span and the table). Low-risk enrichment; decide at plan time.

## Next step

`/to-plan explainable-recall` — the plan reads this grill as primary `## Context`, and each decision above maps to a plan ADR or task.
