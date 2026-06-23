# Review: recall-scoped-exact-search (EG-6)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 (architecture, tests, wiring+cross-validation, domain-memory-layer)
**Findings:** 8 total (BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 6, INFO: many)
**Verdict:** READY_TO_MERGE

## Scope reviewed

Two commits on `develop`:
- EG-6 `fix(recall): EG-6 — scoped recall exact-search over scope-filtered subset (no HNSW starvation)`
- `fix(lint): close pre-existing lint debt + honor _-prefix unused-args`
- Plus the post-review hardening commit closing ARCH-3 (below).

## BLOCKER findings
_None._

## HIGH findings
_None._

## LOW findings (advisory)

### ARCH-3 — param-less selective clause silently dropped into unscoped path — FIXED
- Found by: architecture.
- The exact-vs-HNSW branch originally keyed on `filter.params.length > 0`. `excludeSuperseded` emits `superseded_by IS NULL` with NO param, so a `{ excludeSuperseded: true }`-only filter (not reachable via `recall()` today, but reachable via a direct `VectorStore.search` SDK call) would take the unscoped HNSW branch that omits `${filter.sql}` → the clause is silently dropped.
- **Resolution: FIXED inline.** Branch now keys on `filter.sql !== ''` (presence of any selective clause). New unit test `a param-less selective clause (excludeSuperseded) still takes the exact CTE path` locks it (asserts MATERIALIZED + `superseded_by IS NULL` present). 27/27 unit GREEN.

### ARCH-5a — stray whitespace-only lines from eslint --fix — FIXED
- Found by: architecture. `--fix` left whitespace-only lines in `bleu.ts` + `history-manager.ts` where `eslint-disable` comments were removed. Stripped trailing whitespace (behavior-neutral).

### F1 (tests) — EXPLAIN test EXPLAINs a hand-written SQL copy, not the production statement
- Found by: tests. Advisory — backstopped by the unit test (asserts production SQL contains `MATERIALIZED`) and the GOAL (returns 0 on a revert). Accepted; optional post-merge follow-up to capture the real SQL.

### F2 / W-2 (tests/wiring) — only user_id scope exercised end-to-end
- Found by: tests + wiring. `composeFilters` handles user/session/agent in one identical loop and the branch is scope-tier-agnostic, so user_id is a sound representative. Optional follow-up: add a session/agent + `asOf`+scope GOAL assertion.

### W-1 (wiring) — no dedicated OTel signal for exact-vs-HNSW path
- Found by: wiring. The fix is a silent-0 correctness fix; existing event/result-count surface makes 0-vs-N observable. Advisory — consider a low-cardinality `recall.path` span attribute post-merge.

## Cross-validation summary

- Plan Coverage Matrix rows 1–7: DELIVERED (row 8 live re-verify validated separately).
- Plan claims "NO schema/migration/DIP/public-export change, NO new dependency": VERIFIED against `git diff` (barrels + package.json empty; no `*.sql`).
- ADR D1 (MATERIALIZED CTE, btree-first, exact order) + D2 (unscoped keeps HNSW; ef_search deferred YAGNI): code matches both.

## Quality gates summary

- Unit (pgvector-store): 27/27 PASS.
- Core unit suite: 932 PASS.
- EG-6 integration GOAL vs real `ankane/pgvector:v0.5.1`: 4/4 PASS (non-vacuous + EXPLAIN btree + empty-scope).
- Recall integration (round-trip + graph-aware): 7/7 PASS (no regression).
- `npm run lint`: GREEN. `npm run typecheck`: GREEN.
- `/code-quality` verdict: PASS (cap 100; 0 hard/soft caps; 0 dead code; 0 symbol fabrication).

## Domain (memory-layer) summary

- MATERIALIZED CTE genuinely prevents HNSW fold (EXPLAIN: btree index scan → exact sort); embedding carried into CTE; recall@k guaranteed.
- P2 strengthened (true in-scope nearest reaches threshold/MMR/top-K); P3 preserved (no MEMORY_EVENTS change); `<=>` matches `vector_cosine_ops`; BM25 `keywordSearch` untouched.
- Perf trade-off (O(scope) exact sort) honestly documented (EC-3 / Drawbacks); only bites huge single scopes that do not starve under HNSW anyway.

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER, 0 HIGH. The two substantive LOW findings (ARCH-3, ARCH-5a) were fixed inline; the remaining LOWs are advisory post-merge follow-ups.
