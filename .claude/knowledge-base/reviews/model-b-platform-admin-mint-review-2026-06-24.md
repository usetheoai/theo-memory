# /review — model-b-platform-admin-mint (theo-memory slice 1)

**Date:** 2026-06-24
**Slice:** `develop~5..develop` (5 commits) — Model B provider half: platform-admin workspace-targeted key minting + fail-closed multi-tenant mode.
**Method:** 3 independent specialist agents in parallel (architecture+auth-domain, security/confused-deputy, tests+wiring+cross-validation), consolidated by severity, then a focused security RE-review after fixes.

## Verdict trail

| Round | Verdict | Drivers |
|---|---|---|
| Round 1 (3 agents) | **NEEDS_FIXES** | 1 BLOCKER + 4 HIGH + 2 MEDIUM |
| Fixes applied | — | commit `1c40291` (+ test additions) |
| Round 2 (security re-review, adversarial) | **READY_TO_MERGE** | BLOCKER closed, no bypass found |

## Findings + resolution

| Sev | Finding | Resolution |
|---|---|---|
| **BLOCKER** | Mint-scope escalation: minted `body.scopes` not bounded by caller scopes → a `memory:admin` key could self-mint `memory:platform-admin` (omitting `workspace_id` dodged the only caller-scope gate), then target arbitrary workspaces — re-opening CWE-441. | `PRIVILEGED_MINT_SCOPES` guard: minting `memory:platform-admin` requires `scopeSatisfies(callerScopes, …)` → 403 `INSUFFICIENT_SCOPE_FOR_MINT`, before any INSERT, on every path. 3 unit tests (deny/allow/base-lifecycle). Re-review traced all vectors (omitted ws_id, bootstrap, dedupe, case, user_id) → no bypass. |
| **HIGH** | Cross-workspace isolation test side-loaded keys (raw INSERT), not proving the mint→bind→isolate chain. | Rewrote as END-TO-END: recall driven through `.secret` returned by a real `mint()` HTTP call; tn-x recall empty, tn-y recall non-empty. |
| **HIGH** | Only read verbs covered cross-workspace; mutating verbs unverified. | Added scoped-forget cross-workspace → 404 + row still present in owner ws. |
| **HIGH** | EC-3 (bootstrap+target) untested though plan-mandated. | Added integration test: bootstrap-token POST with `workspace_id` → provisions + binds. |
| **HIGH** | EC-5 (platform-admin passes admin route via requireScope) only proven at the pure-helper level. | Added integration test: platform key → `GET /v1/admin/keys/list` → 200 (not 403). |
| **MEDIUM** | Rotate defaulted NULL `workspace_id` to `'default'` (fail-open cross-misplacement). | Fails closed (500) on missing `workspace_id`; no `'default'` fallback. |
| **MEDIUM** | Targeting gate coupling. | Subsumed by the BLOCKER fix. |
| LOW | Non-tx two-statement auto-provision; rotate symmetry; ws quota. | Accepted (ADR D3 documented trade-off; idempotent ON CONFLICT). |
| INFO | Fail-closed mode correct on all paths; bootstrap-as-platform-admin sound; no secrets logged; SOLID/DIP clean; AuthVerifier DIP untouched; locked decisions honored. | — |

## Validation evidence (post-fix)

- Contract suite (root `pnpm test`): **1227 passed / 2 skipped, 0 type errors**.
- `packages/api` suite: **247 passed**.
- Auth integration vs real `ankane/pgvector:v0.5.1` (`THEOMEM_PG_URI`): **40 passed** (incl. 6 Model B scenarios).
- Lint clean; `pnpm test:type` clean.
- Code-quality: no dead code / orphan export / fabricated symbol on the changed surface (every new export has a production caller).

## Wiring triad

- (a) callers: `scopeSatisfies` ← scope-verifier + admin-keys; `parseRequireCredentialEnv` ← run-server; `requireCredential` ← app + run-server; targeting + mint-guard ← createKeyHandler (mounted in app.ts). ✓
- (b) integration: provision + cross-workspace isolation + forget + EC-3 + EC-5 exercised vs real pgvector. ✓
- (c) the cross-workspace invariant is an integration test, not a unit stub. ✓

## Verdict: **READY_TO_MERGE**

Zero BLOCKER/HIGH remaining. The confused-deputy (CWE-441) is closed at the provider with correctly-scoped, fail-closed guards and meaningful regression tests. This slice is the dependency for Model B slice 2 (theo-cloud gateway credential broker).
