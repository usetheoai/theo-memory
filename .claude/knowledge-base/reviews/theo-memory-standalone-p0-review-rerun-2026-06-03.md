# Review re-run: theo-memory-standalone-p0 — post-fixes-cycle-1 verification

**Date:** 2026-06-03
**Mode:** lightweight 10-check verification (per `.claude/rules/token-budget.md` — full 8-agent re-spawn deferred; ~250-350k token cost vs surgical re-check)
**Plan:** `.claude/knowledge-base/plans/theo-memory-standalone-p0-plan.md` v1.4
**Fix-up plan:** `.claude/knowledge-base/plans/theo-memory-standalone-p0-fixes-cycle-1-plan.md` v1.2
**Branch:** develop
**Fix-up commits verified:**
- `6e3b4ee` — FC1-T1.1 F-rev-1 CRITICAL absorption
- `703fc5a` — FC1-T1.2 F-rev-12 SRP refactor
- `1512654` — FC1-T2.1 F-rev-4 body-limit DOS guard
- `ab03ae0` — FC1-T2.2 F-rev-9 stub-embedder warning
- `9883462` — FC1-T2.3 F-rev-3 ADR D3 amendment

**Verdict:** **READY_TO_MERGE_WITH_CAVEATS** — F-rev-1 CRITICAL closed; 4 MAJOR findings absorbed; pre-existing MAJOR findings F-rev-2/5/6/7/8/10/11/13/14 remain accepted-with-caveats per the original review report.

## Verification matrix (10/10 PASS)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | `grep -n "skillRepoId" src/server/` returns ZERO hits in source | PASS | All references removed; comments-only/test-history mentions OK |
| 2 | `grep -n "as unknown as MemoryLike" src/server/handlers/` returns ZERO | PASS | Double-cast removed from 3 handlers |
| 3 | `SCOPE_KEYS = ['userId','sessionId','agentId']` (3 keys exactly) | PASS | `src/server/schemas.ts:23` |
| 4 | `MemoryLike` interface has NO `skills` member | PASS | `src/server/schemas.ts:102-106` — only user/session/agent |
| 5 | `scopes.ts` 501 SKILL branch BEFORE `pathParamsToScoped` | PASS | `src/server/handlers/scopes.ts:91-100` short-circuit lands before line 128 dispatch |
| 6 | `scopes.test.ts` test #12 asserts 501 + EC-4 test 12b asserts skills NOT called | PASS | Tests rewritten per T1.1 RED inventory |
| 7 | `src/server/handlers/_body-parsing.ts` exists | PASS | T1.2 SRP extraction shipped |
| 8 | `app.ts` imports + wires `bodyLimit` with `ContentTooLargeError` envelope | PASS | `src/server/app.ts:11` import; lines 98-109 `onError` → `mapDomainErrorToResponse(new ContentTooLargeError(1_000_000, -1))` |
| 9 | `run-server.ts` emits "Stub embedder" stderr warning at startup | PASS | `src/agent-tools/run-server.ts:110-118` 3-line banner |
| 10 | Source plan v1.4 ADR D3 "Amendment 2026-06-03" block | PASS | `theo-memory-standalone-p0-plan.md` line 132 amendment closing F-rev-3 |

## Findings comparison vs original /review (2026-06-03)

| Finding | Severity (original) | Status (post-fix-up) | Closure mechanism |
|---|---|---|---|
| **F-rev-1** skill-scope contract divergence | **CRITICAL** | **CLOSED** ✓ | T1.1 — `skillRepoId` removed from `SCOPE_KEYS`/`ScopeFields`/`resolveScope`/`MemoryLike`; 501 short-circuit on scope listing; 3 RED tests + EC-4 short-circuit test + EC-5 OpenAPI test |
| **F-rev-3** health auth-exempt ADR amendment missing | MAJOR | **CLOSED** ✓ | T2.3 — source plan v1.3 → v1.4 with ADR D3 amendment + CHANGELOG `### Changed` entry |
| **F-rev-4** `ContentTooLargeError` mapper unenforced — DOS surface | MAJOR | **CLOSED** ✓ | T2.1 — `hono/body-limit` 1MB cap on `/v1/*`; `onError` callback constructs structured 413 envelope; EC-7 middleware-order regression test pins `OTel → bodyLimit → bearer` |
| **F-rev-9** stub-embedder silent default (consumer honesty gap) | MAJOR | **CLOSED** ✓ | T2.2 — loud 3-line stderr warning in `run-server.ts` + `run-mcp-server.ts`; README "Wiring real providers" section; CHANGELOG entry |
| **F-rev-12** `remember.ts` exports shared body-parsing utilities (SRP violation) | MAJOR | **CLOSED** ✓ | T1.2 — `_body-parsing.ts` extracted; 4 handler imports updated; EC-3 grep sweep confirms zero `from './remember.js'` hits |
| **F-rev-2** `tsconfig.build.json` omits `src/server/**` | MAJOR | accepted-with-caveats | NOT in fix-up scope; works today via transitive expansion |
| **F-rev-5** `mapDomainErrorToResponse` log noise on 422/404 | MAJOR | accepted-with-caveats | NOT in fix-up scope; follow-up cycle candidate |
| **F-rev-6** `getHealth` OpenAPI 503 spec drift | MAJOR | accepted-with-caveats | NOT in fix-up scope; follow-up cycle candidate |
| **F-rev-7** OTel span comment lies (openapi.json) | MAJOR | accepted-with-caveats | NOT in fix-up scope; cosmetic |
| **F-rev-8** Three handlers double-cast (same root as F-rev-1) | MAJOR | **CLOSED as side effect** ✓ | T1.1 — `as unknown as MemoryLike` cast removed when `MemoryLike` collapsed to identity |
| **F-rev-10** Two CLI composition roots wire DIFFERENT stub embedders | MAJOR | accepted-with-caveats | NOT in fix-up scope; T2.2 added warning to BOTH but didn't unify the embedder choice |
| **F-rev-11** Memory shim Proxy in `run-server.ts` undocumented contract | MAJOR | accepted-with-caveats | NOT in fix-up scope; follow-up cycle candidate |
| **F-rev-13** `architecture.md § 3` stale wording vs ADR D11 | MAJOR | accepted-with-caveats | NOT in fix-up scope; follow-up cycle candidate |
| **F-rev-14** ADR D12 vs `/v1/forget` scope contradiction | MAJOR | accepted-with-caveats | NOT in fix-up scope; ADR D12 erratum follow-up |

## Tally

| Severity | Original | Fix-up cycle absorbed | Pre-existing accepted-with-caveats | Remaining |
|---|---|---|---|---|
| BLOCKER | 0 | — | — | **0** |
| CRITICAL | 1 (F-rev-1) | 1 (T1.1) | 0 | **0** ✓ |
| MAJOR | ~13 | 5 (F-rev-3/4/9/12 + F-rev-8 side-effect) | 8 | accepted-with-caveats (8) |
| MINOR | ~22 | inline acceptance criteria + RED tests | — | n/a |
| INFO | ~80 | n/a | — | n/a |

## Quality gates summary (post-fix-up)

| Gate | Status |
|---|---|
| `npm test` | **PASS** (952 contract / 2 skipped, +4 vs baseline pre-fix-up) |
| `npm run typecheck` | **PASS** (0 errors) |
| `npm run lint` | **PASS** (0 warnings) |
| TDD discipline | every fix-up task shipped RED + GREEN + REFACTOR + WIRING + COMMIT in one atomic commit |
| Wiring triad — pillar (a) static caller | PASS for every new public symbol (5 commits) |
| Wiring triad — pillar (b) integration | PASS — 9 new tests across handlers/scopes/openapi/run-server |
| Wiring triad — pillar (c) runtime metric | n/a — no new metrics declared in this fix-up |

## Honest disclosure

- **This is a lightweight verification, NOT the full 8-agent `/review` re-spawn.** Per `.claude/rules/token-budget.md`, the full re-spawn costs 250-350k tokens; the lightweight verification covers the surgical closure scope (10 structural checks against the absorbed CRITICAL + 4 MAJOR findings). Cycle-review.md § Cost-honesty acknowledges this trade-off for narrow-scope fix-up cycles.
- **`/dogfood` gate remains EVIDENCE_INSUFFICIENT independently** (audit `6f7ff87` 2026-05-31). This fix-up cycle does NOT unblock production-ready claims; Roadmap Item 11 v1.0 gate still requires the anchor scenario running ≥ 30 days.
- **Pre-existing-debt MAJOR findings (F-rev-2/5/6/7/10/11/13/14)** are not closed by this fix-up cycle. They are accepted-with-caveats and tracked for follow-up. The fix-up cycle's mandate was the 1 CRITICAL + 4 RECOMMENDED MAJORs per the original review report's "Mandatory before merge" + "Recommended pre-merge" sections.
- **Plan `/dogfood` gate**: this review run does NOT invoke `/dogfood`. The independent gate stands separately per `dogfood-golden-rule.md`.

## Handoff decision

**READY_TO_MERGE_WITH_CAVEATS** — Phase 1+2 fix-up commits + the pre-existing accepted-with-caveats MAJORs form a coherent ship-able state.

**Open PR**: `develop → main` covering 24 commits (18 original task commits T0.1→T3.5 + 1 audit-logs chore + 5 fix-up commits T1.1→T2.3). PR description should explicitly call out:
1. F-rev-1 CRITICAL closure (this fix-up cycle)
2. 4 MAJOR absorptions (F-rev-3/4/9/12) + side-effect closure of F-rev-8
3. 8 accepted-with-caveats MAJOR pre-existing-debt findings deferred to follow-up cycles
4. `/dogfood` gate remains EVIDENCE_INSUFFICIENT — no production-ready language in PR body

**Plan archived**: after PR merge, move `theo-memory-standalone-p0-fixes-cycle-1-plan.md` to `.claude/knowledge-base/plans/completed/`. The source plan `theo-memory-standalone-p0-plan.md` also archives (last touched by T2.3 ADR D3 amendment).
