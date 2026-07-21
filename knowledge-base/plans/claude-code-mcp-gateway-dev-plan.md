---
slug: claude-code-mcp-gateway-dev
milestone_id: M7
created_at: 2026-07-21
goal: >
  Wire every Claude Code instance to theo-memory through the Theo MCP Gateway on the dev
  environment, measured by a regression guard where a request with no credential is denied at the
  edge, a valid theo_live_* completes a full MCP handshake plus a tools/call through the proxy, and
  tenant A cannot read tenant B's memories.
---

# Plan: Claude Code ⇄ theo-memory via the Theo MCP Gateway (dev)

## Goal

Wire every Claude Code instance to theo-memory through the Theo MCP Gateway on dev, measured by a
regression guard asserting: no credential → denied at the edge; a valid `theo_live_*` → full
`initialize → initialized → tools/call` through the proxy; tenant A cannot read tenant B.

## Context

Grounded in `knowledge-base/discoveries/blueprints/claude-code-mcp-gateway-dev-blueprint.md`
(`/discover-confidence` SHIPPABLE, zero hard caps). It resolves the question M6 deferred and
establishes that two configuration gaps — neither in this repository — block the path, while the
gateway itself is deployed and correctly fail-closed.

## Baseline Context

### Files that will be touched

| Artifact | Repo / host | Current state | Why it changes |
|---|---|---|---|
| `../../theo-cloud/theo/infra/local/Caddyfile` § `app-dev.usetheo.dev` | `theo` repo | Routes `/v1/memory/*` → `:8092`; **no `/mcp/*` block** | Add the missing route (blueprint D1) |
| `<HOME>/theo-cloud/theo/.local/Caddyfile` | dev droplet | The config the running Caddy actually loads (`caddy run --config`) | Must reflect the source change to take effect |
| `../../theo-cloud/theo-workspace/compose.yaml` + `compose.override.yml` | `theo-workspace` repo, `<HOME>/theo-cloud/theo-workspace` | `theo-cloud` → `postgres://theo:***@pg-cloud:5432/theo` | Re-point the ForwardAuth validator at the canonical store (blueprint D2) |
| `docs/claude-code-kit/README.md` + `install.sh` | **this repo** | Documents the raw-REST endpoint | Document the gateway registration (`--transport http`, `--scope user`) |
| `tests/` (new) | **this repo** | No MCP-edge guard exists | The 7 regression assertions |

### Current callers / dependents

- `docs/claude-code-kit/hooks/theo-lib.mjs` builds `${url}${path}` with `/v1/recall` hardcoded — the
  raw-REST dialect. Every hook depends on it.
- `../../theo-cloud/theo-workspace/dev/traefik/dynamic.yml:87-91` declares the `/mcp` router → `theo-mcp-gateway:18090`,
  with no middlewares (the gateway is the auth layer).
- `../../theo-cloud/theo-cloud/internal/auth/scope.go:103-129` is the single validation path for `theo_live_*`.

### Domain glossary

- **Model B** — the gateway holds a control-plane credential (`memory:platform-admin`, no data
  scope) and mints a per-tenant data key per request, never forwarding the client's key.
- **Capability segment** — the path element after `/mcp/` that selects the upstream capability.
- **Split-brain** — the mint store (k3d) and the validate store (compose) being different databases.

### Architecture boundaries affected

Two repositories plus live dev infrastructure. `../CLAUDE.md` invariants 1 (both CWE-441
halves), 2 (`workspace_id == tenant_id`), 3 (resolve a Principal, never trust the body) and 6
(prove isolation through the REAL edge) all bind this work.

## Prior Art & Related Work

- `knowledge-base/discoveries/blueprints/claude-code-mcp-gateway-dev-blueprint.md` — this plan's source.
- `knowledge-base/discoveries/blueprints/claude-code-theo-memory-integration-blueprint.md` — M6; its
  Unresolved Question #1 is what M7 closes.
- OSS survey (in the blueprint): four gateway-fronted multi-tenant MCP implementations, **none** of
  which tests the proxy handshake or cross-tenant denial. No reference implementation to copy.

## ADRs

The four transport/auth decisions are inherited from the blueprint; each is restated here so the
plan is self-contained, with full alternatives recorded in
`knowledge-base/discoveries/blueprints/claude-code-mcp-gateway-dev-blueprint.md`.

### D1 — Expose the gateway at the public edge; do not re-point to the k3d BFF

**Decision:** Add a `handle /mcp/*` block routing to the data-plane edge, mirroring `/v1/memory/*`.
**Rationale:** The gateway already runs and is fail-closed; only public routing is missing.
**Alternatives considered:** Routing memory/MCP to the k3d BFF because it already holds the keys —
rejected: bypasses ForwardAuth and re-opens the CWE-441 half the platform closed.

### D2 — Make the k3d store canonical; re-point the validator, not the minter

**Decision:** Point the compose `theo-cloud` at the k3d Postgres.
**Rationale:** The k3d store holds the real state (12 keys, 4 users, 4 tenants); the compose store
is empty; schemas are identical, so this is configuration, not migration.
**Alternatives considered:** Seeding keys into the compose store — rejected, duplicates state and
guarantees divergence. Minting twice — rejected, pushes an infrastructure defect onto users.

### D3 — Static bearer over OAuth for the client

**Decision:** Register with `--transport http` and a static `Authorization` header.
**Rationale:** Claude Code documents `--header` for remote servers; the platform already mints
`theo_live_*` with per-verb scopes.
**Alternatives considered:** Implementing OAuth 2.1 + RFC 9728 + RFC 8707 — rejected as
disproportionate for a dev integration and unnecessary given documented static-header support.

### D4 — HTTP transport, not SSE

**Decision:** Use Streamable HTTP.
**Rationale:** Claude Code documents SSE as deprecated; the MCP spec superseded HTTP+SSE.
**Alternatives considered:** SSE — rejected despite `themory mcp` supporting it for OpenMemory
compatibility; that surface serves a different client population.

### D5 — Cross-repo split: infra changes land in their own repositories

**Decision:** The Caddyfile and compose changes are prepared and applied against the dev
environment, and land as changes in the `theo` / `theo-workspace` repositories. This repository
ships only the client wiring, the documentation, and the regression guard.

**Rationale:** theo-memory's release cannot merge another repository's files. Pretending otherwise
would produce a milestone that claims delivery it cannot make.

**Alternatives considered:** Vendoring the Caddyfile fragment here — rejected, guarantees drift.
Blocking M7 until the other repos merge — rejected, the client-side work is independently valuable
and testable.

**Consequences:** The M7 checkbox depends on evidence captured from the live dev environment, not
solely on files merged here.

## Phase 1 — Unblock authentication

### T1.1 — Re-point the ForwardAuth validator at the canonical store

#### Why this step

Nothing downstream can be proven while every credential is uniformly denied: with an empty
`theo_api_keys`, a valid key and a forged one are indistinguishable by design (`scope.go` collapses
both into `ErrInvalidCredential`). This is the single blocking edge.

#### TDD

- **RED:** `curl -s -o /dev/null -w '%{http_code}' https://app-dev.usetheo.dev/v1/memory/skills -H "authorization: Bearer <valid theo_live_*>"` returns **401** today. Capture it as the failing baseline.
- **GREEN:** point the compose `theo-cloud` at the k3d Postgres; the same command returns a non-401.
- **REFACTOR:** choose a network path that survives a reboot (see Unresolved Questions), not an ad-hoc port-forward.

#### Files to edit

- `<HOME>/theo-cloud/theo-workspace/compose.override.yml` (dev droplet; `theo-workspace` repo)

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

A valid `theo_live_*` stops returning 401 on `/v1/memory/skills`; an invalid one still returns 401.

### T1.2 — Add the `/mcp/*` route at the public edge

#### Why this step

The gateway is deployed and fail-closed, but unreachable publicly: `/mcp/*` falls to the SPA
`file_server`. Per the platform's own smoke criterion, a non-gated response on a protected path is
a failure.

#### TDD

- **RED:** `POST https://app-dev.usetheo.dev/mcp/<capability>` returns `405` with `server: Caddy`, `allow: GET, HEAD` — the static file server. Assert `content-type` is **not** `text/html`; it fails today.
- **GREEN:** add `handle /mcp/* { reverse_proxy localhost:8092 }` mirroring the `/v1/memory/*` block; the same request returns a JSON 401 from the gateway.
- **REFACTOR:** land the change in `../../theo-cloud/theo/infra/local/Caddyfile` (source), not only in the running `.local/Caddyfile`.

#### Files to edit

- `../../theo-cloud/theo/infra/local/Caddyfile` (source) and the running `<HOME>/theo-cloud/theo/.local/Caddyfile`

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

`POST /mcp/<capability>` with no credential → 401/403 **and** `content-type` is not `text/html`.

## Phase 2 — Wire and prove the client

### T2.1 — Register Claude Code against the gateway and prove a round-trip

#### Why this step

The DoD requires a *new* instance to work with one documented command — the client-side proof that
the architecture holds end-to-end.

#### TDD

- **RED:** a fresh registration against the edge fails to complete `initialize` before Phase 1 lands.
- **GREEN:** `claude mcp add --transport http --scope user theo-memory https://app-dev.usetheo.dev/mcp/<capability> --header "Authorization: Bearer theo_live_*"` connects; `remember` then `recall` round-trips.
- **REFACTOR:** remove the stdio registration and the raw-REST endpoint from the kit configuration so no client retains database or LLM credentials.

#### Files to edit

- `docs/claude-code-kit/README.md`, `docs/claude-code-kit/theo-memory.env.example`, `docs/claude-code-kit/install.sh`

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

A brand-new Claude Code instance on a different project performs `remember` → `recall` through the
edge, holding only a `theo_live_*`.

### T2.2 — Regression guard

#### Why this step

The OSS survey found no implementation testing the proxy handshake or cross-tenant denial. Without
a guard, this milestone silently regresses the moment a route or a database URL changes — which is
exactly how it broke.

#### TDD

- **RED:** the guard fails against the pre-fix environment (SPA response, uniform 401).
- **GREEN:** all seven assertions from the blueprint's Coverage Corner 1 pass against dev.
- **REFACTOR:** ensure no assertion can pass by skipping (the `ensure_not_auth_error` anti-pattern).

#### Files to edit

- `tests/integration/mcp-edge/gateway-contract.test.ts` (NEW)

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios

See `## Failure scenarios`.

#### Acceptance criteria

Seven assertions green against dev; each fails when its precondition is broken.

## Failure scenarios

This work is entirely external-I/O bound (HTTP to the edge, TCP to Postgres).

| Dependency | Failure mode | How the test reproduces it | Expected behaviour |
|---|---|---|---|
| Edge (Caddy → Traefik) | Route missing / reverted | Request `/mcp/<cap>` and assert `content-type != text/html` | Guard fails loudly rather than reporting a pass |
| Gateway | Down / unreachable | Traefik returns 502 | Guard fails; never interpreted as "denied" |
| Credential store | Unreachable or empty | Valid key returns 401 | Guard distinguishes "denied" from "store broken" by also asserting a valid key succeeds |
| MCP transport | Wrong protocol version | Send `MCP-Protocol-Version: 1999-01-01` | `400`, not a generic 500 |
| MCP session | `Mcp-Session-Id` dropped at the hop | Complete `initialize`, then call with the returned session id | Call succeeds; a dropped header surfaces as a spurious 404 |

## Coverage Matrix

| Goal claim | Task |
|---|---|
| No credential → denied at the edge | T1.2, T2.2 |
| Valid `theo_live_*` → full handshake + `tools/call` through the proxy | T1.1, T2.1, T2.2 |
| Tenant A cannot read tenant B | T2.2 |
| Every Claude Code instance, one command | T2.1 |
| No database/LLM credential on any client | T2.1 |

**Coverage: 5/5 (100%)**

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Changes shared dev infrastructure — the Caddyfile and compose stack serve everyone using the dev environment | HIGH | One directive at a time, each verified before the next, each reversible; the running config is edited only after the source change is prepared | This plan |
| Cross-repo delivery — two of four changes cannot merge in this repository (D5) | MEDIUM | Milestone evidence comes from the live environment; infra diffs are prepared for their own repositories | This plan + platform repo owners |
| Re-pointing the validator changes authorization outcomes — consumers that implicitly relied on "everything denied" start seeing real results | MEDIUM | Stated up front rather than discovered; T1.1 asserts both a valid key succeeding AND an invalid one still denied | This plan |
| The static-bearer model is tolerated, not blessed, by the MCP spec | LOW | Documented in blueprint D3 with the condition under which it must change (if the gateway ever advertises itself as an OAuth resource server) | Future work |
| A Cloudflare API token is exposed in the Caddy process arguments, readable by any local user via `/proc/<pid>/cmdline` | HIGH | Out of M7 scope to fix, but reported so it is tracked; must be rotated and moved to a restricted env file | Platform operator |

## Unresolved Questions

- Which network path carries the compose validator to the k3d Postgres durably? The NodePort
   (30432) is **not** published to the host by k3d, and the existing `:15432` port-forward is bound
   to `127.0.0.1` (containers cannot reach it via the bridge). Candidates: attach the container to
   the k3d network, publish the NodePort, or a managed `--address 0.0.0.0` forward. Chosen during T1.1.
- Which capability segment does the gateway expect for theo-memory? Indistinguishable until a
   valid credential reaches it (all segments answer 401 identically). Resolved by T1.1 landing first.
- Does the gateway preserve `MCP-Protocol-Version` and `Mcp-Session-Id` across the hop? Untested
   in every surveyed implementation; T2.2 asserts it.

## Global Definition of Done

- All seven Coverage Corner 1 assertions green against dev.
- A new Claude Code instance works with one documented command, holding only a `theo_live_*`.
- No client configuration retains a database or LLM credential.
- `CHANGELOG.md` updated (Unbreakable Rule 6).
- Evidence (real request/response transcripts) recorded in the milestone run-file.
