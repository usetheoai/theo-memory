# Edge Case Review — mcp-workspace-binding-isolation (plan)

Date: 2026-06-30
Tasks analyzed: 6 (T1.1, T1.2, T2.1, T2.2, T3.1, T4.1, T4.2)
Cases found: 5 (EDGE: 1, NEGATIVE: 4 | MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: empty/blank `workspaceId` from `resolvePrincipal` silently passes through to UNBOUND memory (leak)
- **Affected task:** T2.1 (+ interaction with T1.2)
- **Kind:** NEGATIVE (invalid/malformed resolved Principal)
- **Family:** State / Permission
- **Scenario:** `workspaceScopedMemory` (T1.2) treats an empty/whitespace `workspaceId` as the single-tenant default → returns the UNBOUND memory (passthrough). That rule is correct for the **auth=none** path (no Principal). But on the **api-keys** path, a resolved Principal whose `workspaceId` is `""`/blank (a malformed `theo_api_keys` row, a bug in key minting, or a NULL `workspace_id`) would reach the passthrough rule and serve **all-workspace** (unbound) data — the exact #82 leak, re-introduced through a different door.
- **Impact:** CRITICAL — defeats the entire fix for any key with a blank workspace; the passthrough-on-empty rule (safe for single-tenant) is unsafe once auth has resolved a Principal.
- **Suggested fix:** In T2.1, after `resolvePrincipal`, **reject (401) when `principal.workspaceId` is empty/whitespace** — fail closed at the trusted boundary, so a blank workspace NEVER reaches the helper's passthrough rule. Add a negative-case test: `resolvePrincipal → {workspaceId:''} → 401, no delegate`.

## SHOULD TEST

### EC-2: the fail-closed throw (T1.2) must surface as a typed MCP tool error, not crash the dispatch/server
- **Affected task:** T3.1
- **Kind:** NEGATIVE (failure mid-dispatch)
- **Suggested test:** `test_dispatch_workspace_bind_failure_returns_tool_error` — when `workspaceScopedMemory` throws (workspaceId set, `withWorkspace` undefined), the tool dispatch returns a `{ isError: true }` CallToolResult (sanitized message), NOT an unhandled rejection that wedges the singleton transport. Assert the specific error shape, not just "it throws".

### EC-3: ALS scope absent on the stdio path — helper precondition
- **Affected task:** T1.2
- **Kind:** NEGATIVE (missing ambient scope)
- **Suggested test:** `test_workspaceScopedMemory_outside_scope_throws_MissingScopeError` — `workspaceScopedMemory` calls `getScope()`, which throws `MissingScopeError` outside any `withScope`. This matches the EXISTING precondition (every handler already calls `getScope()`), so it is not a regression — but lock it with a test so the helper's scope-dependency is explicit. (EDGE companion: inside a `withScope` with no `workspaceId`, returns memory unchanged — already in T1.2.)

## DOCUMENT

### EC-4: OIDC / `auth=both` path attaches no workspace → handlers passthrough to the default workspace
- **Kind:** NEGATIVE (multi-tenant via OIDC)
- **Accepted risk:** Per ADR D4, OIDC→workspace mapping is deferred (OIDC introspection returns a subject, not a workspace; no per-tenant key). On the OIDC branch, `withBearerAuth` attaches no workspace → ctx has no `workspaceId` → `workspaceScopedMemory` passthrough → default workspace. This is SAFE for a single-tenant OIDC deployment but would be a leak in a multi-tenant OIDC deployment. The gateway path (#82) uses `theo_live_*` api-keys, NOT OIDC, so this is out of #82's scope. **Action:** the T4.2 follow-up issue MUST explicitly name "OIDC/`auth=both` multi-tenant workspace resolution" as deferred + unsupported-until-implemented, and the plan should add a guard note that OIDC multi-tenant is not yet safe.

### EC-5: e2e sequential probes need a listener restart (stateful singleton transport)
- **Kind:** EDGE (test harness operational)
- **Accepted risk:** The native streamable-HTTP transport is a STATEFUL singleton (`sessionIdGenerator` per initialize); sequential single-connection probes hit "Server already initialized -32600" unless the host listener is restarted between them (known from the #82 investigation runs). **Action:** note in T4.2 that the live GW-ISO probe restarts the host MCP listener between tenant-A and tenant-B connections.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 1 | 0 | 1 | 0 |
| T2.1 | 0 | 1 | 1 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 1 | 0 | 1 | 0 |
| T4.1 | 0 | 0 | 0 | 0 | 0 |
| T4.2 | 1 | 1 | 0 | 0 | 2 |

**Coverage check:** every task touching the auth/store boundary has an EDGE and a NEGATIVE lens considered. The load-bearing finding is EC-1 (blank workspace passthrough) — a single missing guard that would silently re-open #82.

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX absorbed into T2.1 → plan v1.1; 2 SHOULD TEST added to T3.1/T1.2 TDD; 2 DOCUMENT notes into T4.2)
