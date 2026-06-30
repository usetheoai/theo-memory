# Discover Edge Case Review — mcp-workspace-binding-isolation

Date: 2026-06-30
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/mcp-workspace-binding-isolation-plan.md
Research questions analyzed: 6
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: `withWorkspace` is OPTIONAL — silent fallback to UNBOUND memory is the latent leak vector
- **Affected question:** Q6
- **Family:** Interpretation / Technique
- **Scenario:** `Memory.withWorkspace?` is optional (`packages/core/src/domain/memory-store.ts:146`). The REST helper `workspaceBoundMemory` falls back to the UNBOUND `memory` when `withWorkspace === undefined` (`packages/api/src/server/handlers/_body-parsing.ts:32` — `memory.withWorkspace !== undefined ? memory.withWorkspace(workspaceId) : memory`). If `/discover-execute` answers Q6 by simply "mirror REST `workspaceBoundMemory`", the blueprint would inherit this silent-passthrough, which in multi-tenant mode is exactly the leak #82 describes.
- **Impact:** A blueprint that recommends the optional-chaining fallback would design an INCOMPLETE fix — in multi-tenant (`requireCredential`) mode, an impl lacking `withWorkspace` would serve unbound (all-workspace) data instead of failing closed.
- **Suggested fix:** Q6's expected answer MUST mandate **fail-closed when `withWorkspace` is unavailable in multi-tenant mode** (reject, do not passthrough), and confirm the concrete impl the MCP server uses (`LocalMemory.withWorkspace` at `packages/core/src/infrastructure/db/local-memory.ts:81`) actually implements it. Add this as an explicit sub-bullet of Q6's expected-answer shape.

### EC-2: Q6 must confirm the MCP receives a `resolvePrincipal`-capable verifier (not boolean-only)
- **Affected question:** Q6
- **Family:** Interpretation / Technique
- **Scenario:** `BearerAuthOptions.apiKey` is typed `AuthVerifier` (`packages/mcp/src/auth/with-bearer-auth.ts:40`), and `AuthVerifier.resolvePrincipal?` is OPTIONAL (`packages/core/src/domain/dip/auth-verifier.ts:60`). The fix depends on the MCP actually being handed an `ApiKeyAuthVerifier` that IMPLEMENTS `resolvePrincipal` (it does for REST), AND on a fail-closed branch when a verify-only verifier is supplied in multi-tenant mode (mirroring `middleware.ts:116` `resolvePrincipalFrom(..., requireCredential)` → `return null`).
- **Impact:** Without this, the blueprint could recommend `resolvePrincipal` without specifying the fail-closed fallback for a boolean-only verifier — re-introducing the "validate boolean, serve shared memory" gap under a different shape.
- **Suggested fix:** Q6's expected answer MUST include the verifier-capability contract: prefer `resolvePrincipal`; in multi-tenant mode a verify-only verifier → reject (no DEFAULT_PRINCIPAL collapse), citing `packages/api/src/server/auth/middleware.ts:105-118` as the reference branch.

## SHOULD TEST

### EC-3: Letta OSS auth may be stubbed/disabled — credential→actor mapping may be a default
- **Affected question:** Q1
- **Suggested halt-loop checkpoint:** When reading `letta/letta/server/rest_api/auth/index.py` + `auth_token.py`, if the credential validation is a no-op/default in OSS, capture the **injection SHAPE** (the `Depends(...)` mechanism that threads the actor into handlers) rather than the credential-validation logic — the injection mechanism is what we mirror, not Letta's (possibly stubbed) auth.

### EC-4: mem0 per-request scoping may live in `storage.py`/`_build_filters`, not only `main.py`
- **Affected question:** Q2
- **Suggested halt-loop checkpoint:** If `mem0/mem0/memory/main.py` Fase A finds the `add`/`search` signatures but not where the tenant filter reaches the store, fall back to `grep _build_filters\|effective_filters mem0/mem0/memory/storage.py` before marking Q2 done.

### EC-5: mem0 `Makefile` may be absent — tools corner needs a fallback
- **Affected question:** Q5
- **Suggested halt-loop checkpoint:** If `mem0/Makefile` is absent, read `mem0/pyproject.toml` `[tool.*]`/`test` config + the `test_server_auth.py` module header for the run command instead.

## DOCUMENT

### EC-6: References test isolation at DIFFERENT layers than OUR e2e (manager/HTTP vs ForwardAuth edge)
- **Accepted risk:** `letta/tests/managers/test_organization_manager.py` tests the DB-manager layer; `mem0/tests/test_server_auth.py` tests the HTTP server auth. Neither tests a ForwardAuth-gateway edge like our `make e2e-edge`. This is fine — they corroborate the *technique* (isolation + auth-deny assertions) at their layer; OUR e2e proof (A's key 0-results B's workspace through the real gateway) is the implement-phase obligation, not a reference's. No plan change; the blueprint will note the layer difference honestly.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 0 | 1 | 0 |
| Q2 | 1 | 0 | 1 | 0 |
| Q3 | 1 | 0 | 0 | 1 |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 1 | 0 | 1 | 0 |
| Q6 | 2 | 2 | 0 | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (2 MUST FIX absorbed into Q6 — see v1.1)
