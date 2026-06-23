# Review: rest-graph-aware-recall (expose graphExpand on POST /v1/recall)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 6 — architecture+api, tests, wiring, cross-validation, domain-security (re-run after a socket-error retry)
**Findings:** 0 BLOCKER, 0 HIGH, 1 MEDIUM + 2 LOW (all closed inline), remainder INFO
**Verdict:** READY_TO_MERGE

## Summary

Exposes `RecallOptions.graphExpand` (v0.19.0 SDK capability) over `POST /v1/recall` — a bounded zod field on the strict `RecallBody` + a one-line `recallHandler` mapping + auto-derived OpenAPI. All 6 agents returned READY_TO_MERGE / CLEAN: architecture (13 INFO, textbook additive API extension), tests (sound pyramid; 1 MEDIUM + 2 LOW non-blocking), wiring (all 3 triad pillars pass; OpenAPI auto-derive confirmed; MCP deferral honest), cross-validation (3/3 tasks fully implemented, all ADRs respected, ZERO new dep / NO core change / NO migration / NO new export empirically confirmed), domain-security (10 INFO, 0 defects — input bounded, no injection, DoS-capped, scope-isolated, 422-not-500). The domain-security agent first died on a socket error and was re-run cleanly (per cycle-review stop-condition: a failed agent is retried once).

## MEDIUM / LOW findings (closed inline)

### F-tests-7 (MEDIUM): GOAL lacked an EXPLICIT hops scenario (only the `{}` default)
- Found by: tests. **Fix:** added a GOAL scenario `POST /v1/recall` with `graphExpand: { hops: 1, limit: 10 }` asserting the connected memory surfaces — proving an explicit hops value flows over HTTP (not just the default-`{}` path). GOAL now 4/4. (Full 2-hop e2e needs entity_edges fixtures + is the core's concern; the core 2-hop SQL shipped v0.19.0; an end-to-end 2-hop HTTP scenario is an honest follow-up, not a blocker for the REST-surface cycle.)

### F-xval-2 (LOW): OpenAPI auto-derive AC had no committed regression test
- Found by: cross-validation. **Fix:** added `openapi.test.ts` assertion that the served `/v1/openapi.json` contains `graphExpand` — hardens the auto-derive AC against future drift. api suite now 217 passed.

### F-tests-9 / F-tests-1 (LOW): handler-test JSDoc header + per-describe DB lifecycle
- Accepted: the file-header note + the isolated-DB-per-describe pattern are minor/intentional; no change required.

### F-xval-1 (INFO): REST `limit` narrowed to int 1..100 vs the core's open `number`
- Confirmed intentional (ADR D1 DoS-guard, documented in code + CHANGELOG); not a divergence.

## Edge-case coverage

EC-1 (invalid graphExpand → 422 not 500 — handler test ×2 + GOAL), EC-2 (`graphExpand: {}` activates expansion — GOAL), EC-3 (scope isolation inherited via `workspaceBoundMemory` + core candidate-side filter — security review confirmed), EC-4 (rerank/adaptive REST exposure deferred — ADR D3). Plus the new explicit-hops scenario (F-tests-7).

## Cross-validation summary

| Task | Status |
|---|---|
| T1.1 graphExpand bounded zod field | fully |
| T1.2 handler mapping + OpenAPI auto-derive | fully |
| T2.1 GOAL vs real pgvector over HTTP | fully |

- ADRs D1-D3 respected. ZERO new dependency, NO core change, NO migration, NO new public export (p0-audit counts unchanged) — empirically confirmed via `git diff --name-only` (diff touches only `packages/api` + tests + docs).

## Quality gates summary (post-fix)

- Contract suite: PASS (0 type errors).
- API package tests: PASS — 217 passed (4 graphExpand handler tests + 1 OpenAPI regression).
- GOAL integration vs real `ankane/pgvector:v0.5.1` over HTTP: PASS 4/4 (graphExpand surfaces shared-entity below-threshold memory; explicit hops=1; default byte-unchanged; invalid hops → 422).
- `/code-quality rest-graph-aware-recall`: PASS (0 hard/soft caps).
- Security: input fully bounded (hops 1|2 literal, limit ≤ 100, strict inner); no SQL injection (parametrized + typed branch); DoS-capped; multi-tenant scope-isolated; 422-not-500; no info leak.

## Pre-existing failures (NOT introduced; disclosed per Inquebrável Rule 3)

`tests/integration/pgvector-store.test.ts` (2 InvalidSkillError dual-module-identity) + 5 mem0 reference-clone tests — proven pre-existing. Integration suite requires `--no-file-parallelism` (known dist-race flake).

## Spawned agents (audit trail)

- `.claude/agents/review-rest-graph-aware-recall-2026-06-23/{architecture,tests,wiring,cross-validation,domain-security}.md`

## Handoff decision

READY_TO_MERGE — 0 BLOCKER, 0 HIGH; the MEDIUM (explicit-hops GOAL scenario) + the LOW (OpenAPI regression assertion) closed inline; remaining LOW/INFO accepted. Proceed to `/release` (minor bump → v0.20.0).
