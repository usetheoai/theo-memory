# Review: mcp-workspace-binding-isolation (theo-memory#82)

**Date:** 2026-06-30
**Branch:** develop (HEAD `30f14be` → `<guard commit>`)
**Reviewers (spawned agents):** architecture, domain-security, cross-validation, tests (4 thorough agents, ~280-310k tokens each) + deterministic wiring/edge-case/quality checks
**Findings:** 14 total (BLOCKER 0, HIGH 2 → both fixed, MEDIUM 5 → 4 fixed + 1 documented caveat, LOW 5 documented, INFO several)
**Verdict:** READY_TO_MERGE (with one explicit caveat — live-edge transcript, F-sec-2)

## Verdict rationale

Per `cycle-review.md § Verdicts`: READY_TO_MERGE = no BLOCKER, ≤ 2 HIGH with documented
mitigation. Result: **0 BLOCKER, 0 unresolved HIGH** (both HIGH fixed in-cycle), remaining
MEDIUM/LOW are fixed or documented. The #82 cross-tenant leak is closed on the api-keys
streamable-HTTP path the gateway exploits, with no residual bypass (security agent
conclusion), proven by the real-pgvector integration GOAL TEST (positive + negative
controls) and the durable structural regression guard.

## HIGH findings (both FIXED in-cycle)

### F-arch-1 — verify-only verifier delegated instead of fail-closed (architecture)
An interim commit let a verify-only verifier on the api-keys path DELEGATE (single-tenant
passthrough) instead of REJECT, diverging from plan ADR D3a/EC-2 without an amending ADR or
test. **Fixed `a5e31ba`:** the api-keys path now fail-closes (verify-only → 401), with a
dedicated negative test (`streamable-http-auth.test.ts` test 2b). Coverage Matrix row
restored to true. Not exploitable on the gateway path (production always wires a
`resolvePrincipal`-capable `ApiKeyAuthVerifier`) — the secure choice regardless.

### F-xval-1 — plan-mandated ALS concurrency test was missing (cross-validation)
The T3.1 `#### Concurrency tests` (interleaved tn-A/tn-B dispatches asserting
`AsyncLocalStorage.run` no-bleed) — the declared mitigation of the #1 HIGH risk — was
absent; only an `IncomingMessage`-object isolation test existed. **Fixed `30f14be`:** added
the interleaved-dispatch happens-before test (`handlers.test.ts` — after the awaited
interleaved dispatch, each async context still observes its OWN workspace).

## MEDIUM findings

### F-sec-2 — live-edge cross-tenant transcript not captured (DOCUMENTED CAVEAT)
theo-data invariant 6 ("prove isolation through the real edge") is **partially met**. Proven
live: fail-closed no-cred→401 (edge + listener), `resolvePrincipal`-error→503 (the new
fail-closed path fired live), and B's canary written via MCP landed in the bound workspace
`tn-e09…`. NOT captured live: the A→0 / B≥1 cross-tenant recall, **blocked by a dev
bring-up pg mis-alignment unrelated to #82** (`dev/memory-up.sh` container REST →
`localhost:5432` isolated from the host listener's `themem_pgvector`). The isolation
PROPERTY is established by the integration GOAL TEST (identical production code path, real
pgvector, both controls). Evidence + follow-up:
`implementations/mcp-workspace-binding-isolation-live-e2e-2026-06-30.md`. **Accepted as a
documented caveat** (the property is proven; the real-edge transcript is an env-fix
follow-up tracked alongside #83).

### F-sec-1 — OIDC/`auth=both` path serves default workspace, not fail-closed (DOCUMENTED)
Out of #82's reach (the gateway uses `theo_live_*` keys, not OIDC). Consistent with the
REST surface (REST `OidcAuthVerifier` likewise does not resolve a workspace; REST gates the
reject on its `requireCredential` flag, which MCP lacks). Per plan ADR D4, OIDC multi-tenant
workspace mapping is explicitly deferred. Documented caveat; follow-up issue tracks it.

### F-xval-2 — "12-verb isolation" over-claim (FIXED)
All 12 sites are structurally wrapped (grep-verified), but only 3 verbs had per-verb tests
and the impl summary over-claimed "12-verb". **Fixed `30f14be`:** corrected the wording to
"12 sites wrapped (grep-verified) + 3 representative verbs + ALS + fail-closed asserted".

### F-xval-3 — fail-closed-throw-as-tool-error test missing (FIXED)
**Fixed `30f14be`:** added a test asserting the fail-closed workspace-bind throw is handled
gracefully (surfaces as a thrown `McpError`/-32603 the SDK serializes to a clean error
response, per ADR D6 — never an unhandled rejection that wedges the singleton transport).

### F-tests-1 — "all 12 sites wrapped" was not a regression test (FIXED)
The load-bearing invariant passed only by manual grep; a future handler adding a bare
`deps.memoryFactory()` would re-open #82 with the suite green. **Fixed `<guard commit>`:**
added `workspace-binding-coverage.test.ts` — a structural test that fails if any tool/
openmemory source reaches a memory op via a bare factory without `workspaceScopedMemory`.

## LOW / INFO (documented, accepted)
- F-sec-3 — SSE/openmemory compat transport has no bearerAuth → default passthrough (ADR D4 deferral, localhost dev only).
- F-sec-4 — malformed-Principal `.trim()` could 500 instead of 401 → **hardened `5bdd508`** (`?? ''` guard → 401, EC-1).
- F-sec-5 (positive) — no token/secret in the new logs (`logWarn` logs only the error message).
- F-tests-2/3/4/5 — 3-of-12 per-verb tests (shared-helper-justified); T1.1 round-trip covered transitively; generic-Error helper throw matches ADR D3; EC-1 401 omits the WWW-Authenticate reason assertion. All LOW, accepted.

## Edge-case coverage
EC-1 (blank workspace→401), withWorkspace-absent→throw, backend→503, verify-only→401, ALS
no-bleed, graceful fail-closed throw, integration positive+negative controls — all covered.

## Cross-validation summary
Plan tasks: 7. Fully implemented: T1.1, T1.2, T2.1, T2.2, T4.1. T3.1 fully (after F-xval-1/2/3
fixes). T4.2 partial (live transcript env-blocked, property proven by T4.1) — documented.
No plan drift, no scope creep, no fabricated AC claims.

## Quality gates summary
- contract tests (touched mcp + guard): **75 passed**, 0 type errors.
- integration GOAL TEST (real pgvector): **2 passed**.
- typecheck: **0 errors**. Lint: core file clean (packages/mcp not in the typed-lint config — pre-existing).
- `/code-quality`: repo-wide **FAIL_HARD** is PRE-EXISTING + env-broken (expired allowlist + stale `src/**` paths + D2 monorepo-import miscount = 235) — tracked in **theo-memory#83**, unrelated to this diff. This diff's TS typechecks (0 errors) → 0 real symbol fabrications; the structural guard adds 0 new dead/fabricated symbols.
- Wiring (re-validated): all 4 new public symbols (`workspaceScopedMemory`, `attachWorkspace`, `workspaceFromRequest`, `scopeFromRequest`) have production callers.

## Spawned agents (audit trail)
- `.claude/agents/review-mcp-workspace-binding-isolation-2026-06-30/architecture.md` → findings/architecture.yaml
- `.claude/agents/review-mcp-workspace-binding-isolation-2026-06-30/domain-security.md` → findings/domain-security.yaml
- `.claude/agents/review-mcp-workspace-binding-isolation-2026-06-30/cross-validation.md` → findings/cross-validation.yaml
- `.claude/agents/review-mcp-workspace-binding-isolation-2026-06-30/tests.md` → findings/tests.yaml
- (wiring / domain-auth / domain-memory-layer briefs generated; wiring re-validated deterministically; auth + memory-layer covered by the security + architecture agents + the integration test.)

## Handoff decision
**READY_TO_MERGE.** 0 BLOCKER; both HIGH fixed; MEDIUM fixed or documented (F-sec-2 live-edge
transcript is the single explicit caveat — property proven by integration, transcript is an
env-fix follow-up). On merge: comment the fix + verification on theo-memory#82; the env
follow-up (clean live transcript) tracks alongside #83.
