# Plan: Model B Slice 1 — Platform-admin workspace-targeted key minting (theo-memory)

> **Version 1.1** — Add a platform-level admin capability so the theo-cloud gateway can mint a `theo_live_*` key bound to an arbitrary target workspace (one workspace per cloud tenant), plus an opt-in fail-closed multi-tenant auth mode. This is the provider half of Model B — the dependency the gateway's credential-broker is built on. It closes blockers B1 (mint binds to caller's workspace only) and B3 (no-credential fail-open) found in the discovery dossier, without any schema migration.
>
> **v1.1 (2026-06-24)** — absorbed edge-case review `model-b-platform-admin-mint-edge-cases-2026-06-24.md`: EC-1 (validate `workspace_id` identifier) + EC-2 (read caller scopes inside the fail-closed guard) added as T1.2 sub-steps; EC-3/EC-4/EC-5 added as tests; EC-6/EC-7/EC-8 recorded as accepted risks.

## Goal

> "Enable a `memory:platform-admin` credential to mint a `theo_live_*` key bound to an arbitrary target `workspace_id` (auto-provisioning the workspace) so that the theo-cloud gateway can issue per-tenant downstream credentials, measured by the new integration test `admin-keys-platform.integration.test.ts` passing 100% (incl. the cross-workspace 403 + auto-provision idempotency cases)."

## Context

The theo-cloud gateway authenticates to theo-memory with a single master key authorized for every tenant, isolating tenants only by injecting the subject into the URL path — a confused deputy (CWE-441). The owner approved Model B (2026-06-24): per-tenant downstream credentials, provider-enforced isolation. The discovery dossier (`.claude/knowledge-base/discoveries/model-b-platform-admin-mint-dossier.md`) found workspace isolation is already GA on every memory verb, but the gateway cannot leverage it because `POST /v1/admin/keys` binds every minted key to the **caller's** workspace (B1), and a no-credential deployment silently collapses to a shared `default`-owner workspace (B3). This plan adds the missing platform-admin minting path + a fail-closed mode. Decision locked with the owner: **workspace = cloud TenantID**.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/api/src/server/handlers/admin-keys.ts` | 611 | `df917f8` (2026-06-17) | The `theo_api_keys` Stripe-shape lifecycle handlers (`createKeyHandler` etc.) | RBAC anti-escalation guard (`:259-293`); caller-workspace binding when no target given; bootstrap atomic-tx (`:300-345`); existing T2.1 unit tests stay green |
| `packages/api/src/server/auth/scope-verifier.ts` | 153 | `df917f8` (2026-06-17) | `requireScope()` middleware gating `/v1/admin/keys/*` | Fail-closed-on-DB-error 503 (`:120-126`); WWW-Authenticate on 401; bootstrap bypass |
| `packages/api/src/server/auth/middleware.ts` | 153 | `757b068` (2026-06-17) | `bearerAuth()` Principal resolution + `DEFAULT_PRINCIPAL` fallback | Token-present-but-invalid → 401 (never default); 503 fail-closed on backend error; single-tenant dev unchanged when flag off |
| `packages/api/src/server/app.ts` | (wiring) | `df917f8` (2026-06-17) | `createServer()` mounts admin routes under `requireScope({requiredScope:'memory:admin'})` (`:298-327`) | `adminApi`-omitted → routes NOT mounted; member routes wiring |
| `tests/integration/auth/admin-keys-platform.test.ts` (NEW) | 0 | — | (integration test for targeted mint vs real pgvector) | — |
| `packages/api/src/server/auth/__tests__/middleware-fail-closed.test.ts` (NEW) | 0 | — | (unit test for multi-tenant fail-closed mode) | — |

No migration file is touched — see ADR D5.

### Current callers / dependents

- **Symbol:** `createKeyHandler()` — `packages/api/src/server/handlers/admin-keys.ts:155`
  - Callers (production): `packages/api/src/server/app.ts:316`
  - Callers (tests): `packages/api/src/server/handlers/__tests__/admin-keys.test.ts`, `packages/api/src/server/__tests__/admin-wiring.test.ts`
  - External (other repos): the **theo-cloud gateway** will call the REST endpoint `POST /v1/admin/keys` over HTTP (Slice 2) — wire contract, not a Go import.
- **Symbol:** `requireScope()` — `packages/api/src/server/auth/scope-verifier.ts`
  - Callers (production): `packages/api/src/server/app.ts:302`
  - Callers (tests): `packages/api/src/server/auth/__tests__/scope-verifier.test.ts`
- **Symbol:** `DEFAULT_PRINCIPAL` / `bearerAuth()` / `getPrincipal()` — `packages/api/src/server/auth/middleware.ts`
  - Callers (production): `packages/api/src/server/app.ts` (bearerAuth mount), every handler via `getPrincipal`/`workspaceBoundMemory` (`handlers/_body-parsing.ts:30`, `entities.ts:77`, `graph.ts:53`, `metrics.ts:89`)
  - Callers (tests): handler unit tests rely on the `getPrincipal` default when hitting handlers directly — **must stay working** (flag defaults off).
- **Symbol:** `VALID_SCOPES` constant — `admin-keys.ts:?` (set `memory:read|write|delete|admin`); also `bffScopesJSON` in cloud (out of scope here).

### Domain glossary

- **workspace** — the multi-tenant isolation anchor in theo-memory (`workspaces.id`, migration `0016`); every memory row carries `workspace_id`; queries scope by `principal.workspaceId`. Per the locked decision, one workspace == one cloud tenant.
- **Principal** — `{ workspaceId, userId, role, scopes }` resolved from the credential (`packages/core/src/domain/principal.ts:67`); the workspace ALWAYS comes from the credential, never the request body.
- **scope** — a coarse capability string on a key (`memory:read|write|delete|admin`); gating is by `requireScope` for admin routes and `requireRole` for management routes.
- **caller-workspace binding** — current mint behavior: the new key inherits the minting caller's `workspace_id` (`admin-keys.ts:227-257`).
- **bootstrap token** — env-sourced one-time token (`THEMORY_ADMIN_BOOTSTRAP_TOKEN`) that bootstraps the first admin key; self-revokes (ADR-0014 EC-3).

### Architecture boundaries affected

- `rules/architecture.md §3 (Dependency direction / DIP)` — auth + handlers live in `packages/api/src/server/`, off the `src/core/` DIP-clean path. The `AuthVerifier` DIP (`packages/core/src/domain/dip/auth-verifier.ts`) is NOT changed (no new method); `resolvePrincipal` already exists.
- `rules/architecture.md §9 (Public API surface)` — a new scope literal `memory:platform-admin` is an additive public surface change (pre-release, acceptable); the `createServer({ requireCredential })` option is additive.

## Prior Art & Related Work

- **Internal dossier** — `.claude/knowledge-base/discoveries/model-b-platform-admin-mint-dossier.md` §"The three blockers (B1–B3)" + §"Scope of THIS slice".
- **Internal precedent** — the existing caller-workspace binding + RBAC anti-escalation (`admin-keys.ts:227-293`, shipped in `multi-tenant-rbac-and-slice1-completion`, review `READY_TO_MERGE` 2026-06-18) is the pattern this plan extends; the `'default'` workspace seed `INSERT ... ON CONFLICT DO NOTHING` (migration `0016`) is the exact idempotent auto-provision pattern reused at runtime.
- **AWS SaaS Lens — Tenant Isolation** (https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html) — per-tenant scoped credentials; isolation ≠ authorization.
- **AWS IAM confused-deputy / ExternalId** (https://docs.aws.amazon.com/IAM/latest/UserGuide/confused-deputy.html) — provider MUST validate it actually rejects cross-tenant access → the mandatory cross-workspace 403 negative test.
- **CWE-441** (https://cwe.mitre.org/data/definitions/441.html) — the vulnerability class being closed.
- **NIST SP 800-53 AC-5 / AC-6** (https://csf.tools/reference/nist-sp-800-53/r5/ac/ac-6/) — separation of duties + least privilege → platform-admin scope distinct from data scopes.

## Objective

- [ ] Add `memory:platform-admin` scope to `VALID_SCOPES` with a scope-implication helper (`platform-admin ⊇ admin`).
- [ ] `POST /v1/admin/keys` accepts optional `workspace_id`; when present requires platform-admin and binds the new key to it.
- [ ] Targeted mint idempotently auto-provisions the `workspaces` row (`INSERT ... ON CONFLICT DO NOTHING`) inside the mint tx.
- [ ] A `memory:admin` (non-platform) caller supplying a foreign `workspace_id` is rejected 403 (no privilege escalation).
- [ ] Cross-workspace access with a key bound to workspace A against workspace B returns 404 (verified end-to-end — provider-enforced isolation).
- [ ] Opt-in `requireCredential` (multi-tenant) mode: no-credential boot/request fails closed (no `DEFAULT_PRINCIPAL`); verify-only verifier → 401.
- [ ] No schema migration; existing tests stay green; coverage ≥ project gate.

## ADRs

### D1 — New `memory:platform-admin` scope (not overloading `memory:admin`)
- Decision: introduce a distinct scope that alone may target an arbitrary `workspace_id`.
- Rationale: least privilege + separation of duties (NIST AC-5/AC-6). A deployment-level `memory:admin` must NOT be able to cross workspace boundaries; only the gateway's platform credential may.
- Alternatives: (a) overload `memory:admin` — REJECTED: any workspace admin could mint into other workspaces (privilege escalation). (b) separate admin microservice — REJECTED: YAGNI; the lifecycle already lives in `admin-keys.ts` (ADR-0014).
- Consequences: enables per-tenant provisioning by a single platform credential; adds one public scope literal.

### D2 — Scope implication `platform-admin ⊇ admin` (route gate unchanged)
- Decision: a `memory:platform-admin` key satisfies a `memory:admin` route requirement; the targeting restriction is enforced *inside* `createKeyHandler` only when `workspace_id` is supplied.
- Rationale: keeps `requireScope` SRP-simple (single required scope), mirrors the `roleSatisfies` hierarchy precedent (`principal.ts:55`). KISS.
- Alternatives: add `requiredAnyOf: string[]` to `requireScope` — REJECTED: widens the middleware surface (ISP) for no gain; implication is simpler and matches existing role hierarchy.
- Consequences: the admin route stays gated on `memory:admin`; platform keys pass; handler owns the targeting authorization.

### D3 — workspace = cloud TenantID; targeted mint auto-provisions the workspace idempotently in the mint tx
- Decision: when `workspace_id` is supplied, upsert the `workspaces` row (`ON CONFLICT DO NOTHING`) before/at the INSERT, in the same connection/tx.
- Rationale: the gateway has one HTTP call per tenant onboarding; coupling provision+mint avoids a two-call race and matches the migration-0016 seed pattern. Grounded in AWS "one identity boundary per tenant".
- Alternatives: separate `POST /v1/admin/workspaces` first — REJECTED: extra round-trip + ordering race for the gateway; can be added later if a standalone workspace API is needed.
- Consequences: mint path now also creates tenants; idempotent + tx-safe.

### D4 — Fail-closed multi-tenant mode is an explicit opt-in (`requireCredential`), default off
- Decision: add a `createServer({ requireCredential: true })` flag (env `THEMEMORY_REQUIRE_CREDENTIAL`) that (a) refuses the no-verifier `DEFAULT_PRINCIPAL` path and (b) disables the verify-only → `DEFAULT_PRINCIPAL` shim — both become 401/boot-refusal.
- Rationale: single-tenant OSS dev/CI relies on the no-key default; flipping it unconditionally is a breaking change. Opt-in preserves backward compat while letting the gateway deployment run fail-closed (defense-in-depth, the second-highest-leverage Model B invariant).
- Alternatives: (a) always fail-closed — REJECTED: breaks existing no-key dev/CI + handler unit tests. (b) infer multi-tenant from >1 workspace row — REJECTED: implicit/fragile, races onboarding.
- Consequences: the gateway sets the flag; a misconfigured gateway fails closed instead of collapsing to a shared owner workspace.

### D5 — No schema migration
- Decision: reuse the existing `workspaces` table + FK + the non-unique `workspace_id` on `theo_api_keys`.
- Rationale: migration `0016` already created `workspaces`, the FK, and `theo_api_keys.workspace_id`; only `key_hash` is UNIQUE, so ≥2 active keys per workspace already work (rotation precondition satisfied). Adding nothing = less risk (KISS/YAGNI).
- Alternatives: add a `UNIQUE`/partial index per workspace — REJECTED: would break zero-downtime rotation (needs ≥2 concurrently-active keys per workspace, per the prior-art rotation requirement).
- Consequences: zero migration risk; rotation supported as-is.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `memory:platform-admin` is a very powerful scope (mint into ANY workspace) | High | Only the gateway's bootstrap-provisioned platform key carries it; audit-log every targeted mint with `{workspace_id, platform=true}`; never expose it to data-plane | Platform |
| Coupling key-mint to workspace creation in the mint path | Medium | Idempotent `ON CONFLICT DO NOTHING` inside the pinned-connection tx; concurrency test for double-provision | Provider |
| `requireCredential` is opt-in → a gateway that forgets the flag stays fail-open | Medium | Slice-2 deployment template sets `THEMEMORY_REQUIRE_CREDENTIAL=true`; documented; candidate to flip default-on in a future major | Ops |
| New public scope literal is a pre-release surface addition | Low | Documented in CHANGELOG `[Unreleased] § Added`; additive only | Provider |

## Unresolved Questions

- Q1 — Does the gateway's per-tenant key need a `workspace_users` owner membership row, or is an **unbound** key (role=member via default-deny) sufficient? **Resolved at plan time:** the data path uses only `memory:read|write|delete` scopes, which do not require a role ≥ member; management routes (`requireRole`) are not on the gateway data path. So the gateway mints an **unbound** per-workspace key (no `user_id`) — no membership row needed. (Documented; `/edge-case-plan` may challenge.)
- Q2 — Is there an existing OTel audit-event channel to emit `admin_key_minted{workspace_id, platform}`? To confirm against `emitEvent` usage during `/implement`; if absent, emit a structured `slog`/console audit line (never the secret).
- Q3 — `(none further — every other decision is resolved at plan time)`

**Accepted risks recorded from the edge-case review (no action — documented):**
- EC-6 — auto-provisioned workspace `name` = `id` (no friendly-name / rename API). The cloud owns display naming; acceptable at the data boundary.
- EC-7 — admin `list`/`rotate`/`revoke` operate at deployment-level `ADMIN_SUBJECT` (not per-workspace). The gateway manages its minted keys by tracking their ids (Slice 2). Per-workspace admin delegation stays out of scope.
- EC-8 — platform-admin mint WITHOUT `workspace_id` binds to the platform key's own workspace (unchanged backward-compat path); the gateway always supplies an explicit `workspace_id`, so it never uses this path.

## Failure scenarios

`POST /v1/admin/keys` touches Postgres (the only external I/O here):
- **Auth-backend (PG) down during caller-workspace/role resolution** → handler already returns 503 SERVICE_UNAVAILABLE (`admin-keys.ts:248-251`); the new targeting branch MUST preserve this (fail closed, never proceed with a default workspace). Test reproduces via a stub pool that throws on the caller-resolution SELECT.
- **Unique violation on INSERT (id/hash collision)** → 500 INTERNAL via `isUniqueViolation` (existing). New auto-provision INSERT uses `ON CONFLICT DO NOTHING` so a concurrent workspace insert does NOT raise. Test reproduces via a stub returning conflict on the workspaces insert (asserts mint still succeeds).
- **FK violation (workspace_id absent)** → impossible after auto-provision in the same tx; test asserts the workspaces row exists before the key INSERT.

## Dependency Graph

```
Phase 0 (RED tests) ──▶ Phase 1 (B1: platform-admin + targeted mint) ──▶ Phase 3 (Integration Validation)
                    │                                                   ▲
                    └──▶ Phase 2 (B3: fail-closed multi-tenant mode) ───┘
Phase 1 and Phase 2 are independent (different files: admin-keys+scope vs middleware) and MAY proceed in parallel after Phase 0.
```

---

## Phase 0: RED scaffolding

**Objective:** write the failing tests that define done, before any implementation.

### T0.1 — RED tests for targeted mint + scope implication + fail-closed

#### Objective
Author the failing unit + integration tests that pin the new behavior.

#### Why this step
1. **What:** create `admin-keys-platform.integration.test.ts` (targeted mint, cross-workspace 403, auto-provision idempotency, foreign-workspace escalation 403) and `middleware-fail-closed.test.ts` (no-credential 401, verify-only → 401).
2. **Why now:** `testing.md §TDD` mandates RED before GREEN; these tests are the Goal's named metric. Writing them first prevents implementing the wrong shape.

#### Evidence
`rules/testing.md §TDD — Red-Green-Refactor`; integration runner `vitest.integration.config.ts` (real `ankane/pgvector:v0.5.1`); existing pattern `handlers/__tests__/admin-keys.test.ts`.

#### Files to edit
```
tests/integration/auth/admin-keys-platform.test.ts — NEW (RED)
packages/api/src/server/auth/__tests__/middleware-fail-closed.test.ts — NEW (RED)
```

#### TDD
```
RED: platform_admin_mints_into_arbitrary_workspace_auto_provisioning() — POST with workspace_id=ws-X by a platform-admin key → 200; workspaces row ws-X exists; key row workspace_id=ws-X
RED: memory_admin_supplying_foreign_workspace_id_is_rejected_403()
RED: omitted_workspace_id_binds_caller_workspace_unchanged()
RED: cross_workspace_key_reads_other_workspace_returns_404() — key bound ws-A used on ws-B scope
RED: auto_provision_is_idempotent_under_concurrency() — 2 concurrent targeted mints same new ws → 1 workspaces row
RED: require_credential_mode_no_key_configured_fails_closed() — bearerAuth with requireCredential + null verifier → 401 (not DEFAULT_PRINCIPAL)
RED: require_credential_mode_verify_only_verifier_rejected_401()
GREEN: (Phases 1-2)
REFACTOR: None expected
VERIFY: pnpm test:integration -- admin-keys-platform ; pnpm test -- middleware-fail-closed
```

#### Concurrency tests
Race-aware: **concurrent test** with an **atomic-counter invariant** — `auto_provision_is_idempotent_under_concurrency()` spawns N concurrent targeted mints for the same new workspace; assert exactly one `workspaces` row and all mints succeed (ON CONFLICT DO NOTHING + tx). This is the race-aware proof for D3.

#### Acceptance criteria
All tests present and FAILING for the right reason (capability absent), not from compile errors.

#### DoD
`pnpm test:integration -- admin-keys-platform` shows RED on the new assertions; committed.

---

## Phase 1: B1 — platform-admin scope + workspace-targeted mint

**Objective:** let a platform-admin credential mint into an arbitrary, auto-provisioned workspace; block escalation.

### T1.1 — Add `memory:platform-admin` scope + implication helper

#### Objective
Register the new scope and a `scopeSatisfies(granted, required)` helper where `memory:platform-admin` implies `memory:admin`.

#### Why this step
1. **What:** add `memory:platform-admin` to `VALID_SCOPES`; add a small pure `scopeImplies`/`scopeSatisfies` helper.
2. **Why now:** D1+D2 — the scope must exist and imply admin before the route gate and handler can reason about it.

#### Evidence
`admin-keys.ts` `VALID_SCOPES` set (`memory:read|write|delete|admin`); `requireScope` checks `scopes.includes(requiredScope)` (`scope-verifier.ts:138`); `roleSatisfies` precedent (`principal.ts:55`).

#### Files to edit
```
packages/api/src/server/handlers/admin-keys.ts — add 'memory:platform-admin' to VALID_SCOPES
packages/api/src/server/auth/scope-verifier.ts — use scopeSatisfies so platform-admin satisfies a memory:admin requirement
packages/api/src/server/auth/scope-verifier.ts (or a new scope-hierarchy.ts) — scopeSatisfies(granted[], required) helper
packages/api/src/server/auth/__tests__/scope-verifier.test.ts — assert platform-admin satisfies memory:admin
```

#### Deep file dependency analysis
- `scope-verifier.ts` `requireScope` currently does `scopes.includes(opts.requiredScope)` — change to `scopeSatisfies(scopes, opts.requiredScope)` so a platform-admin key passes a `memory:admin` gate. Caller `app.ts:302` unchanged (still passes `requiredScope:'memory:admin'`).
- `VALID_SCOPES` in `admin-keys.ts` gates the mint body's scopes; adding the literal lets a key BE minted with platform-admin.

#### TDD
```
RED: platform_admin_satisfies_memory_admin_requirement()
RED: memory_admin_does_not_satisfy_platform_admin_requirement()
RED: platform_admin_passes_admin_gated_list_rotate_revoke() (EC-5 — intended; gateway rotates/revokes its minted keys)
GREEN: add scope literal + scopeSatisfies; wire into requireScope
REFACTOR: extract scope hierarchy next to roleSatisfies if it reads cleaner
VERIFY: pnpm test -- scope-verifier
```

#### Concurrency tests
(none — single-threaded) — pure scope-implication helper, no shared state.

#### Acceptance criteria
`scopeSatisfies(['memory:platform-admin'], 'memory:admin') === true`; reverse false; `requireScope` honors it; no regression in scope-verifier tests.

#### DoD
`pnpm test -- scope-verifier` green; `rg "memory:platform-admin"` shows the literal in VALID_SCOPES.

### T1.2 — `POST /v1/admin/keys` targeted `workspace_id` + auto-provision + escalation guard

#### Objective
Accept optional `workspace_id`; require platform-admin when present; auto-provision the workspace; bind the key to it; reject foreign-workspace targeting by non-platform callers.

#### Why this step
1. **What:** extend `createKeyHandler` body parse + the workspace-resolution block (`admin-keys.ts:227-345`) to honor a target `workspace_id`.
2. **Why now:** this is blocker B1 — the gateway cannot provision per-tenant keys without it. Cites D1/D2/D3.

#### Evidence
`createKeyHandler` resolves `callerWorkspace` and writes it into both INSERTs (`admin-keys.ts:322-324`, `:341-343`); body currently parses `name/scopes/expires_at/user_id` only (`:160-205`); the workspaces seed pattern `INSERT ... ON CONFLICT DO NOTHING` (migration `0016`).

#### Files to edit
```
packages/api/src/server/handlers/admin-keys.ts — parse body.workspace_id; if present: require caller scopes ⊇ memory:platform-admin (else 403 INSUFFICIENT_SCOPE_FOR_TARGET); set targetWorkspace; upsert workspaces row (ON CONFLICT DO NOTHING) in the same connection; bind INSERT workspace_id=targetWorkspace
packages/api/src/server/handlers/__tests__/admin-keys.test.ts — extend with stub-pool cases
```

#### Deep file dependency analysis
- Need the caller's scopes (not just workspace+role). The caller-resolution SELECT (`:241-247`) returns `workspace_id, role` — extend it to also `SELECT k.scopes` so the handler can check platform-admin. (Bootstrap path = implicit platform-admin owner.)
- When `workspace_id` present + caller lacks platform-admin → 403 before any write.
- Auto-provision: in both the bootstrap-tx path and the simple-INSERT path, run `INSERT INTO workspaces (id, name) VALUES ($1,$1) ON CONFLICT (id) DO NOTHING` on the same `q`/pool before the key INSERT. For the tx path it's inside BEGIN/COMMIT (atomic); for the simple path, run it immediately before (FK then satisfied).
- `user_id` binding stays guarded by the existing anti-escalation guard but is evaluated against the **target** workspace's membership when targeting (gateway mints unbound → `user_id` omitted, so guard is skipped — Q1 resolved).

#### Deep Dives
- Invariant: workspace ALWAYS from server-side authorization (caller scope + explicit target), NEVER inferred from an unauthenticated body. A non-platform caller can never set a foreign workspace.
- Edge: `workspace_id` equal to caller's own workspace + platform-admin → allowed (no-op provision). `workspace_id` empty string → 400 INVALID_WORKSPACE_ID.
- Backward compat: omitted `workspace_id` → existing caller-workspace path byte-for-byte unchanged.

#### Pseudo-code / Signatures
```pseudocode
parse body.workspace_id?: string
# EC-2: caller {workspace, role, scopes} resolved in ONE guarded SELECT (adds k.scopes); throw → 503 (fail closed)
resolve caller {workspace, role, scopes} from credential (or bootstrap=owner+platform-admin)
if body.workspace_id present:
  if not scopeSatisfies(caller.scopes, 'memory:platform-admin'): return 403 INSUFFICIENT_SCOPE_FOR_TARGET
  # EC-1: validate identifier shape/length BEFORE provisioning
  if not /^[A-Za-z0-9_-]{1,64}$/.test(body.workspace_id): return 400 INVALID_WORKSPACE_ID
  targetWorkspace = body.workspace_id
else:
  targetWorkspace = caller.workspace
# in the same connection/tx as the key INSERT:
q.query("INSERT INTO workspaces (id,name) VALUES ($1,$1) ON CONFLICT (id) DO NOTHING", [targetWorkspace])
q.query("INSERT INTO theo_api_keys (... workspace_id ...) VALUES (... targetWorkspace ...)")

# Example
input:  Bearer <platform key>, body {name:"gw-tenant-tn123", scopes:["memory:read","memory:write","memory:delete"], workspace_id:"tn-123"}
output: 200 {id, key_prefix, scopes, secret}; workspaces has row tn-123; key.workspace_id=tn-123
```

#### TDD
```
RED: platform_admin_mints_into_new_workspace_auto_provisions() (integration)
RED: memory_admin_foreign_workspace_id_403() (unit, stub pool)
RED: platform_admin_same_workspace_noop_provision_ok()
RED: invalid_workspace_id_charset_or_length_400() (EC-1 — >64 chars / bad charset)
RED: caller_scope_resolution_pg_error_returns_503() (EC-2 — fail closed, no bypass)
RED: bootstrap_mint_with_target_workspace_provisions() (EC-3 — bootstrap = implicit platform-admin)
RED: omitted_workspace_id_unchanged_caller_binding() (regression)
GREEN: implement parse + EC-1 validation + EC-2 single guarded SELECT incl. scopes + scope check + upsert + bind
REFACTOR: factor the workspace-resolution into a small helper if createKeyHandler grows past readability
VERIFY: pnpm test -- admin-keys ; pnpm test:integration -- admin-keys-platform
```

#### Concurrency tests
Race-aware: **concurrent test** (covered by T0.1) — assert a single `workspaces` row (**atomic-counter invariant**) under concurrent targeted mints for the same new workspace (ON CONFLICT DO NOTHING in the pinned-connection tx).

#### Acceptance criteria
Platform-admin targeted mint 200 + workspace auto-provisioned + key bound; non-platform foreign target 403; omitted target unchanged; idempotent provision; DB-error path still 503.

#### DoD
`pnpm test -- admin-keys` + `pnpm test:integration -- admin-keys-platform` green; `admin-keys.ts` ≤ ~700 LoC (budget per `architecture.md §7`; if exceeded, extract helper).

### T1.3 — Cross-workspace isolation negative test (provider-enforced)

#### Objective
Prove a key bound to workspace A cannot read workspace B's data (the invariant Model B relies on).

#### Why this step
1. **What:** end-to-end test: mint key K_A (ws-A) + K_B (ws-B); remember under K_B; recall/list under K_A → does NOT see ws-B data; scoped read of a ws-B memory id under K_A → 404.
2. **Why now:** AWS ExternalId discipline — the provider MUST be proven to reject cross-tenant access; without this test, Model B's defense-in-depth is unverified ("belt with no buckle").

#### Evidence
Workspace scoping is enforced in handlers (`_body-parsing.ts:29-33`, `scoped-forget.ts:52`); cross-workspace → 404 already shipped for forget/reflect (dossier Q3). This test asserts it holds for the read paths the gateway uses, via per-workspace keys.

#### Files to edit
```
tests/integration/auth/admin-keys-platform.test.ts — add the cross-workspace read case
```

#### TDD
```
RED: cross_workspace_key_cannot_read_other_workspace() — remember under K_B; list/recall under K_A excludes it; GET scoped ws-B mem id under K_A → 404
GREEN: (no new prod code expected — proves existing enforcement holds for per-key auth; if it FAILS, that's a real provider gap to fix here)
VERIFY: pnpm test:integration -- admin-keys-platform
```

#### Concurrency tests
(none — single-threaded) — sequential mint-then-read assertion; no shared mutable state exercised.

#### Acceptance criteria
K_A never observes ws-B data; 404 (no existence leak) on cross-workspace scoped read.

#### DoD
Integration test green against real pgvector.

---

## Phase 2: B3 — fail-closed multi-tenant mode

**Objective:** make a no-credential / verify-only deployment fail closed under an explicit opt-in, without breaking single-tenant dev.

### T2.1 — `requireCredential` mode in `bearerAuth` + `createServer`

#### Objective
Add an opt-in that disables the `DEFAULT_PRINCIPAL` fallbacks.

#### Why this step
1. **What:** thread `requireCredential?: boolean` into `bearerAuth(verifier, { requireCredential })` and `createServer`; when true: (a) `hoistedVerifier === null` → per-request 401 `CREDENTIAL_REQUIRED` (or boot refusal); (b) `resolvePrincipalFrom` MUST NOT use the verify-only → `DEFAULT_PRINCIPAL` shim — a verifier without `resolvePrincipal` → 401.
2. **Why now:** B3 — defense-in-depth. The gateway runs theo-memory in this mode so a misconfig fails closed instead of collapsing to a shared owner workspace.

#### Evidence
`middleware.ts:118-124` sets `DEFAULT_PRINCIPAL` when `hoistedVerifier === null`; `resolvePrincipalFrom:96-103` falls back to `DEFAULT_PRINCIPAL` for verify-only verifiers; `getPrincipal` default keeps handler unit tests working (must stay when flag off).

#### Files to edit
```
packages/api/src/server/auth/middleware.ts — add requireCredential option; gate the two fallbacks
packages/api/src/server/app.ts — pass createServer({ requireCredential }) into bearerAuth
packages/api/src/server/auth/__tests__/middleware-fail-closed.test.ts — assert 401 paths
```

#### Deep file dependency analysis
- `bearerAuth` signature gains an options object (keep `verifier?` positional for backward compat; add 2nd arg `{ requireCredential }`). Default false → existing callers unchanged.
- `getPrincipal`'s direct-handler default is untouched (only `bearerAuth`'s request path changes), so handler unit tests stay green.
- OIDC verify-only path: with the flag on, the shim returns 401 (no `DEFAULT_PRINCIPAL`) — closes the OIDC cross-tenant hole noted in the dossier (B3).

#### Pseudo-code / Signatures
```pseudocode
bearerAuth(verifier?, { requireCredential=false } = {}):
  if hoistedVerifier === null:
     if requireCredential: return 401 CREDENTIAL_REQUIRED   # fail closed
     else: set DEFAULT_PRINCIPAL; next()                     # legacy dev
  ...
  resolve: if verifier.resolvePrincipal: principal = resolvePrincipal(token)
           else if requireCredential: return 401             # no shim
           else: principal = verify(token) ? DEFAULT_PRINCIPAL : null
```

#### TDD
```
RED: require_credential_no_verifier_returns_401()
RED: require_credential_verify_only_verifier_returns_401()
RED: require_credential_env_parsing_only_true_or_1_enables() (EC-4 — "false"/""/whitespace → off)
RED: flag_off_preserves_default_principal_single_tenant()  (regression)
GREEN: implement the option + gates + env truthiness parse
REFACTOR: None expected
VERIFY: pnpm test -- middleware-fail-closed ; pnpm test -- middleware
```

#### Concurrency tests
(none — single-threaded) — stateless middleware decision, no shared state.

#### Acceptance criteria
Flag on + no/verify-only credential → 401; flag off → unchanged DEFAULT_PRINCIPAL; all existing middleware + handler tests green.

#### DoD
`pnpm test -- middleware` + `middleware-fail-closed` green.

---

## Phase 3: Integration Validation

**Objective:** the full chain passes — the eat-your-own-cooking gate.

### T3.1 — Full suite + typecheck + lint + coverage + chaos

#### Objective
Prove the slice is green end-to-end against real pgvector.

#### Why this step
1. **What:** run unit + integration + typecheck + lint + coverage; run the failure-scenario (PG-down 503, ON CONFLICT idempotency) cases.
2. **Why now:** `to-plan` Rule 18 — plan is not complete until the full chain passes.

#### Evidence
`vitest.contract.config.ts` (default `pnpm test`), `vitest.integration.config.ts` (real pgvector), `rules/testing.md §Running tests`.

#### Files to edit
```
(no new code) — validation only; CHANGELOG.md [Unreleased] § Added entry for the platform-admin scope + targeted mint + requireCredential mode
```

#### TDD
```
VERIFY: pnpm test
VERIFY: pnpm test:integration
VERIFY: pnpm typecheck && pnpm lint
VERIFY: coverage ≥ project gate (per testing.md)
```

#### Concurrency tests
(none — single-threaded) — validation-only phase; the race-aware proof lives in T0.1/T1.2.

#### Acceptance criteria
All green; CHANGELOG updated; no schema migration added (D5); `admin-keys.ts` within LoC budget.

#### DoD
Clean `pnpm test` + `pnpm test:integration` + `pnpm typecheck` + `pnpm lint`; `/code-quality` then `/review` can start.

## Coverage Matrix

| Requirement / Gap (dossier) | Task(s) |
|---|---|
| B1 — admin mint binds to caller workspace only | T1.1, T1.2 |
| B1 — auto-provision target workspace | T1.2 (D3) |
| B1 — no privilege escalation (memory:admin foreign target) | T1.2 |
| B2 — workspace = TenantID; provider enforces cross-tenant | T1.3 (negative test) |
| B3 — fail-open no-credential / verify-only | T2.1 (D4) |
| Rotation precondition (≥2 active keys/workspace) | D5 (verified: only key_hash unique) |
| Backward compat (single-tenant dev, existing tests) | T1.2, T2.1 regression cases |

## Global DoD

- [ ] All RED tests from T0.1 are GREEN.
- [ ] `pnpm test` + `pnpm test:integration` (real `ankane/pgvector`) pass 100%.
- [ ] `pnpm typecheck` + `pnpm lint` clean; no `any` in changed public surface.
- [ ] Coverage ≥ project gate; `/code-quality` finds no dead/fabricated symbols.
- [ ] No schema migration added (D5); `admin-keys.ts` within `architecture.md §7` LoC budget.
- [ ] Cross-workspace 403/404 negative test passes (the Model B invariant).
- [ ] CHANGELOG `[Unreleased] § Added` updated (new scope, targeted mint, requireCredential).
- [ ] No raw secret in any log/audit line (existing invariant preserved).
