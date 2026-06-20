# Implementation summary — entity-extraction-nodes-slice1

**Date:** 2026-06-20 | **Branch:** develop | **Plan:** v1.2 (SHIPPABLE 94.8)
**Verdict:** IMPLEMENTATION_COMPLETE (7/7 tasks committed; 5/5 phase mini-reviews PASS; validation gate PASS/PARTIAL, 0 FAIL)

## Tasks (wiring triad per task)
| Task | What | Caller (a) | Integration (b) | Notes |
|---|---|---|---|---|
| T1.1 | EntityExtractor DIP | factory (T3.1) | type-test | sync contract, closed enum |
| T1.2 | CompromiseEntityExtractor | factory | T5.1 | compromise lazy+regex fallback (Mem0-TS way, NOT spaCy); EC-2 drop guard; 9 unit |
| T2.1 | entities cols + memory_entities + migration 0018 | pipeline/handler | schema-cascade (real pg) | EC-1 COALESCE+type UNIQUE; CASCADE; EC-5 dim |
| T3.1 | wire Phase 7 (extract→embed→persist) | scoped-memory | T5.1 | entityBoost-gated + fail-soft (entity_linking_failed); MemoryEntityStore DIP + PgMemoryEntityStore; 5 unit |
| T4.1 | MemoryEntityStore.list read method | handler (T4.2) | list (real pg) | 3-table join, COUNT DISTINCT, MAX(m.created_at), COALESCE scope; 3 integ |
| T4.2 | wire read port into entitiesHandler | createServer | entities-readport | shape unchanged; attributed_to fallback preserved; 500 on reject; 4 unit |
| T5.1 | GOAL test | — | extract (real pg) | EC-4 default-ON + entityBoost:false negative; 2 integ |

## Quality gates
- Contract suite 1002 pass / 2 skip; api 190 pass; integration entities 8/8 vs ankane/pgvector:v0.5.1.
- typecheck 0; lint 0; no-paper-names clean in src/**; compromise OPTIONAL (bundle isolation, no static import).
- Migration 0018 additive (no DROP); journal idx 18 synced.
- CHANGELOG [Unreleased] Added entry.

## Notable
- T4.1 HALT (iter 4): plan defect caught by SEPA (entities-read seam missing) → loop-back to cycle-plan (ADR D4 + T4.1/T4.2 split, plan v1.2) → resumed. Honest BLOCKED > false GREEN.
- Co-shipped fix: pre-existing index-signature typecheck errors in skills.test.ts (post-v0.9.0).
- DIP count grew (EntityExtractor + MemoryEntityStore); ADR-0008 "5 DIP" prose already stale from prior cycles (recorded, Rule 3).

## Follow-ups (documented, out of slice-1 scope)
1. infer:false fast-path does not run Phase 7 (verbatim writes don't extract entities) — CHANGELOG caveat.
2. Strangler-Fig: remove attributed_to fallback in entitiesHandler once the read port is the only path.
3. extractProper sentence-initial recall edge ("New York City"→"York City").
4. Slice 2: relations (edges) + {nodes,edges} graph view + dashboard graph.

## Next
/review entity-extraction-nodes-slice1 (gateway/dashboard untouched — no theo-cloud change needed for slice 1).
