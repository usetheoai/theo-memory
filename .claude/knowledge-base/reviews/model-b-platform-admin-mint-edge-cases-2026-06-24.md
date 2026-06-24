# Edge Case Review — model-b-platform-admin-mint

Date: 2026-06-24
Tasks analyzed: 6 (T0.1, T1.1, T1.2, T1.3, T2.1, T3.1)
Edge cases found: 8 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 3)

## MUST FIX

### EC-1: `workspace_id` target identifier is not validated (length/charset)
- **Affected task:** T1.2
- **Family:** Input / Format
- **Scenario:** A platform-admin POST supplies `workspace_id` = a 10k-char string, or one with whitespace/control chars. It is parameterized (no SQLi) but auto-provision will `INSERT` an unbounded/garbage `workspaces` row that is then a permanent FK parent.
- **Impact:** Garbage tenant rows; unbounded text; inconsistent with the cloud `tn-{16hex}` shape.
- **Suggested fix:** Validate `^[A-Za-z0-9_-]{1,64}$` before provisioning; else `400 INVALID_WORKSPACE_ID`.

### EC-2: caller scope resolution must read `scopes` inside the existing fail-closed guard
- **Affected task:** T1.2
- **Family:** Permission / Resource
- **Scenario:** The targeting authorization needs the caller's `scopes`. The current caller-resolution SELECT (`admin-keys.ts:241-247`) returns only `workspace_id, role` inside a try/catch that returns 503 on PG error. If the scopes read is added OUTSIDE that guard (a second query), a PG failure there could throw unguarded, or worse, a code path could fall through without the platform-admin check.
- **Impact:** Potential bypass of the targeting authorization on backend failure (fail-open).
- **Suggested fix:** Add `k.scopes` to the SAME guarded SELECT; on throw return 503; evaluate `scopeSatisfies(callerScopes,'memory:platform-admin')` only after a successful resolution (bootstrap path = implicit platform-admin).

## SHOULD TEST

### EC-3: bootstrap-token mint WITH a `workspace_id` target
- **Affected task:** T1.2
- **Suggested test:** `test_bootstrap_mint_with_target_workspace_provisions()` — bootstrap is implicit platform-admin (it bootstraps the first key, possibly the gateway platform key); assert a bootstrap POST with `workspace_id=ws-X` → 200 + ws-X provisioned + key bound. (This is how the gateway's first platform key can itself provision.)

### EC-4: `THEMEMORY_REQUIRE_CREDENTIAL` env truthiness parsing
- **Affected task:** T2.1
- **Suggested test:** `test_require_credential_env_parsing()` — only `"true"`/`"1"` enable; `"false"`, `""`, whitespace-only, unset → disabled (legacy default). Mirrors the existing `readApiKey` empty/whitespace discipline (EC-1 of standalone-p0).

### EC-5: platform-admin key passes `memory:admin`-gated list/rotate/revoke (scopeSatisfies side effect)
- **Affected task:** T1.1
- **Suggested test:** `test_platform_admin_satisfies_admin_routes()` — assert the implication is intentional and the gateway's platform key can rotate/revoke the per-tenant keys it minted (needed for the rotation invariant). Guards against an accidental over-broadening being a surprise.

## DOCUMENT

### EC-6: auto-provisioned workspace `name` = `id`
- **Accepted risk:** No friendly name and no workspace-rename API exist. The auto-provision sets `name = workspace_id`. The cloud/gateway owns display naming; acceptable for the data boundary. (If a rename API is later needed it is a separate slice.)

### EC-7: admin list/rotate/revoke operate at deployment-level `ADMIN_SUBJECT`, not per-workspace
- **Accepted risk:** The existing admin handlers key off a constant `ADMIN_SUBJECT` + `tenant_id='self'`, not workspace. The gateway therefore manages the lifecycle of the keys IT minted by tracking their ids (Slice 2). Per-workspace admin delegation remains out of scope (dossier defers it). No change needed for Model B (the gateway knows the ids it minted).

### EC-8: platform-admin mint WITHOUT `workspace_id` binds to the platform key's OWN workspace
- **Accepted risk:** Documented behavior (omitted target → caller-workspace, unchanged). The gateway ALWAYS supplies an explicit `workspace_id` per tenant, so this path is not used by the gateway; preserved only for backward compat.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 | 0 |
| T1.2 | 5 | 2 | 1 | 2 |
| T2.1 | 1 | 0 | 1 | 0 |
| T1.3/T3.1 | 1 | 0 | 0 | 1 |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 + EC-2 as sub-steps in T1.2; add EC-3/EC-4/EC-5 tests; record EC-6/EC-7/EC-8 as notes. Bump plan to v1.1.
