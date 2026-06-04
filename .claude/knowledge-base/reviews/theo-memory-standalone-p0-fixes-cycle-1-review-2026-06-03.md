# Review: theo-memory-standalone-p0-fixes-cycle-1

**Date:** 2026-06-03
**Mode:** Full `/review` — 6 spawned agents in parallel (4 baseline + 2 domain)
**Plan:** `.claude/knowledge-base/plans/theo-memory-standalone-p0-fixes-cycle-1-plan.md` v1.2
**Source plan:** `.claude/knowledge-base/plans/theo-memory-standalone-p0-plan.md` v1.4 (T2.3 ADR D3 amendment shipped in fix-up)
**Branch:** `develop` @ `c9fc343`
**Diff range:** `0e40344..HEAD` (11 commits total, 6 fix-up task commits)

**Verdict:** **READY_TO_MERGE_WITH_CAVEATS**

- F-rev-1 CRITICAL absorption verified GENUINELY clean across 6 verification dimensions
- F-rev-3/4/9/12 MAJOR absorptions verified shipping correctly (4/4) + F-rev-8 closed as side effect
- 3 new MAJOR findings from this re-review (none block merge):
  - F-arch-7 / F-wire-1 (same root) — MCP-side stub-embedder warning has NO RED test
  - F-dom-api-1 — OpenAPI spec missing 501 SKILL_LISTING_NOT_IMPLEMENTED for `listScopeMemories`
  - F-dom-api-2 — OpenAPI spec missing 413 CONTENT_TOO_LARGE for all 4 verb endpoints
- 11 MINOR + 17 INFO surfaced (none block merge)
- `/dogfood` gate INDEPENDENTLY remains EVIDENCE_INSUFFICIENT — this fix-up does NOT unblock production-ready claims

## Reviewers (spawned agents)

| Agent | Status | Verdict |
|---|---|---|
| architecture | completed | READY_TO_MERGE_WITH_CAVEATS |
| tests | completed | READY_TO_MERGE |
| wiring | completed | READY_TO_MERGE_WITH_CAVEATS |
| cross-validation | completed | READY_TO_MERGE_WITH_CAVEATS |
| domain-memory-layer | completed | ABSORPTION_GENUINE_NO_BLOCKERS |
| domain-api-design | completed | READY_TO_MERGE_WITH_CAVEATS |

## Findings tally

| Severity | Architecture | Tests | Wiring | Cross-val | Memory-layer | API-design | **Total** |
|---|---|---|---|---|---|---|---|
| BLOCKER | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| CRITICAL | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| MAJOR | 1 | 0 | 0 | 0 | 0 | 2 | **3** (F-wire-1 = F-arch-7 same root) |
| MINOR | 3 | 3 | 1 | 1 | 0 | 2 | **10** |
| INFO | 7 | 2 | 3 | 2 | 0 | 3 | **17** |

## BLOCKER findings

**NONE.** Cycle MAY advance to PR merge after MAJOR triage below.

## CRITICAL findings

**NONE.** F-rev-1 (the only CRITICAL from the original /review) is GENUINELY closed.

## MAJOR findings (do NOT auto-block; require human triage before merge)

### F-arch-7 / F-wire-1 (same root — MCP-side stub-embedder warning has NO RED test)

- **Severity:** MAJOR
- **Found by:** architecture-reviewer + wiring-reviewer (independently flagged)
- **File:** `src/agent-tools/run-mcp-server.ts:81-92`
- **Plan reference:** fix-up T2.2 (F-rev-9 absorption)
- **Summary:** T2.2 added a 3-line stderr stub-embedder warning to BOTH `run-server.ts` (REST composition root) AND `run-mcp-server.ts` (MCP composition root). The FC1-T2.2-RED test in `run-server.test.ts` pins the REST-side emission. The MCP-side emission is runtime-wired but un-pinned by CI — future silent drop risk (next refactor cycle could remove it accidentally).
- **Evidence:** `run-mcp-server.ts:81-92` emits identical 3-line stderr block; `run-mcp-server.test.ts` does NOT exist; `cli.test.ts` does NOT assert MCP-side stderr.
- **Recommended action:** ~10 LoC test reusing existing pg/createLocalMemory/StubEmbedder mocks — assert `process.stderr.write` is called with text matching `/stub embedder/i` AND `/themory mcp/i`. Defer to a follow-up cycle is acceptable IF this finding is captioned in the PR body.

### F-dom-api-1 — OpenAPI spec missing 501 SKILL_LISTING_NOT_IMPLEMENTED for `listScopeMemories`

- **Severity:** MAJOR
- **Found by:** domain-api-design-reviewer
- **File:** `src/server/openapi.ts` (the `listScopeMemories` operation definition)
- **Plan reference:** fix-up T1.1 (F-rev-1 absorption — EC-5 OpenAPI re-validation)
- **Summary:** T1.1 short-circuits the `scope.type === 'skill'` branch to return 501 SKILL_LISTING_NOT_IMPLEMENTED at runtime, but the OpenAPI spec still advertises only `200/400/404/422` for `listScopeMemories`. Consumers using codegen (openapi-generator) or contract testing (Pact) will see an undocumented status code and may emit guaranteed-failing SDK methods.
- **Evidence:** Source plan T1.7 (OpenAPI spec generation) ran before this fix-up; spec was not patched in T1.1 because the response shape is identical (domain-error envelope) but the documented response code set drifted.
- **Recommended action:** Add `501: { description: 'Listing memories on skill scope is not implemented', content: { 'application/json': { schema: DomainErrorEnvelopeSchema } } }` to `listScopeMemories.responses`. ~5 LoC. Same EC-5 absorption test pattern: walk `openapi.json` and assert presence.

### F-dom-api-2 — OpenAPI spec missing 413 CONTENT_TOO_LARGE for 4 verb endpoints

- **Severity:** MAJOR
- **Found by:** domain-api-design-reviewer
- **File:** `src/server/openapi.ts` (4 verb operation definitions: `/v1/remember`, `/v1/recall`, `/v1/forget`, `/v1/reflect`)
- **Plan reference:** fix-up T2.1 (F-rev-4 absorption — body-limit DOS guard)
- **Summary:** T2.1 wires `hono/body-limit` to return a 413 envelope on bodies > 1MB. The OpenAPI spec advertises only `201/400/422` (+ `500` for `remember`) — 413 is undocumented. Same blast radius as F-dom-api-1.
- **Evidence:** Source plan T1.7 ran before T2.1; the body-limit absorption added a new response code without spec amendment.
- **Recommended action:** Add `413: { description: 'Request body exceeds 1MB limit', content: { 'application/json': { schema: DomainErrorEnvelopeSchema } } }` to all 4 verb operations. ~20 LoC. EC-5 OpenAPI walker test extends naturally.

## MINOR findings (10 — none block merge)

| ID | File | Summary | Triage |
|---|---|---|---|
| F-arch-2 | `src/server/openapi.ts` ScopeTypeEnum | Spec advertises 'skill' as valid scope-type for path params even though impl returns 501 — codegen SDK methods will emit guaranteed-501 calls | Bundle with F-dom-api-1 fix |
| F-arch-4 | `src/server/handlers/_body-parsing.ts` | Module location debate (siblings under `handlers/` vs lifted to `src/server/_body-parsing.ts`) | DOCUMENT |
| F-arch-6 | `src/server/app.ts:103` | `ContentTooLargeError(1_000_000, -1)` sentinel value `-1` produces misleading "-1 bytes" string at logger surface | Consider widening the constructor signature OR mapping -1 to a sentinel string |
| F-tests-1 | `src/server/__tests__/handlers.test.ts:375` | FC1-T2.1-RED-2 uses direct `process.env` mutation with try/finally instead of `vi.stubEnv` (file convention drift) | Cosmetic |
| F-tests-2 | `handlers.test.ts:389` | Redundant `.not.toBe(401)` after `.toBe(413)` (tautological documentation) | Cosmetic |
| F-tests-3 | `handlers.test.ts:395` | FC1-T2.1-RED-3 asserts only `status === 201`; could assert `scoped.remember` was invoked | Optional strengthening |
| F-dom-api-3 | `src/server/openapi.ts` | 3 of 4 verbs missing 500 INTERNAL_ERROR in spec (pre-existing debt from source plan, NOT introduced by fix-up) | DOCUMENT (pre-existing) |
| F-dom-api-6 | `src/server/openapi.ts` ScopeTypeEnum description | Description gap — `skill` advertised as equivalent to `user/session/agent` semantically | Bundle with F-arch-2 |
| F-xval-1 | T1.1 AC #1 wording | Plan-template literal "ZERO hits" not met by strict grep (2 JSDoc explanatory refs + negative-test assertions); intent honestly satisfied | DOCUMENT — plan-template clarification candidate |
| F-wire-2 | `src/server/schemas.ts:102-106` | `MemoryLike` interface exported but consumed only by `resolveScope` param type (pre-existing orphan, NOT introduced by T1.1) | DOCUMENT (pre-existing); bundle with F-arch-2/6/7 LoC refactor cycle |

## INFO findings (17 — informational, no action)

Per-agent INFO findings consolidated by file under `.claude/agents/review-theo-memory-standalone-p0-fixes-cycle-1-2026-06-03/findings/{role}.yaml`. Highlights:

- F-rev-1 absorption verified clean across 6 dimensions (SCOPE_KEYS 3-tuple, ScopeFields no skillRepoId, MemoryLike no skills member, resolveScope no skillRepoId branch, pathParamsToScoped narrowed via `Exclude<ScopeType, 'skill'>`, scopesHandler short-circuits before dispatch).
- DIP boundary intact — `src/server/` imports zero from `src/local/`, `src/cloud/`, `src/theokit/`, `src/agent-tools/`. Composition root at `src/agent-tools/run-server.ts` is the legitimate import locus per ADR D8.
- Middleware order matches ADR D3 v1.1 verbatim (OTel → bodyLimit → health auth-exempt → bearer → handlers). Pinned by FC1-T2.1-RED-2 (2MB body + no auth + key set → 413 NOT 401).
- `mem0-shape` invariants UNTOUCHED. Zero diff under `src/core/`. ADD-only, three-tier, additive scoring, eight-phase write — all preserved.
- ADR D3 amendment (RFC 9110 § 5.1 + OWASP `/healthz`) shipped honestly with CHANGELOG `### Changed` entry + regression pinned by handlers.test.ts 11a/11b.

## Edge-case coverage report (per `theo-memory-standalone-p0-fixes-cycle-1-edge-cases-2026-06-03.md`)

| EC | Topic | Covered by | Status |
|---|---|---|---|
| EC-1 | T2.1 envelope shape (413 carries `{code, message}`) | FC1-T2.1-RED-1 | COVERED |
| EC-2 | T1.1 zod-strict vs INVALID_SCOPE ambiguity | FC1-T1.1-RED-1/2/3 `.not.toBe('INTERNAL_ERROR')` | COVERED |
| EC-3 | T1.2 import path updates | All 4 sibling handlers green | COVERED |
| EC-4 | T1.1 short-circuit BEFORE `memory.skills()` | scopes.test.ts #12b spy `.not.toHaveBeenCalled()` | COVERED |
| EC-5 | T1.1 OpenAPI re-validation | openapi.test.ts #5 walks 4 verb request bodies | COVERED (request-side only; gap is response-side per F-dom-api-1/2) |
| EC-6 | T2.2 stderr pollution | shared `beforeEach` stderr spy with `afterEach` restore | COVERED |
| EC-7 | T2.1 middleware order (bodyLimit BEFORE bearer) | FC1-T2.1-RED-2 | COVERED |
| EC-8 | T2.2 warning conditional gating | inline comment FOLLOW-UP marker at `run-server.ts:106-109` | DEFERRED (DOCUMENT) |
| EC-9 | T2.1 gzip-compression bypass | README "Body limit" subsection + reverse-proxy workaround note | DEFERRED (DOCUMENT) |

## Cross-validation summary

| task | commit | AC met | DoD met | verdict |
|---|---|---|---|---|
| T1.1 (F-rev-1 CRITICAL) | `6e3b4ee` | 10/10 (1 doc-only nit) | YES | FULLY_IMPLEMENTED |
| T1.2 (F-rev-12 SRP) | `703fc5a` | 5/5 | YES | FULLY_IMPLEMENTED |
| T2.1 (F-rev-4) | `1512654` | 7/7 | YES | FULLY_IMPLEMENTED |
| T2.2 (F-rev-9) | `ab03ae0` | 8/8 | YES | FULLY_IMPLEMENTED |
| T2.3 (F-rev-3 ADR) | `9883462` | 4/4 (1 enrichment nit) | YES | FULLY_IMPLEMENTED |
| T3.1 (gate re-run) | `c9fc343` | 4/4 (lightweight mode honestly disclosed) | YES | FULLY_IMPLEMENTED_LIGHTWEIGHT_MODE |

Plan v1.2 frozen since `/implement` start; zero ADR drift; 5/5 ADRs (D1-D5) honored.

## Quality gates summary

| Gate | Status |
|---|---|
| `npm test` | **PASS** (952 contract / 2 skipped / 121 test files; +4 vs baseline pre-fix-up) |
| `npm run typecheck` | **PASS** (0 errors) |
| `npm run lint` | **PASS** (0 warnings) |
| Wiring triad — pillar (a) static caller | PASS for every fix-up symbol (6 commits) |
| Wiring triad — pillar (b) integration | PASS (9 new tests across handlers/scopes/openapi/run-server) — F-wire-1 PARTIAL on MCP path |
| Wiring triad — pillar (c) runtime metric | n/a — no new metrics declared by the fix-up plan |
| DIP boundary check | PASS |
| CHANGELOG entries | PASS — 4 entries verified (T1.1 ### Fixed L19, T2.1 ### Added L15, T2.2 ### Added L13, T2.3 ### Changed L9) |

## Spawned agents (audit trail)

- `.claude/agents/review-theo-memory-standalone-p0-fixes-cycle-1-2026-06-03/findings/architecture.yaml`
- `.claude/agents/review-theo-memory-standalone-p0-fixes-cycle-1-2026-06-03/findings/tests.yaml`
- `.claude/agents/review-theo-memory-standalone-p0-fixes-cycle-1-2026-06-03/findings/wiring.yaml`
- `.claude/agents/review-theo-memory-standalone-p0-fixes-cycle-1-2026-06-03/findings/cross-validation.yaml`
- `.claude/agents/review-theo-memory-standalone-p0-fixes-cycle-1-2026-06-03/findings/domain-memory-layer.yaml`
- `.claude/agents/review-theo-memory-standalone-p0-fixes-cycle-1-2026-06-03/findings/domain-api-design.yaml`

## Honest disclosure

- **`/dogfood` gate remains EVIDENCE_INSUFFICIENT INDEPENDENTLY** (audit `6f7ff87` 2026-05-31). This fix-up cycle does NOT unblock production-ready claims; Roadmap Item 11 v1.0 gate still requires the anchor scenario running ≥ 30 days. README Status preserves "Pre-release. Not production-ready."
- **Pre-existing-debt MAJORs (F-rev-2/5/6/7/10/11/13/14)** are NOT closed by this fix-up cycle. They remain accepted-with-caveats per the original /review and continue tracked for follow-up cycles.
- **3 NEW MAJORs (F-arch-7=F-wire-1, F-dom-api-1, F-dom-api-2)** introduced by this fix-up cycle's spec-side gaps. None auto-block merge; all 3 are surfaceable in the PR body OR a follow-up `fixes-cycle-2` if the user prefers a clean re-review.
- **3 ADR D3 amendment** shipped in commit `9883462` — bumps source plan v1.3 → v1.4 with rationale documenting RFC 9110 § 5.1 + OWASP `/healthz` convention.

## Handoff decision

**READY_TO_MERGE_WITH_CAVEATS** — the 6 fix-up commits + the pre-existing accepted-with-caveats MAJORs + the 3 NEW MAJORs (all spec-side gaps + 1 missing MCP RED test) form a coherent ship-able state.

**Recommended PR scope:**
1. `develop → main` covering the fix-up commits + the original 24-commit cycle (6e3b4ee + 703fc5a + 1512654 + ab03ae0 + 9883462 + c9fc343 on top of the source-plan branch).
2. PR description MUST explicitly call out:
   - F-rev-1 CRITICAL closure (Option 1: skillRepoId removed from REST scope keys)
   - 4 MAJOR absorptions (F-rev-3 ADR D3 amendment, F-rev-4 body-limit, F-rev-9 stub-embedder warning, F-rev-12 SRP) + F-rev-8 side-effect closure
   - 3 NEW MAJORs (F-arch-7/F-wire-1 MCP-side RED test gap, F-dom-api-1 OpenAPI 501 spec gap, F-dom-api-2 OpenAPI 413 spec gap) — accepted-with-caveats OR fixed in a `fixes-cycle-2`
   - 8 accepted-with-caveats MAJORs pre-existing-debt deferred to follow-up cycles
   - `/dogfood` gate remains EVIDENCE_INSUFFICIENT — no production-ready language in PR body

**Plan archive:** after PR merge, move `theo-memory-standalone-p0-fixes-cycle-1-plan.md` to `.claude/knowledge-base/plans/completed/`. The source plan `theo-memory-standalone-p0-plan.md` also archives (last touched by T2.3 ADR D3 amendment).
