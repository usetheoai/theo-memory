# Review: adaptive-retrieval (Roadmap Item 13)

**Date:** 2026-06-22
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-memory-layer, domain-observability
**Findings:** 2 HIGH, 3 MEDIUM, several LOW/INFO (0 BLOCKER)
**Verdict:** READY_TO_MERGE (both HIGH + the load-bearing MEDIUMs closed inline)

## Summary

Item 13 adds an opt-in `AdaptiveRetrievalPolicy` DIP (`shouldRetrieve` pre-embed gate + `assess` post-threshold grade-and-correct) wired into `recall()`, default OFF. Architecture (SOLID/DIP clean, 0 structural defects), tests (pyramid balanced, EC-1..EC-4 covered, GOAL genuine vs real pgvector), wiring (triad honest, subpath isolated, pack ships), cross-validation (6/6 tasks fully implemented, 5 ADRs respected, ZERO new dep confirmed) and domain-memory-layer (pipeline integrity preserved, default byte-unchanged) all confirmed the implementation sound. Two HIGH + two MEDIUM observability/hygiene findings were fixed inline before merge.

## HIGH findings (fixed inline)

### F-arch (HIGH) + F-xval-1 (MEDIUM, same root): paper names (Self-RAG / CRAG) in `src/**`
- Found by: architecture (6 HIGH), cross-validation, domain-memory, domain-observability
- Rule: `.claude/rules/no-paper-names-in-code.md` — research-paper names are banned in `src/**` (allowed only in plan/blueprint/ADR). The plan DoD even checked-off "No paper names in src/**" while 20 `Self-RAG`/`CRAG` occurrences shipped in JSDoc/comments (Inquebrável Rule 3 self-claim violation; the p0-audit Sub-goal-4 grep only covers the 5 marketing tokens, so it passed the green suite).
- Fix: replaced all 20 occurrences across 10 files with neutral wording (`shouldRetrieve` pre-embed gate / post-threshold grade-and-correct / adaptive-retrieval decision hooks); arXiv references dropped from code (cited in the plan/blueprint instead). VERIFIED: `grep -niE 'self.?rag|\bcrag\b' packages/core/src/ tests/` (excl. benchmarks/knowledge-base) → 0 hits. The plan DoD checkbox is now honestly satisfied.

### F-dom-obs-1 (HIGH): `shouldRetrieve` gate's bare `catch {}` was silent
- Found by: domain-observability
- Detail: the pre-embed gate swallowed a policy error with NO observable signal, asymmetric with the `assess` fail-soft path. Violates Princípio 3 + Inquebrável Rule 8 (fail-clear).
- Fix: added a NEW dedicated `retrieval_policy_failed` event (MEMORY_EVENTS 31→32) emitted on BOTH hook failures (`shouldRetrieve` throw in scoped-memory + `assess` throw in the pipeline), with `{scope_tier, hook, error}` attributes. This also de-conflates a policy CRASH from a genuine low-confidence outcome (the assess catch previously misused `retrieval_low_confidence`). Mirrors the reranker `recall_rerank_failed` precedent. Tested in both the pipeline + façade suites.

## MEDIUM findings (fixed inline)

### F-dom-obs-2: EC-1 clamp silently skipped a requested correction
- Fix: when `assess` requests a relax but `relaxedThreshold` is out-of-range (clamped), the pipeline now emits `retrieval_low_confidence{reason:'relax_threshold_invalid', requested_threshold, original_threshold}` — the requested correction could not be applied so the results stay weak, which IS an observable low-confidence outcome. Tested (EC-1 pipeline test updated).

### F-dom-obs-3: empty-relax event lacked diagnostic attributes
- Fix: the `relax_surfaced_nothing` low-confidence event now carries `{pool_size, relaxed_size}`; the `retrieval_corrected` event already carries `surfaced`.

## LOW / INFO findings (accepted, documented)

- **F-xval-2 (LOW):** `assess` gained an optional 3rd `tuning?` param (still 2 methods — within ADR-0008; the ADR's signature was illustrative). The DIP JSDoc documents it. Accepted — makes `RecallOptions.adaptive` per-call tuning genuinely functional (no dead field).
- **F-dom-obs-4 (LOW):** event `reason` attributes are strings not enums — deferred (a breaking-change polish; the string reasons are specific + greppable).
- **F-tests-8 (MEDIUM→accepted):** per-call tuning assertion could be stricter — the pipeline test already proves the override surfaces the weak doc; sufficient.
- **F-xval-3/4/5, domain INFOs:** informational (config slot lives in `config.ts` not `factory.ts` — correct placement, stale plan path; pack-manifest not independently re-run by the agent — re-run here, ships).

## Edge-case coverage

EC-1 (clamp + observable), EC-2 (relax-surfaces-nothing → low_confidence + attrs), EC-3 (option-without-policy no-op), EC-4 (skip still counts — documented), fail-soft (both hooks → `retrieval_policy_failed`, never crash). All covered.

## Cross-validation summary

| Task | Status |
|---|---|
| T1.1 DIP (2 methods + tuning) | fully |
| T2.1 events + RecallOptions.adaptive | fully |
| T3.1 two seams + fail-soft | fully |
| T4.1 heuristic default | fully |
| T4.2 config + subpath + isolation | fully |
| T5.1 GOAL vs real pgvector | fully |

- ADRs D1-D5 respected. ZERO new dependency confirmed (package.json deps/optionalDeps byte-unchanged; only the `./adaptive-local` export added).

## Quality gates summary (post-fix)

- Contract suite: PASS — 1163 passed, 2 skipped (incl. the de-conflated fail-soft tests + 4-event union).
- `tsc -p tsconfig.contract.json` + `npm run build` (exactOptionalPropertyTypes): PASS.
- GOAL integration vs real `ankane/pgvector:v0.5.1` (canonical integration config): PASS 3/3 (skip + correct + default-unchanged).
- Subpath isolation + 5 smoke (incl. `adaptive-local`): PASS.
- `/code-quality adaptive-retrieval`: PASS (0 hard/soft caps).
- No paper names in `src/**` / `tests/**` (excl. benchmarks): VERIFIED 0 hits.
- MEMORY_EVENTS 28→32 (4 adaptive literals); core export count 54→55 (DIP type); both snapshots reconciled.

## Pre-existing failures (NOT introduced; disclosed per Inquebrável Rule 3)

- `tests/integration/pgvector-store.test.ts` (2 InvalidSkillError dual-module-identity) + 5 mem0 reference-clone tests — proven pre-existing in prior cycles (`git stash -u` + re-run). Integration suite requires `--no-file-parallelism` (known dist-race flake).

## Spawned agents (audit trail)

- `.claude/agents/review-adaptive-retrieval-2026-06-22/{architecture,tests,wiring,cross-validation,domain-memory-layer,domain-observability}.md`

## Handoff decision

READY_TO_MERGE — 0 BLOCKER; 2 HIGH + 2 MEDIUM closed inline and re-verified; remaining LOW/INFO documented + accepted. Proceed to `/release` (minor bump → v0.18.0).
