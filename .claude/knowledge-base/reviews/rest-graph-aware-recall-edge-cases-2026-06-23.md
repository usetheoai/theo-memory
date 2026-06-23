# Edge Case Review — rest-graph-aware-recall

Date: 2026-06-23
Tasks analyzed: 3 (T1.1, T1.2, T2.1)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

## SHOULD TEST

### EC-1: invalid `graphExpand` (out-of-range hops / unknown inner key) must 422, never 500
- **Affected task:** T1.1 / T2.1
- **Suggested test:** `graphExpand: { hops: 3 }` → 422; `graphExpand: { bogus: 1 }` → 422 (strict inner). Already in the plan's acceptance + GOAL. The bounded zod (`hops` literal `1|2`, `.strict()` inner) guarantees it.

### EC-2: `graphExpand: {}` (empty object) must trigger expansion with defaults (hops=1, limit=topK)
- **Affected task:** T2.1
- **Suggested test:** the GOAL's main scenario uses `graphExpand: {}` — confirms the empty-object opt-in path (the field's PRESENCE, not its contents, activates Step 8.7). Already the GOAL shape.

## DOCUMENT

### EC-3: REST recall scope isolation is inherited (no new concern)
- **Affected task:** T1.2
- **Accepted/confirmed:** `recallHandler` already scopes via `workspaceBoundMemory(c, memory)` + `resolveScope` (the Principal's workspace), and the core graph traversal is scope-confined (EC-2 of graph-aware-recall). Exposing `graphExpand` adds NO new isolation surface — the candidate-side scope filter still applies. Documented; no extra guard needed.

### EC-4: asymmetry — graphExpand exposed but rerank/adaptive not
- **Affected task:** —
- **Accepted risk (ADR D3):** deliberate scope boundary; the /goal is the entity-graph. A followup tracks rerank/adaptive REST exposure. Documented in the plan.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 | 0 |
| T1.2 | 1 | 0 | 0 | 1 |
| T2.1 | 2 | 0 | 1 | 1 |

**Verdict:** PLAN OK — no MUST-FIX (the surface is additive + bounded; EC-1/EC-2 already in the plan's acceptance/GOAL; EC-3/EC-4 documented). The bounded strict zod + the inherited scope confinement cover the risk surface.
