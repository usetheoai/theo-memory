# Review: graph-aware-recall (entity-graph-augmented retrieval)

**Date:** 2026-06-22
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-memory-layer, domain-security
**Findings:** 0 BLOCKER, 4 HIGH (all doc/idiom, closed inline), several MEDIUM/LOW/INFO
**Verdict:** READY_TO_MERGE

## Summary

Adds an opt-in `GraphExpansionStore` DIP + a recall pipeline Step 8.7 that pool-expands results with memories connected by shared entities/relations via JOINs over the EXISTING `entities`/`memory_entities`/`entity_edges` tables. All 6 agents returned READY_TO_MERGE: architecture (SOLID/ISP clean — `MemoryGraphStore` NOT widened; 0 structural defects), tests (pyramid balanced, EC-1/EC-2/EC-3/fail-soft covered, GOAL exercises the REAL entity-link + JOIN path), wiring (triad honest, factory auto-default flows, no orphans, pack ships, count 55→56 reconciled), cross-validation (7/7 tasks fully implemented, 5 ADRs respected, ZERO new dep + NO migration byte-confirmed), domain-memory-layer (JOIN correct + injection-safe + scope-partitioned), domain-security (parametrized SQL, EC-2 isolation, fail-soft, LIMIT-bounded). The 4 HIGH findings were all documentation/idiom (NOT correctness defects) and closed inline.

## HIGH findings (all doc/idiom — closed inline)

### F-arch-4: spread-assignment `scored = [...await applyGraphExpansionStage()]` non-idiomatic
- Found by: architecture. **Reality:** the spread is REQUIRED — the helper returns `readonly ScoredRow[]` and `scored` is a mutable `let ScoredRow[]` that downstream stages sort in place; `scored = await helper()` would fail tsc. **Fix:** added a comment explaining the readonly→mutable copy. (Not a defect; clarity.)

### F-mem-4: `GROUP BY m.id` PK functional-dependency undocumented
- Found by: domain-memory-layer. **Fix:** added a SQL comment documenting that `m.id` (memories PK) makes all selected `m.*` columns functionally dependent (Postgres-legal); a future non-`m.*` non-aggregated column would error loud (not silent). (Valid as-is; documentation.)

### F-sec-1: `hops` CTE branch is a type-constrained injection control, undocumented
- Found by: domain-security. **Reality:** the SQL is fully parametrized ($1..$6); the ONLY branch selector is `hops` (typed `1|2` at the DIP + RecallOptions). NO user string is interpolated. **Fix:** added a JSDoc INJECTION SAFETY note that `hops` is the control + widening it requires re-audit. (Already safe; documentation.)

### F-sec-4: `recall_graph_failed` error attribute hardening
- Found by: domain-security. **Reality:** the event already emits `err.name` ONLY (not the message) — no PII/secret leak. Confirmed safe as-is; no change needed beyond noting it.

## MEDIUM / LOW (addressed or accepted)

- **F-arch-5 (MEDIUM):** magic `0.999` → extracted to a named `GRAPH_SCORE_BAND_FACTOR` constant with JSDoc. Fixed.
- **F-arch-15 (LOW):** banded floor uses `min` over the WHOLE pool (not `slice(0,topK)`) → documented as intentional (band against the full pool so graph hits stay below every genuine hit). Fixed (comment).
- **F-xval-2 (LOW):** banded-score formula refinement vs ADR D3 → documented in plan ADR D3 (contract-equivalent: post-threshold `lowestSeedScore >= threshold`). Fixed.
- **F-sec-3/5/6/7 (MEDIUM/LOW):** maintainability JSDoc/comments — the load-bearing ones (injection guard, GROUP BY, band factor) are now documented; the rest are minor and accepted.
- **F-xval-3 (INFO):** validate-report said "6 pipeline tests"; the new describe block has 5 (cache-bypass asserted via the scoped-memory change). Cosmetic; all T3.1 ACs covered.

## Edge-case coverage

EC-1 (dedup connected-in-pool — pipeline test), EC-2 (scope isolation — in-memory unit + GOAL scenario + entities scope-partitioned by `entities_scope_type_key_uq`, defense-in-depth), EC-3 (no-store no-op — pipeline test), EC-4 (hub fan-out — LIMIT-bounded, documented), fail-soft (store throws → `recall_graph_failed`). All covered.

## Cross-validation summary

| Task | Status |
|---|---|
| T1.1 GraphExpansionStore DIP | fully |
| T2.1 events + RecallOptions.graphExpand | fully |
| T3.1 Step 8.7 + thread + cache bypass | fully |
| T4.1 PgGraphExpansionStore (JOIN) | fully |
| T4.2 in-memory impl + tests | fully |
| T4.3 config + factory auto-default + type export + count | fully |
| T5.1 GOAL vs real pgvector | fully |

- ADRs D1-D5 respected. ZERO new dependency + NO new migration byte-confirmed. No paper names in `src/**`.

## Quality gates summary (post-fix)

- Contract suite: PASS — 1173 passed, 2 skipped (pipeline 28/28).
- `tsc -p tsconfig.contract.json` + `npm run build:core`: PASS.
- GOAL integration vs real `ankane/pgvector:v0.5.1`: PASS 2/2 (shared-entity surfaces + default-unchanged + scope isolation).
- `/code-quality graph-aware-recall`: PASS (0 hard/soft caps).
- SQL injection-safe (fully parametrized); EC-2 scope isolation enforced; fail-soft; LIMIT-bounded.
- core export count 55→56 reconciled (both p0-audit snapshots).

## Pre-existing failures (NOT introduced; disclosed per Inquebrável Rule 3)

`tests/integration/pgvector-store.test.ts` (2 InvalidSkillError dual-module-identity) + 5 mem0 reference-clone tests — proven pre-existing in prior cycles. Integration suite requires `--no-file-parallelism` (known dist-race flake).

## Spawned agents (audit trail)

- `.claude/agents/review-graph-aware-recall-2026-06-22/{architecture,tests,wiring,cross-validation,domain-memory-layer,domain-security}.md`

## Handoff decision

READY_TO_MERGE — 0 BLOCKER; the 4 HIGH findings were documentation/idiom (not correctness) and closed inline; MEDIUM/LOW addressed or accepted. Proceed to `/release` (minor bump → v0.19.0).
