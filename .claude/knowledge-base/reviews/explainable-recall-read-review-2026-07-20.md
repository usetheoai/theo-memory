# Review: explainable-recall-read (S2)

**Date:** 2026-07-20
**Reviewers (spawned agents):** 5 — architecture, tests, security/tenant-isolation, cross-validation, api-contract
**Diff base:** `4c3cdbb..HEAD` (16 files, +331/-19)
**Findings:** 15 (BLOCKER: 0, HIGH: 1, MEDIUM: 4, LOW: 7, INFO: many)
**Verdict:** NEEDS_FIXES → (post-fix) READY_TO_MERGE

## Quality gates (deterministic)

- `pnpm --filter @usetheo/memory-api exec vitest run`: 269/269 PASS
- `npx tsc -p tsconfig.contract.json`: 0 errors
- `eslint` on all 8 S2 production files: 0 warnings
- Integration `npm run test:integration -- recall-trace`: 18/18 PASS (real pgvector)
- File-size: all changed files ≤ 500 except pre-existing `scoped-memory.ts` (598) / `app.ts` (427) / `options.ts` (322) / `openapi-registration.ts` (633) — net adds minimal (scoped-memory +5 exactly, per AC)

## Security dimension — PASS (airtight)

The critical dimension. All 6 invariants verified adversarially, each backed by a test at the right layer:
- CWE-441/IDOR closed at the store boundary (`WHERE recall_id=$1 AND workspace_id=$2`, parameterized).
- No enumeration oracle (unknown id and foreign-workspace id both 404, identical path).
- Per-verb scope (`memory:read`); platform-admin mint key 403 (least privilege).
- Fail-closed in multi-tenant mode (no default-Principal collapse).
- recall_id = CSPRNG UUIDv4 (122 bits).
- Write-side workspace scoping consistent with the read filter.

## HIGH findings

### F-arch-1 — the read endpoint is DEAD in the production server
- **Found by:** architecture (confirmed independently).
- **File:** `packages/cli/src/run-server.ts:230-244`.
- **Plan ref:** ADR D4 Consequences ("the composition root passes the same PgRecallTraceStore it wired for the SDK"); Coverage Matrix #5.
- **Issue:** the production `createServer({...})` wires `memoryEntityStore` (line 244) but NOT `recallTraceStore`. Since the route is opt-in (`if (recallTraceStore !== undefined)`), `GET /v1/recall-traces/:recallId` is never mounted in the shipped server — the operator-facing Goal is unreachable in production. The integration test builds its own server WITH the store, so it passes while prod stays dark. This is the missing "caller" leg of the wiring triad.
- **Fix:** wire `recallTraceStore: new PgRecallTraceStore(pool)` in run-server.ts.

## MEDIUM findings

### F-arch-2 / F-api-1 (dedup) — handler serializes the raw domain row (over-exposure + spec mismatch)
- **File:** `packages/api/src/server/handlers/recall-traces.ts:27-34`; `openapi-registration.ts:614-624`.
- **Issue:** `drops` is the untransformed `RecallTraceRow[]` (11 fields). The OpenAPI schema declares 7. So each drop also ships `workspaceId`, `scopeKey`, `createdAt`, and a per-row `recallId` — internal tenant/scope keys the wire contract never advertised (not a cross-tenant leak — the caller's own workspace). Leaky abstraction (architecture.md § 6) + spec/response divergence.
- **Fix:** project rows to a DTO of exactly the documented fields.

### F-test-1 / F-xval-1 (dedup) — D1 "return-unchanged-with-recallId" test missing
- **Plan ref:** T1.1 AC bullet 3.
- **Issue:** the plan's load-bearing D1 oracle (recall() array identical with vs without a supplied recallId) is not implemented anywhere. Structurally D1 IS preserved (recallId flows only into the trace context), but the promised regression oracle is absent.
- **Fix:** add the assertion.

### F-test-2 — empty-string recallId branch untested
- **File:** `scoped-memory.ts:227` (`suppliedId.length > 0 ? … : randomUUID()`).
- **Issue:** the empty-⇒-mint branch introduced by the diff has no test.
- **Fix:** add a test passing `recallId: ''` → minted UUID.

### F-test-3 — plan's own Failure-scenario (connection error mid-read → 500) untested
- **Plan ref:** § Failure scenarios row 3.
- **Issue:** the negative case (store reject → 500 typed, NOT collapsed to 404) is unasserted.
- **Fix:** handler-level unit test with a rejecting stub store → 500.

## LOW findings (log; fix the cheap ones)

- **F-xval-5** — CHANGELOG missing a `### Changed` entry for the pre-release-breaking `getByRecallId` arity change (Rule 6 + plan DoD). → FIX.
- **F-xval-4** — empty-results recall test doesn't assert `recallId` present. → FIX (one line).
- **F-xval-3 / F-test-5** — no test asserts the OpenAPI spec declares `recallId` / the recall-traces path. → FIX (mirror the graphExpand test).
- **F-api-2** — OpenAPI registers the route unconditionally while it is conditionally mounted; not-wired case falls to a plain-text Hono 404 (no `app.notFound`). → note; broader `app.notFound` is out of S2 scope.
- **F-api-3** — recall response `recallId` field lacks the "trace populated only when tracing enabled" caveat that D2's mitigation (plan line 117) mandates. → FIX (add `.describe()`).
- **F-arch-3** — conditional-mount vs pass-through precedent wording imprecise. → note only.
- **F-xval-2** — T1.1 relocated from a phantom `scoped-memory.test.ts` to integration (honest deviation). → note.

## Cross-validation summary
- Plan tasks: 4. Fully implemented: 3 (T2.1, T3.1, T4.1). Partial: 1 (T1.1 — code correct, D1 oracle missing). Diverged: 0. Missing: 0.
- ADRs D1/D2/D3/D4: all HONORED. Coverage Matrix 6/6 real. Unresolved Q1/Q2/Q3 resolved as leaned.

## Edge-case coverage
- Covered: unknown id → 404, cross-workspace → 404, route-absent → 404, scope guard (memory:read).
- Missing: connection-error → 500 (F-test-3), empty-string recallId (F-test-2), tracing-off honest-empty (F-test-4, LOW).

## Handoff decision
NEEDS_FIXES. The fixes are small and clear; applied in a fix-cycle (below) → re-verify → READY_TO_MERGE. No BLOCKER; the security dimension (the highest-risk) is airtight.

## Spawned agents (audit trail)
- architecture (a9f8239), tests (a93e7da), security (a5717383), cross-validation (a4c85ac), api-contract (a4b7cb7) — findings consolidated above.
