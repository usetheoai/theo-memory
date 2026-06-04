# Review: theo-memory-standalone-p0

**Date:** 2026-06-03
**Plan version:** v1.3 (frozen at f94c3007)
**Branch:** develop
**Diff base:** f94c3007b72703b62b75b1b88a4dd7dd3287cff4 (commit immediately before T0.1=c101b3f)
**Diff: 19 commits** (18 task commits T0.1→T3.5 + 1 auxiliary SEPA-logs `chore(audit)` commit)

**Reviewers (8 spawned agents):**
- architecture — `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/architecture.md`
- tests — `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/tests.md`
- wiring — `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/wiring.md`
- cross-validation — `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/cross-validation.md`
- domain-memory-layer — `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/domain-memory-layer.md`
- domain-pgvector-schema — `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/domain-pgvector-schema.md`
- domain-api-design — `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/domain-api-design.md`
- domain-db-migrations — `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/domain-db-migrations.md`

**Verdict:** **NEEDS_FIXES** — 1 CRITICAL blocker (skill-scope contract divergence) confirmed by two independent reviewers (memory-layer + architecture) on the same defect locus. No BLOCKERs. Several MAJORs accepted-with-caveats or eligible for follow-up cycle.

## Findings count summary

| Severity | Total | Source agents |
|---|---|---|
| BLOCKER | **0** | — |
| CRITICAL | **1** (with 2 confirmations + 1 secondary defect) | memory-layer F-dom-mem-1, architecture F-arch-1, memory-layer F-dom-mem-2 (scope listing) |
| MAJOR | **~13** | architecture (6), api-design (5), wiring (1), cross-validation (1) |
| MINOR | **~22** | tests (7), api-design (4), architecture (3), wiring (3), cross-validation (4), memory-layer (1) |
| INFO | **~80** | all reviewers |

## CRITICAL findings (must fix before merge)

### F-rev-1 — `skillRepoId` REST path crashes at runtime (CRITICAL)

- **Severity:** CRITICAL
- **Found by:** memory-layer (F-dom-mem-1, F-dom-mem-2, F-dom-mem-3), architecture (F-arch-1) — two independent reviewers, same defect locus
- **Files:**
  - `src/server/schemas.ts:14` (`SCOPE_KEYS` includes `'skillRepoId'`)
  - `src/server/schemas.ts:88-99` (`MemoryLike` interface lies: types `skills: (repoId) => ScopedMemoryLike` where `ScopedMemoryLike = { remember, recall, reflect }`)
  - `src/server/schemas.ts:108` (`resolveScope` routes `skillRepoId` → `memory.skills(repoId)`)
  - `src/server/handlers/remember.ts`, `recall.ts`, `reflect.ts` lines 29/29/31 (`memory as unknown as MemoryLike`)
  - `src/server/handlers/scopes.ts:49` (`memory.skills(id) as unknown as ScopedMemory` + line 113 `scoped.getAll()`)
- **Plan reference:** ADR D12 (single-scope-tier semantic, 4 tiers admitted); CLAUDE.md Roadmap Item 12 (skill-scope `asOf` explicitly DEFERRED per plan v1.3 ADR D4 amendment)
- **Defect:** the REST schemas + `resolveScope` route `skillRepoId` to `Memory.skills(repoId)` which returns `ScopedSkillMemory` (`add` / `recall` / `consolidate` / `forget` — see `src/core/skill.ts:169-172`). The handlers then call `.remember()`, `.reflect()`, `.recall(query, options)`, `.getAll()` — methods that DO NOT EXIST on `ScopedSkillMemory`. The double-cast `as unknown as MemoryLike` (with a locally-redeclared fake `MemoryLike`) bypasses the type system precisely at the load-bearing call site.
- **Production blast radius:**
  - `POST /v1/remember` with `{ "skillRepoId": "repo-x", "text": "..." }` → 500 `INTERNAL_ERROR` (`TypeError: remember is not a function` caught by `app.onError`).
  - `POST /v1/reflect` with `{ "skillRepoId": "repo-x" }` → 500 (`reflect is not a function`).
  - `POST /v1/recall` with `{ "skillRepoId": "repo-x", "query": "..." }` → either runs (returns `SkillWithScore[]` shape that schema doesn't expect) OR drops `asOf`/`attributedTo` silently (skill-scope variant lacks those options).
  - `GET /v1/scopes/skill/repo-x/memories` → 500 (`getAll is not a function`).
- **Why tests pass:** the in-process test mocks stub `memory.skills(id)` with a synthetic `ScopedMemory`-shaped fake (`scopes.test.ts` `stubScopedWithItems` adds `getAll`, `remember`, `recall`, `reflect`). The shape never exists in production via `LocalScopedSkillMemory`. Test mock contract != production contract.
- **Recommended action — pick ONE:**
  1. **REMOVE `skillRepoId` from `RememberBody`/`RecallBody`/`ReflectBody`/`ForgetBody` SCOPE_KEYS.** REST scope listing (`GET /v1/scopes/skill/:id/memories`) gets a typed honest-deferral 501 envelope OR is removed. Plan only required 3-tier REST verbs; skill-scope was undeclared scope creep that the SDK contract cannot honor structurally. **THIS IS THE P0-CORRECT FIX** (smallest diff, restores plan ground truth).
  2. **Extend `ScopedSkillMemory` interface** with `remember`/`reflect`/`getAll` methods that throw `BiTemporalNotSupportedLocally`-style typed errors (or `NotImplementedError`) AND add error mappers in `src/server/errors.ts` returning 501. Larger surface change; harder to walk back.
  3. **Discriminated-union dispatch** in handlers: route `skillRepoId` to a separate `skillRememberHandler`/`skillReflectHandler` that explicitly returns 422 INVALID_SCOPE with a body explaining "skill scope does not support remember/reflect; use Memory SDK directly". Removes the type-cast escape hatch.
- **Severity rationale:** while the 4 main routes work correctly for the 3 declared tiers (user/session/agent), the standalone REST surface accepts requests it cannot fulfill and returns 500 (sanitized) — consumers see an undebuggable internal error rather than 422/501. This is exactly the failure mode that Inquebrável Rule 8 (Fail Fast) and architecture.md § 8 (validate at boundaries) exist to prevent. Coverage gap is masked by test mocks that don't match production shape (`testing.md § What NOT to test` — "TypeScript types directly" — but here the mock IS the type and the type IS wrong).

## MAJOR findings (require human review)

### F-rev-2 — `tsconfig.build.json` omits `src/server/**/*.ts` (wiring F-wire-1)

`dist/server/*` is produced today via tsc transitive expansion from `src/agent-tools/cli.ts → run-server.ts → ../server/index.js`. Works today; fragile to any refactor that removes the cli→server import chain. `tests/integration/config-parity.test.ts` does NOT cover `tsconfig.build.json`. **Fix:** add the include + extend parity test. **Effort:** ~10 lines.

### F-rev-3 — Health-endpoint auth-exempt shipped without ADR D3 amendment (cross-validation F-xval-2)

T3.5 commit `fc4ec5c` extended the EC-19 OpenAPI auth-exempt pattern to `/v1/health` + `/v1/health/db` to fix docker-compose healthcheck round-trip. Industry-correct (RFC 9110 + OWASP `/healthz`) and necessary, but shipped without amending ADR D3. **Cycle-implement anti-pattern #7 violation (silent scope creep).** Regression test exists (`handlers.test.ts` 11a/11b) but ADR amendment is missing.

### F-rev-4 — `ContentTooLargeError` mapper exists but no body-limit middleware (api-design F-dom-api-4)

`mapDomainErrorToResponse` maps `ContentTooLargeError → 413`, but nothing in `src/server/` ever raises it. `safeJson()` reads `c.req.text()` unbounded. Real DOS surface. **Fix:** mount `hono/body-limit` middleware with a sensible default (e.g., 1MB) OR document the gap as out-of-P0-scope with sunset.

### F-rev-5 — `mapDomainErrorToResponse` log noise (api-design F-dom-api-5)

`logSanitized(err)` is called BEFORE the switch — every 422 InvalidScope / 404 MemoryNotFound emits a `console.error` log alongside legitimate user-input rejections. Log volume bloat + alerting false-positives. **Fix:** move `logSanitized()` into the default 500 branch only.

### F-rev-6 — `getHealth` OpenAPI spec drift (api-design F-dom-api-2)

OpenAPI registration declares only 200; impl can return 503 `warming_up` (EC-33). Spec lies. **Fix:** add 503 response declaration mirroring `getHealthDb`'s shape.

### F-rev-7 — OTel span comment lies (api-design F-dom-api-1)

`src/server/app.ts:81-85` comment claims `openapi.json` gets an OTel span, but `app.doc()` registers the route BEFORE `app.use('/v1/*', otelMiddleware)` so it does not. Verified empirically by reviewer. Behavior is benign; comment lies. **Fix:** either correct the comment OR move doc registration below the otel middleware.

### F-rev-8 — Three handlers double-cast `Memory as unknown as MemoryLike` (architecture F-arch-2, wiring F-wire-4, memory-layer F-dom-mem-4)

`MemoryLike` re-declares the shape with `Promise<unknown>` return types — broader than `Memory`. Double-cast through `unknown` is canonical "sidestepping the type system" smell. **Same root as F-rev-1**; fixing F-rev-1 by option 1 (removing `skillRepoId`) makes this cast unnecessary.

### F-rev-9 — `themory server` silently wires `DeterministicStubEmbedder` + `StubLLM` by default (architecture F-arch-5)

Consumers of `ghcr.io/usetheo/themory:0.1.0-alpha` have no runtime signal that recall produces coincidental cosine-1.0 hits against stored text rather than semantic retrieval. Inquebrável Rule 3 violation at consumer-facing boundary. **Fix:** loud startup stderr warning + README documents the gap + `themory health --deep` surfaces "stub embedder active".

### F-rev-10 — Two CLI composition roots wire DIFFERENT stub embedders (architecture F-arch-6)

`run-server.ts:120` uses `DeterministicStubEmbedder` (`src/embedders/stub.js`); `run-health.ts:75` + `run-mcp-server.ts:94` use `StubEmbedder` (`src/local/index.js`). Drift waiting to bite — `themory health --deep` pings a different embedder than `themory server` runs. **Fix:** centralize the default in a `createDefaultStubMemory(pool)` helper.

### F-rev-11 — Memory shim Proxy in `run-server.ts` undocumented contract (architecture F-arch-4)

The Proxy throws a string `Error` on `get` when Memory factory mid-warmup. Surfaces as unmapped 500 instead of 503. **Fix:** introduce `MemoryNotReadyError` in `src/core/errors.ts` mapped to 503 `warming_up`, OR await `warmPromise` before `serve()` (simpler).

### F-rev-12 — Cross-handler dependency cluster: shared body-parsing utilities exported from `remember.ts` (architecture F-arch-3, api-design F-dom-api-6, wiring F-wire-6)

`recall.ts`, `forget.ts`, `reflect.ts` import `safeJson`/`EMPTY_BODY`/`MALFORMED_BODY`/`scopeOrValidationError` from `./remember.js`. SRP violation + avoidable directed coupling. **Fix:** extract to `src/server/handlers/_body-parsing.ts`. Trivial 4-import refactor.

### F-rev-13 — `architecture.md § 3` literal text contradicts ADR D11 composition-root pattern (wiring F-wire-3)

The file says "`src/agent-tools/` depends on `src/core/` only" but 9 new imports from `src/agent-tools/run-*.ts` go to `src/local/`, `src/server/`, `src/embedders/`. ADR D11 establishes the composition-root pattern; architecture.md is stale. **Fix:** amend architecture.md § 3 citing ADR D11.

### F-rev-14 — ADR D12 vs implementation contradiction on `/v1/forget` scope (api-design F-dom-api-3)

ADR D12 says forget accepts exactly one scope tier; implementation correctly delegates to top-level `Memory.forget(memoryId)` (no scope, per v0.4b T7.1). Plan-vs-implementation contradiction. **Fix:** file ADR D12 erratum clarifying that `forget` is scope-less (memoryId is globally unique).

## MINOR findings (logged; merge can proceed)

22 MINOR across reviewers covering: env-mutation tests without `vi.stubEnv` (F-tests-1 + F-arch-45), eslint server-glob missing (F-arch-41), hybrid OpenAPI registration vs canonical `createRoute` migration (F-arch-9 — documented trade-off), schemas.ts exports half-public (F-wire-4), `redactSecrets` orphan export (F-wire-2), validation report wiring_triad shows 0 tasks (F-wire-5 — `/implement-validate` script bug, not plan defect), `superRefine` instead of plan's `z.union` (F-xval-1 — behavior identical), StubEmbedder→DeterministicStubEmbedder switch not documented in CHANGELOG (F-xval-3), OpenAPI ships 7 ops vs plan's 6 (F-xval-4 — EC-17 absorption added `getHealthDb`), cursor pagination O(scope_size) honestly disclosed in JSDoc (F-xval-5), zod superRefine constraint doesn't project to OpenAPI spec (F-dom-api-7), EC-40 build static guard missing (F-tests-3), EC-36 idempotency tautology (F-tests-5/6), `field` envelope underused (F-dom-api-9), `migrate` failure path skips `pool.end()` (F-dom-dbmig-1 INFO).

## Edge-case coverage report

**Tests reviewer manual analysis (authoritative):** 37 / 52 ECs covered by named tests (all 12 MUST FIX + all 25 SHOULD TEST), 3 partial (EC-38 glibc native-deps smoke, EC-40 build static guard, EC-36 actually-concurrent migrate), 13 document-only per plan.

**Deterministic keyword script:** 8 covered / 31 missing (high false-negative rate; superseded by reviewer analysis).

**Verdict on coverage:** all 12 MUST FIX ECs implemented; all 25 SHOULD TEST exercised in RED tests. The 3 partials are honest gaps documented as MINOR.

## Cross-validation summary

| Metric | Count |
|---|---|
| Plan tasks | 18 (T0.1, T1.1–T1.7, T2.1–T2.5, T3.1–T3.5) |
| Commits | 18 + 1 auxiliary (43b0ffc SEPA logs) |
| Fully implemented | 17 |
| Diverged-acceptable (T3.5 — F-rev-3 health auth-exempt) | 1 |
| Missing | 0 |
| Partial | 0 |
| Plan drift | NONE (plan frozen at base commit f94c300) |

## Quality gates summary

| Gate | Status |
|---|---|
| `npm test` | **PASS** (943 contract / 2 skipped, 0 failures, 0 type errors) |
| `npm run typecheck` | **PASS** (0 errors) |
| `npm run lint` | **PASS** (0 warnings) |
| THE GOAL TEST (`tests/integration/docker-stack.test.ts`) | **PASS** (6/6, DOCKER_INTEGRATION=true) |
| v0.3 e2e regression (`tests/e2e/agent-tools/round-trip.test.ts`) | **PASS** (1/1) |
| Wiring triad pillar (a) | 38/39 honest PASS (1 MINOR orphan `redactSecrets`) |
| Wiring triad pillar (b) | 39/39 PASS |
| Wiring triad pillar (c) | 2/2 OBSERVED (`rest.v1.*` spans + THE GOAL METRIC) |
| Image size < 200MB | 199.7MB (verified) |
| Image nonroot UID 65532 | PASS |
| Image distroless no-shell | PASS (`/bin/sh` not found) |
| ADR D14 deps pinned | PASS (4 NEW deps with sunset 2026-09-01) |

## Inviolable rules verification

| Rule | Status |
|---|---|
| Inquebrável Rule 1 (95% confidence) | All SEPA iterations consulted; CRITICAL flagged + absorbed where surfaced |
| Inquebrável Rule 3 (extreme honesty) | CHANGELOG documents `/dogfood` EVIDENCE_INSUFFICIENT per Phase entry; F-rev-9 flags consumer-facing honesty gap on stub embedder |
| Inquebrável Rule 4 (git safety) | All 18 commits on `develop`; never on `main`; no `git checkout`/revert/force/reset --hard observed |
| Inquebrável Rule 5 (TDD) | RED+GREEN in same commit for every T*.* task |
| Inquebrável Rule 6 (CHANGELOG) | Phase 1 + Phase 2 + Phase 3 entries with ticket placeholder (#TBD); F-xval-3 flags DeterministicStubEmbedder switch not yet entered |
| Inquebrável Rule 9 (Não Reinvente) | Hono / commander / @hono/zod-openapi / @apidevtools/swagger-parser / Trivy all adopted per ADR D14 with rationale |
| Inquebrável Rule 11 (YAGNI) | F-rev-1 is the inverse: `skillRepoId` REST scope was YAGNI scope creep that crashes production |

## `/dogfood` gate (separate honesty gate)

Remains **EVIDENCE_INSUFFICIENT** per audit `6f7ff87` (2026-05-31). This plan does NOT unblock production-ready claims. Roadmap Item 11 v1.0 gate still requires anchor scenario "Claude Code auto-memory backed by TheMemory" `running` ≥ 30 days with evidence logs.

## Spawned agents (audit trail — persisted in git)

- `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/architecture.md`
- `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/tests.md`
- `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/wiring.md`
- `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/cross-validation.md`
- `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/domain-memory-layer.md`
- `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/domain-pgvector-schema.md`
- `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/domain-api-design.md`
- `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/domain-db-migrations.md`

Individual findings YAMLs at `.claude/agents/review-theo-memory-standalone-p0-2026-06-03/findings/{role}.yaml`.

## Handoff decision

**NEEDS_FIXES — loop back to `/implement` with a fix-up plan.**

**Mandatory before merge:**
1. **F-rev-1 (CRITICAL)** — resolve skill-scope contract divergence via Option 1 (remove `skillRepoId` from REST schemas — smallest diff, P0-correct) OR Option 2/3 with ADR-style dismissal in this report.

**Recommended pre-merge (lift verdict from NEEDS_FIXES → READY_TO_MERGE_WITH_CAVEATS):**
2. F-rev-3 — file ADR D3 amendment for health-endpoint auth-exempt extension OR add explicit dismissal note in CHANGELOG with rationale (industry-correct, RFC 9110 + OWASP convention).
3. F-rev-4 — mount `hono/body-limit` middleware OR document the DOS surface deferral in CHANGELOG.
4. F-rev-9 — add stub-embedder loud startup warning to `themory server` so operators of the alpha image see the disclosure.
5. F-rev-12 — extract `src/server/handlers/_body-parsing.ts` (trivial 4-line refactor).

**Acceptable-with-caveats (merge can proceed if surfaced in PR description):**
- F-rev-2 (tsconfig.build.json fragility) — works today via transitive expansion; add to follow-up cycle.
- F-rev-5/6/7 (api-design hygiene) — fix in follow-up cycle.
- F-rev-8/10/11/13/14 — surface in PR; pre-existing-debt-adjacent or single-file edits.
- All MINOR findings — log; follow-up cycle.

**Loop-back contract:** invoke `/implement` with a fix-up plan that absorbs F-rev-1 (mandatory) + #2-#5 above (recommended). Re-run `/review theo-memory-standalone-p0` after fix-up commits land. Target verdict: `READY_TO_MERGE_WITH_CAVEATS` or `READY_TO_MERGE`.

**`/review` cycle cost:** estimated 250-350k tokens across 8 parallel agents (above the cycle-review.md target of 150-250k; warranted by the 19-commit / 21-file / 7-new-integration-test diff surface).
