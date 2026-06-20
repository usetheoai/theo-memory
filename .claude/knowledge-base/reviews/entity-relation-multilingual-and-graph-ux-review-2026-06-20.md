# Review: entity-relation multilingual extraction + graph UX (cross-repo)

**Date:** 2026-06-20
**Reviewers (spawned agents):** 5 parallel — architecture · tests · cross-validation · domain(memory-layer/LLM) · domain(frontend/graph-viz)
**Scope (this session's changes, two repos):**
- **theo-memory** `628b643..HEAD` — EC-5 endpoint auto-create (`51911db`), LLM-as-primary multilingual node source + diacritic-safe compromise fallback + noise filter (`ccbafbf`), prompt refinements: consistent `user` speaker + relation labels in input language (`cad27dc`).
- **theo-cloud** `629aae3..HEAD` — graph UX: force-directed view + synthetic hub root + alias merge + hide-unconnected toggle (`1465666`), react-force-graph-2d dep + vite/workbox + ADR (`5115af3`).

**Findings:** 0 BLOCKER · 0 HIGH · 1 MEDIUM (fixed→deferred) · 6 LOW · 13 INFO
**Verdict:** READY_TO_MERGE

## Summary

All 5 specialist reviewers returned independently: architecture APPROVE, tests PASS_WITH_CAVEATS (30/30 + 15/15 GREEN), cross-validation PASS (all claims verified, zero `Co-Authored-By`, both on `develop`, no scope creep), domain-memory APPROVE_WITH_NITS, domain-frontend READY_TO_MERGE. The multilingual entity pipeline preserves every invariant (fail-soft ADR D3, schema back-compat `entities`/`relations` optional, EC-2/3/4/5, homograph safety, `entityBoost` gating, DIP). The graph UX is honest (synthetic hub excluded from user-facing counts; conservative single-token prefix alias merge that does NOT false-merge "São Paulo" into "Universidade de São Paulo"; dangling-edge safe).

## Fixes applied in-cycle

| Finding | Sev | Fix | Commit |
|---|---|---|---|
| F-dom-1 — Graphiti/GraphRAG/LightRAG/Cognee in `src/**` JSDoc (no-paper-names rule) | LOW (rule) | Reworded to neutral + `@see` the plan | theo-memory `7d10204` |
| F-test-1 — `entities` schema field lacked a direct parse test | LOW | Added parse + back-compat + diacritic tests | `7d10204` |
| F-dom-3 — "s skip" comment said dropped (actually trimmed→"skip") | INFO | Comment example corrected | `7d10204` |
| F-xval-9 — ADR validation count stale (10/10) | LOW | Bumped to 15/15 | theo-cloud `a9c72cc` |
| F-fe-1 — d3/force in app-wide `vendor` chunk | MEDIUM | Naive manualChunks split produced a circular vendor↔force-graph chunk STILL preloaded app-wide → reverted to a documented deferred follow-up | `a9c72cc` |

## Accepted (non-blocking, documented)

- **F-fe-1 (MEDIUM → deferred):** route-isolating the force-graph/d3 family needs dedicated work (shared d3 deps create a circular chunk Rollup hoists to app-wide preload); pre-change it was already in the app-wide `vendor` chunk, so no regression. Tracked as a perf-hygiene follow-up.
- **F-dom-2 (LOW):** LLM-primary nodes anchor to `items[0].id` (per-call), mirroring EC-1 edge anchoring; cross-call `memory_count` aggregation preserved. Deliberate trade-off.
- **F-test-2 (INFO):** the `user` single-speaker-node convention is prompt-driven (LLM behavior), validated EMPIRICALLY against real `gpt-4o-mini` (not unit-testable without misrepresenting — our code does not dedup `user`/`eu`; the LLM does per the prompt).
- **F-arch-4/5, F-fe-2/3 (LOW):** factory eagerly wires the now-fallback extractor; `entity_linked` fires on zero-upsert; alias-merge self-loop dropped (safe); canvas lacks aria-label. All cosmetic/hygiene.

## Quality gates (verified post-fix)

- theo-memory: `build:core` clean · `vitest` extraction suites **56/56** GREEN · `eslint` 0 · no NEW paper-names in `src/**`.
- theo-cloud: `tsc -b` clean · `eslint` 0 · `vitest src/pages/memory/graph.test.tsx` **15/15** · `npm run build` GREEN (no force-graph circular warning after revert).
- Commit hygiene: zero `Co-Authored-By` trailers; all commits on `develop`.

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER, 0 HIGH. The single MEDIUM (F-fe-1) is a documented, deferred, non-regressing perf follow-up; the load-bearing rule violation (F-dom-1 no-paper-names) is fixed. Both repos are ready for a `develop → main` release PR.

## Spawned agents (audit trail)

architecture · tests · cross-validation · domain-memory-layer-llm · domain-frontend-graph-viz — 5 parallel general-purpose reviewers, 2026-06-20. Verdicts: APPROVE / PASS_WITH_CAVEATS / PASS / APPROVE_WITH_NITS / READY_TO_MERGE.
