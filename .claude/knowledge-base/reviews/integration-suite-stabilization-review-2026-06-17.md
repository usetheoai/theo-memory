# Review: integration-suite-stabilization

**Date:** 2026-06-17
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-database, domain-cli-tooling (parallel, scoped to `bef52f7~1..HEAD`)
**Diff base:** `bef52f7~1` (slug-scoped; `main` is far behind develop — the v0.3.0 release is not yet merged to main, so a `main`-based diff would have reviewed the whole release out of scope)
**Findings (initial):** 38 total — BLOCKER: 0, HIGH: 2, MEDIUM: 9, LOW: 11, INFO: 16
**Findings (after inline fixes):** BLOCKER: 0, HIGH: 0, MEDIUM: documented/fixed
**Verdict:** READY_TO_MERGE

## Measurable goal — MET

- Keyless full integration suite: **494 passed | 61 skipped | 0 failed | 0 failed files**, across **two consecutive runs** (deterministic) against real `ankane/pgvector:v0.5.1`.
- Contract suite: **930 passed | 2 skipped**.
- `pnpm run typecheck`: 0 errors. `pnpm run lint`: 0 warnings.

## HIGH findings (both DISCLOSURE/PROCESS — fixed inline)

### F-xval-1 — ADR D1 hybrid divergence was undisclosed → FIXED
- Severity: HIGH · Found by: cross-validation (corroborated by architecture F-arch-1, wiring F-wire-1)
- Plan ref: ADR D1 / Coverage Matrix rows 2-10
- Summary: D1 mandated per-file unique-named `createIsolatedDb` for every DB-touching test and explicitly *rejected* "reset the shared DB". The implementation shipped a hybrid: `reset-shared-db.ts` (`setupFiles`, template-clone reset per file at top level) for the bulk + `createIsolatedDb` for ~4 heavy/state-sensitive files. The divergence is engineering-sound (resets BEFORE each file, closing the cross-file-pollution hole D1's rejected alternative left open; KISS — keeps `THEOMEM_PG_URI` stable) but was disclosed only in a commit body + code comment, not in an ADR or the user-facing CHANGELOG (which still described the unbuilt design under `[0.3.0]`).
- Resolution: added **ADR D1-a amendment** to the plan (full rationale + honest cost) + a correcting `[Unreleased]` CHANGELOG entry (the `[0.3.0]` entry is immutable per Rule 6). Commit `<doc-fix>`.

### F-xval-6 — release preceded review (cycle order inverted) → DISCLOSED
- Severity: HIGH (process) · Found by: cross-validation
- Summary: the slice was tagged **v0.3.0 before** this `/review`, and the final green fix (`10b6428`) landed **after** the tag — so `v0.3.0` does not contain the deterministically-green suite.
- Resolution: disclosed in ADR D1-a § Process disclosure; green fixes ship in the next release cut (v0.3.1). No history rewritten. This is a one-time anomaly from the work shipping before the cycle's review phase ran; the cycle is now completed retroactively.

## MEDIUM findings

| ID | Found by | Summary | Disposition |
|---|---|---|---|
| F-tests-1 | tests | Skip rationale in `agent-tools/the-goal.test.ts` over-claimed the multi-peer test covers cross-userId isolation (it covers `attributedTo`-within-alice). | FIXED — wording retargeted to `local-runtime.test.ts` (the real cross-userId coverage). |
| F-arch-1 / F-wire-1 | architecture / wiring | Same root as F-xval-1 (D1 divergence). | FIXED via ADR D1-a. |
| F-wire-2 / F-xval-4 | wiring / cross-validation | Real product DDL fix (migration `0015` CHECK NULL-hole + `schema.ts`) landed in a "test-infra" branch — wider than D4 declared. | ACCEPTED — domain-database verified the fix is sound, drizzle parity intact (16 SQL = 16 snapshots = 16 journal), and it is an honest D2 regression fix (not a test hack). Disclosed in ADR D1-a § Honest cost. |
| F-tests-2 | tests | A stub-prompt-coupling test was skipped rather than rewritten. | ACCEPTED — tracked as stub-modernization follow-up; coverage exists via real-LLM distillation tests. |
| F-tests-6 | tests | test 8 (CHANGELOG warm-up) now matches the caveat anywhere in the file (slightly under-constrained). | ACCEPTED — durable contract is "documented in CHANGELOG"; acceptable. |
| F-xval-3 | cross-validation | 5 `describe.skip`/`test.skip` are a 3rd Bucket B disposition D2 never enumerated; guards tracked only in code comments. | ACCEPTED — each carries an honest stale/non-regression rationale with verified cross-coverage; follow-ups recommended as tracked issues. |

## LOW / INFO (logged — non-blocking, recommended follow-ups)

- F-tests-8 — hardcoded `~/.nvm/.../npm` path in `full-public-surface.test.ts:32` (pre-existing; CI-portability risk). **Recommend follow-up.**
- F-dom-db-1 — `siblingUri()`/`adminUriFrom()` drop query params (e.g. `?sslmode=require`) when rewriting the db name; benign in param-free CI, would break a TLS-required Postgres. **Recommend follow-up.**
- F-dom-db-2 — migration `0015` uses bare `DROP CONSTRAINT` (no `IF EXISTS`), less self-healing than sibling `0002`. Correct in the forward chain.
- F-dom-cli-8 — `post-install-bin.test.ts` permanent skip retires a consumer-path regression guard without a documented replacement. **Recommend the publish-topology follow-up add an equivalent `packages/core` pack-contract sentinel.**
- Positive confirmations (INFO): template-build connection handling correct; HNSW-drop confined to the isolated clone (production `memories_embedding_hnsw_idx` intact); no `tests/**` symbol imported by `src/**`; all 5 new helper exports have real consumers (zero dead exports); README ↔ CLI/MCP surface consistent.

## Cross-validation summary
- Plan tasks: T0.1 ✅ · T1.1 ⚠ diverged (hybrid, disclosed via D1-a) · T2.1 ✅ (Bucket B triaged; 2 real regressions fixed in-product, 5 honest skips) · T3.1 ✅
- Coverage Matrix: 18/18 gaps' GOALs met; rows 2-10 met via the hybrid mechanism (disclosed).
- Plan not edited after `/implement` started (frozen contract); D1-a is an explicit post-review amendment, dated.

## Quality gates summary
- Integration (keyless): 0 failed / 0 failed files (494 passed, 61 skipped) ×2 deterministic — PASS
- Contract: 930 passed — PASS
- typecheck: 0 errors — PASS · lint: 0 warnings — PASS
- D4 (no `runMigrations` public-contract change): honored.

## Spawned agents (audit trail)
- `.claude/agents/review-integration-suite-stabilization-2026-06-17/architecture.md` (+ findings/architecture.md)
- `.claude/agents/review-integration-suite-stabilization-2026-06-17/tests.md` (+ findings/tests.md)
- `.claude/agents/review-integration-suite-stabilization-2026-06-17/wiring.md` (+ findings/wiring.md)
- `.claude/agents/review-integration-suite-stabilization-2026-06-17/cross-validation.md` (+ findings/cross-validation.md)
- `.claude/agents/review-integration-suite-stabilization-2026-06-17/domain-database.md` (+ findings/domain-database.md)
- `.claude/agents/review-integration-suite-stabilization-2026-06-17/domain-cli-tooling.md` (+ findings/domain-cli-tooling.md)

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER. The 2 HIGH findings were disclosure/process (not code defects) and are resolved inline (ADR D1-a + CHANGELOG clarification + process disclosure). MEDIUM findings are fixed or accepted with documented rationale. Recommended follow-ups (stub modernization, CI-path portability, TLS query-param preservation, post-install pack sentinel) are logged for a tracked follow-up cycle and do not block this merge. The plan's measurable goal — a deterministically-green keyless integration suite that can gate a production deploy — is met and twice-verified.
