# Review: memory-write-quality-mem0-parity (M27)

**Date:** 2026-07-27
**Reviewers (spawned agents):** 3 adversarial (correctness/architecture · test-quality · skeptic).
**Scope:** M27 code diff `4c13a63..HEAD` (18 files, +710/-22) + review-hardening commits.
**Verdict:** READY_TO_MERGE

## Consolidated findings + resolution

| # | Sev | Finding (agent) | Resolution |
|---|---|---|---|
| F1 | HIGH | 400-word DUMP has no deterministic live-write guard — the gate dropped only questions/first-person; `isDumpMemory` lived only in cleanup (skeptic H1) | **FIXED** — `classifyNonFact` now includes `isDump`; `applyFactGate` drops dumps on `infer:true` with a `dump`-reason audit event. Test: `fact-gate.test.ts` "drops a 400-word transcript dump". |
| F2 | HIGH | `cleanupWriteQuality` is orphaned — no caller/export/CLI; existing pollution not retirable (all 3 agents) | **FIXED** — exported from `@usetheo/memory`; `themory cleanup-write-quality [--apply]` CLI (dry-run default, reversible) co-located with its handler; `cli.test.ts` asserts registration. |
| F3 | HIGH | DoD parity ratio unmeasured; fixture/metric had no executable consumer (test-quality + skeptic + correctness) | **FIXED (harness)** — `packages/eval/scripts/write-quality-benchmark.mjs` consumes the fixture end-to-end (`POST /v1/remember` infer:true → `GET /v1/scopes` → ratio, ≥3 runs). Real number recorded post-deploy against the live LLM (real OpenAI) — see `docs/benchmarks/m27-write-quality-vs-mem0.md`. |
| F4 | MEDIUM | "non-circular metric" overstated; durable-fact regex triplicated (fact-gate/cleanup/write-quality) — DRY (all 3) | **FIXED** — single source of truth `fact-gate.ts` (`classifyNonFact`/`isSingleThirdPersonFact`), reused by cleanup + eval metric; the claim is corrected to "measures the DoD property; evidence comes from scoring real LLM output". |
| F5 | MEDIUM | First-person net too thin (Eu recomendo / I think / We decided bypass) AND `vou\s`/`let me` over-filter proper nouns (skeptic + correctness) | **FIXED** — opener set widened (recomendo/acho que/penso que/I think/we decided/…) and tightened (`vou\s+[a-zà-ú]{2}` won't match "Vou Nguyen"). PT regression test added. |
| F6 | MEDIUM | attributed_to surfaced on the theo-memory REST half only; the dashboard UI is theo-cloud (skeptic) | **SCOPED (honest)** — the theo-memory deliverable (REST field) is complete + tested; the theo-cloud gateway passthrough + dashboard column is the cross-repo companion (plan Unresolved Q1). Done as a theo-cloud follow-up. |
| F7 | MEDIUM | Language regression only string-contains, not behavior (test-quality) | **FIXED** — `fact-gate.test.ts` PT case: a PT declarative fact is kept unchanged; PT first-person openers drop. Real prompt-following measured by the post-deploy benchmark. |
| F8 | MEDIUM | cleanup can soft-delete a legit long fact; 200(metric)-vs-400(cleanup) threshold mismatch (skeptic) | **MITIGATED + aligned** — dump threshold unified in `fact-gate.isDump` (>200 AND multi-sentence/newline); soft-delete is reversible (`t_invalid`) with dry-run default (ADR-3). A single long *one-sentence* fact is NOT caught (test proves it). |
| — | INFO | normalize positional id synthesis discards a numeric id (correctness) | **ACKNOWLEDGED** — verified harmless: draft `.id` is parse-only, never consumed downstream (persist uses `randomUUID`); `linked_memory_ids` reference a separate namespace. |

## Verified CLEAN (no defect)

- `infer:false` verbatim path byte-identical — `applyFactGate` unreachable from the `pipeline.ts:75` early return (all 3 agents).
- No filtered-array index desync — the gate reassigns `extracted` before every downstream array is built (correctness, verified).
- `scopes.ts withAttributedTo` sound; `normalize.ts` does not corrupt well-formed responses; layering correct (domain/application, no inner→outer import); the 3 new OTel events registered + emitted.
- The gate-wiring test is NOT tautological — removing `applyFactGate` would make it fail (test-quality, verified).

## Quality gates

- Core (extraction+application+event) 83/83 · api 302/302 · eval write-quality 4/4 · cli 91/91 · full core suite 1069 · typecheck clean · lint clean.
- `/code-quality`: PASS_WITH_CAVEATS (only `symbol_fab_unverifiable_typescript` — the known NO_NETWORK false-positive, not FAIL_HARD/INVALID).

## Handoff decision

READY_TO_MERGE — every HIGH is fixed + re-verified; F6 is an honestly-scoped cross-repo companion; the
DoD parity NUMBER is the one remaining evidence, produced by the executable benchmark against the live
LLM immediately post-deploy (the milestone's release gate).
