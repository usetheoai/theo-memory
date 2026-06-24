# Discovery Dossier — Model B Slice 1: Platform-admin workspace-targeted key minting (theo-memory)

**Date:** 2026-06-24
**Cycle:** Model B (close the gateway↔theo-memory confused-deputy, CWE-441). Cross-repo; this dossier covers the **theo-memory** (provider) slice — the dependency that must ship first.
**Entry point chosen:** `/to-plan` (this is a self-contained provider change; the external prior-art is captured below from web specs, not cloned repos — so the rubric-scored `/discover-confidence` blueprint path does not apply).

---

## Why (problem)

The theo-cloud gateway authenticates to theo-memory with a **single master key** authorized for every tenant, isolating tenants only by injecting the subject into the URL path. One path-construction bug = cross-tenant breach the provider cannot catch (classic confused deputy, CWE-441). The fix (Model B, owner-approved 2026-06-24) is **per-tenant downstream credentials**: the gateway provisions a `theo_live_*` key bound to each tenant's workspace and uses it on the data path, so **theo-memory enforces isolation from the credential**.

For the gateway to do that, theo-memory must let a **platform-level admin** mint a key bound to an **arbitrary target workspace** (one workspace per cloud tenant). Today it cannot.

## Current state (evidence-backed; theo-memory @ develop)

Workspace isolation is **GA** — both slices `multi-tenant-workspace-isolation` and `multi-tenant-rbac-and-slice1-completion` are READY_TO_MERGE.

- `resolvePrincipal(token) → Principal { workspaceId, userId, role, scopes }` — `packages/api/src/server/auth/api-key-verifier.ts:125`. SQL `SELECT_PRINCIPAL_BY_HASH_SQL` (`api-key-verifier.ts:71-80`) reads `k.workspace_id, k.user_id, k.scopes` + LEFT JOIN `workspace_users` for role.
- Every memory verb scopes by `principal.workspaceId` via `workspaceBoundMemory()` (`packages/api/src/server/handlers/_body-parsing.ts:29-33`); body-supplied `workspaceId` rejected by `.strict()` zod.
- `tenant_id` is still hardcoded `'self'` (`api-key-verifier.ts:79`, `admin-keys.ts` `TENANT_SELF`); `workspace_id` is the real tenant anchor.

### The three blockers (B1–B3)

- **B1 — admin mint binds to caller's workspace (THE blocker).** `createKeyHandler` (`packages/api/src/server/handlers/admin-keys.ts:155-358`) resolves `callerWorkspace` from the CALLER's credential (`admin-keys.ts:227-257`) and writes it into both INSERTs (`:322-324`, `:341-343`). The body accepts `name, scopes, expires_at, user_id` — **no `workspace_id`**. A single platform admin credential can therefore only mint keys into its own workspace. Documented deferral: CHANGELOG "Per-workspace admin delegation belongs to the deferred membership layer."
- **B2 — tenancy granularity.** Within one workspace, the path `{subject}` is NOT cross-checked against the Principal (grep: zero `principal.userId === subject`). Defense-in-depth holds only if **each cloud tenant = its own workspace**. RESOLVED by the cross-repo decision: `workspace = cloud TenantID`; cloud `Subject` = user-tier within it. Cross-tenant breach (the boundary that matters) is then provider-enforced; within-tenant subjects belong to the same trust boundary (acceptable). No within-workspace subject-binding needed.
- **B3 — fail-open fallback.** With `THEMEMORY_API_KEY` unset, `bearerAuth` injects a full-owner `DEFAULT_PRINCIPAL` → workspace `'default'` (`packages/api/src/server/auth/middleware.ts:97-106`); per-handler `?? DEFAULT_WORKSPACE_ID`. This is fail-open for a multi-tenant deployment. `OidcAuthVerifier` lacks `resolvePrincipal` (moot for Model B since the gateway uses `theo_live_*`, but must not be a silent hole).

## Prior art (FAANG canon — web specs)

- **AWS SaaS Lens — Tenant Isolation**: per-request tenant-scoped credentials; *isolation ≠ authorization* (authz won't catch a cross-tenant read). https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html
- **Confused deputy / CWE-441**: design-time defect; mitigate by scoping the deputy's authority down. https://cwe.mitre.org/data/definitions/441.html
- **AWS ExternalId discipline**: provider must *validate that the role refuses without the correct id* — i.e., the provider MUST actually reject cross-tenant access (negative test mandatory). https://docs.aws.amazon.com/IAM/latest/UserGuide/confused-deputy.html
- **NIST AC-5/AC-6** separation of duties + least privilege → platform-admin (mint) scope MUST be distinct from data scopes and from per-workspace admin. https://csf.tools/reference/nist-sp-800-53/r5/ac/ac-6/

## Scope of THIS slice (theo-memory)

1. **New platform-level scope** (e.g. `memory:platform-admin`) distinct from `memory:admin`. Only it may target an arbitrary `workspace_id`. A `memory:admin` key keeps today's caller-workspace-bound behavior (no regression, no privilege escalation).
2. **`POST /v1/admin/keys` accepts optional `workspace_id`** (target). When present: require `memory:platform-admin`; auto-provision the `workspaces` row if absent (idempotent); bind the minted key + `user_id` to that workspace. When absent: unchanged (caller-workspace).
3. **Fail-closed multi-tenant mode (B3):** a server started in platform/multi-tenant mode MUST NOT fall back to `DEFAULT_PRINCIPAL`/`'default'`; missing/invalid credential → 401. (Single-tenant OSS default unchanged for backward compat.)
4. **Rotation precondition (verify):** confirm the schema allows ≥2 concurrently-active keys per workspace (the rotate endpoint + grace window exist per ADR-0014) so the gateway can rotate zero-downtime. If not, flag.

Out of scope: the gateway side (Slice 2), Postgres RLS, OIDC `resolvePrincipal` (separate follow-up — gateway uses `theo_live_*`).

## Invariants to assert + test

- A `memory:platform-admin` key mints a key bound to an arbitrary target `workspace_id` (auto-provisioning the workspace).
- A `memory:admin` (non-platform) key that supplies `workspace_id != own` is **rejected** (403) — no privilege escalation.
- A key bound to workspace A used against workspace B's scope → **404/cross-workspace mismatch** (no existence leak) — the provider-enforced isolation that Model B relies on (negative test, AWS ExternalId discipline).
- Auto-provision is idempotent (concurrent mint for same new workspace → one workspace row).
- Fail-closed: platform mode without credential → 401, never `'default'`.

## ADR seeds

- **ADR — Platform-admin scope vs reusing `memory:admin`.** Chosen: new `memory:platform-admin`. Rejected: overload `memory:admin` (violates least-privilege/SoD per NIST AC-5/6; would let any deployment admin cross workspaces). Rejected: a separate admin service (YAGNI; the lifecycle already lives here per ADR-0014).
- **ADR — workspace = cloud TenantID.** Chosen mapping (grounded in AWS "one identity boundary per tenant"). Rejected: many-tenants-per-workspace + gateway-only subject isolation (keeps the confused deputy — defeats the goal).
- **ADR — auto-provision workspace on targeted mint.** Chosen: idempotent upsert inside the mint tx. Rejected: separate `POST /v1/admin/workspaces` first (extra round-trip for the gateway; can be added later if needed).

## Open question for /to-plan to resolve against code

- Exact migration need: does `theo_api_keys` already permit multiple active rows per `workspace_id` (rotation)? Does a `workspaces` table exist to upsert into, and is there a FK from `theo_api_keys.workspace_id`? (Confirm in `packages/api/src/local/migrations/` during Step 1.)
