# Discover Edge Case Review — entity-relation-extraction-no-graphdb

Date: 2026-06-19
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/entity-relation-extraction-no-graphdb-plan.md
Research questions analyzed: 6 (Q1–Q6)
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Q2 expects to find relation-EXTRACTION in the clone, but only NORMALIZATION is present
- **Affected question:** Q2 (techniques — relation triples)
- **Family:** Citation / Interpretation
- **Scenario:** `mem0/memory/utils.py` contains the triple SHAPE `{source, relationship, destination}` and the LLM-output **normalization** (`utils.py:271-291`) + `sanitize_relationship_for_cypher` — but the code that actually **prompts the LLM to extract triples** lives in Mem0's `mem0[graph]` module, which is **NOT in the clone** (`mem0/graphs` confirmed absent). During `/discover-execute`, the agent may try to locate "where triples are extracted", fail, and either fabricate a path (triggering the `discover-confidence` fabricated-citation hard cap → INVALID) or invent the prompt.
- **Impact:** Fabricated citation → blueprint INVALID; or an over-claimed answer about an extraction step we cannot actually observe.
- **Suggested fix:** Reword Q2's Fase B to: "Document the triple SHAPE + normalization that ARE present in `utils.py`; explicitly mark the relation-EXTRACTION prompt as `blocked — lives in the absent mem0[graph] module`. Do NOT cite a prompt path. The takeaway is the data shape, which is graph-DB-agnostic."

### EC-2: Q6 assumes Mem0 exposes a graph/edges endpoint to mirror — it only exposes an entity (node) LISTING
- **Affected question:** Q6 (tools — API shape)
- **Family:** Citation / Scope
- **Scenario:** `server/routers/entities.py` returns a flat `Entity` LIST (nodes only, with `total_memories`), NOT a `{nodes, edges}` graph. The Mem0 graph VIEW is a closed Pro/Enterprise frontend, absent from OSS. The agent may hunt for a non-existent "graph endpoint" and fabricate one.
- **Impact:** Fabricated endpoint citation → INVALID; or a false claim that Mem0 OSS ships a graph API.
- **Suggested fix:** Reword Q6's Fase B to: "Mirror the entity (node) LISTING shape from `entities.py`; state explicitly that the `{nodes, edges}` graph response is OUR synthesis (edges have no OSS precedent in the clone) — not a mirror."

## SHOULD TEST

### EC-3: Q3 risks over-claiming Letta "identities" as entity EXTRACTION
- **Affected question:** Q3 (techniques — relational modeling + resolution)
- **Suggested halt-loop checkpoint:** Before marking Q3 DONE, assert the answer states "Letta identities are DECLARED first-class records, NOT entities extracted from text — Letta is evidence for relational PERSISTENCE + resolution (`identifier_key` + unique constraint upsert), not for extraction." Prevents conflating the two halves.

### EC-4: Scope creep on Q6 (endpoint shape → full endpoint design)
- **Affected question:** Q6 (tools)
- **Suggested halt-loop checkpoint:** Stop criterion — Q6 yields the RESPONSE SHAPE only (fields + aggregation). Pagination, auth, RBAC, and route wiring are implementation-plan concerns, out of discovery scope (D1 budget). Mark DONE once the shape table is written; do not design the handler.

## DOCUMENT

### EC-5: Q1 entity extraction is spaCy-DEPENDENT, not regex-only (expected finding, not a surprise)
- **Accepted risk:** `entity_extraction.py:20` imports `re` but `extract_entities` (`:137`) does `from mem0.utils.spacy_models import get_nlp_full` — the real path needs spaCy + an `en_core_web_sm` download. This is exactly what Q5 must surface as the dependency cost. Recording here so the executor treats "needs spaCy" as the EXPECTED answer to Q1/Q5 (and the LLM-reuse alternative as the recommended no-new-dep path), not as a contradiction of the plan's framing.

### EC-6: Mem0 batch dedup (`main.py:868`) is the entity-resolution prior art, not a separate question
- **Accepted risk:** The plan cites `main.py` under Q1's project scope but the `global_entities: normalized_key -> (...)` dedup at `main.py:868-877` is the concrete entity-resolution technique. It is legitimately covered by Q3 (resolution) cross-read; no new question needed (would violate the ≤3-per-corner budget). The executor should cross-cite `main.py:868` when answering Q3's resolution half.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 0 | 0 | 1 (EC-5) |
| Q2 | 1 | 1 (EC-1) | 0 | 0 |
| Q3 | 2 | 0 | 1 (EC-3) | 1 (EC-6) |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 2 | 1 (EC-2) | 1 (EC-4) | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT — 2 light MUST FIX (EC-1, EC-2), both anti-fabrication guards reframing Q2 + Q6 so the executor records honest "blocked/synthesis" answers instead of inventing paths for surfaces absent from the OSS clone. No scope change, no new questions.
