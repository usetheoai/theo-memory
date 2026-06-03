# Plan: TheMemory Standalone P0 — REST API + Docker stack + CLI consolidado

> **Version 1.1** (2026-06-03) — Absorbs `/edge-case-plan` report (49 edge cases: 12 MUST FIX + 25 SHOULD TEST + 12 DOCUMENT). **EC-47 BLOCKER resolved via Opção A** (user AskUserQuestion 2026-06-03): docker-entrypoint.sh REMOVED; migrate-on-startup logic moved INTO `themory server` subcommand binary; ENTRYPOINT becomes direct Node invocation (`["node", "/app/dist/agent-tools/cli.js", "server"]`). 12 MUST FIX absorbed via ADR amendments D3 + D6 + D8 + 2 new ADRs (D12 single-scope-tier semantic + D13 direct-Node-binary entrypoint) and task additions. 25 SHOULD TEST absorbed inline in TDD blocks. 12 DOCUMENT absorbed as ADR Consequences + Acceptance Criteria notes. Coverage Matrix expands from 36 to 85 rows.
>
> **Version 1.0** (2026-06-03) — Ship the standalone-distribution surface for TheMemory (CLAUDE.md § Phase III bis, Items 16/17/18). Anchored on `/research/theo-memory-standalone-p0-test-patterns-2026-06-03.md` (canonical RED test inventory + 5 patterns lifted from Mem0 + Letta). The plan ships: (a) REST API server at `@usetheo/memory/server` wrapping the 4 verbs over Hono + bearer auth + OpenAPI 3.1 spec + OTel observability + domain-error envelope; (b) multi-stage Dockerfile → distroless image → published to GHCR via GitHub Actions with Trivy scan gate; (c) consolidated `themory` CLI with 4 subcommands (`mcp`/`server`/`migrate`/`health`) preserving backward-compat alias. Goal-test is an integration round-trip of `POST /v1/remember` + `POST /v1/recall` against `ghcr.io/usetheo/themory:0.1.0-alpha` started via `docker compose up` with ZERO manual setup steps.

## Goal

> "Ship a standalone REST + Docker + CLI distribution surface for TheMemory so that `docker compose up` exposes the 4 verbs over HTTP with bearer auth + OpenAPI 3.1 spec + multi-subcommand CLI, measured by the integration test `tests/integration/docker-stack.test.ts` round-tripping `POST /v1/remember` + `POST /v1/recall` end-to-end against `ghcr.io/usetheo/themory:0.1.0-alpha` with ZERO manual setup steps."

## Context

### What exists today

- **Library-only distribution**: `@usetheo/memory` package shape ready but **not published** (name reserved per CLAUDE.md `Locked names`).
- **11 DIPs declared** (`src/core/dip/{vector-store,llm,embedder,history-manager,reflection-policy,eviction-policy,skill-representation-strategy,scoring-strategy,conflict-resolution-policy,benchmark-adapter,tokenizer}.ts`) — composable shape ready.
- **Existing CLI**: single-purpose `themory-mcp` bin (per `package.json:53-55`) bootstraps MCP server via `src/agent-tools/cli.ts`. Stdio default + streamable-HTTP optional per `THEOMEM_MCP_TRANSPORT` env.
- **Existing Docker**: `docker-compose.yaml` at repo root boots ONLY pgvector dev container (`ankane/pgvector:v0.5.1`, port 5432) — no TheMemory app image.
- **Existing tests**: 845 contract + integration suite passing; `tests/e2e/agent-tools/round-trip.test.ts` exercises MCP stdio + JSON-RPC roundtrip (v0.3 GOAL METRIC).
- **No REST/HTTP framework** dep — only `@modelcontextprotocol/sdk` for MCP.
- **No `src/server/` directory** — entirely new locus.

### What's broken or missing

Per the strategic gap analysis 2026-06-03 (conversation transcript + CLAUDE.md Phase III bis preamble): **`/dogfood` EVIDENCE_INSUFFICIENT + zero publicly distributed packages = adoption ceiling at zero**. Consequence: every shipped feature (reflection, forgetting, skill library, distillation, multi-peer, bi-temporal) is paper-only without consumer evidence. The biggest gap is NOT a missing feature — it is **distribution surface for non-MCP consumers**.

Per Mem0 + Letta packaging audit 2026-06-03 (Agent Explore output): Mem0 ships hybrid OSS + hosted (FastAPI + Docker Compose + 30+ vector stores + CLI). Letta ships full self-host stack (FastAPI + WebSocket + multi-stage Dockerfile + GHCR-equivalent). TheMemory ships **none of this** today — the SDK contract is mature but the distribution stack is empty.

### Evidence motivating NOW (not later)

1. **TheoCloud PaaS GA remains blocked** (Roadmap Item 7 Status). Waiting for PaaS to unblock cloud distribution means waiting indefinitely. Standalone unblocks adoption today.
2. **The SDK contract is locked** (10 milestones v0.0 → v1.1 shipped). Building a thin REST + CLI + Docker wrapper over a locked contract is low-risk, high-leverage work.
3. **Mem0 + Letta + Zep are consolidating market share** with their distribution stacks while we ship feature-only. The longer we wait, the harder consumer acquisition becomes.
4. **Per Inquebrável Rule 9 (Não Reinvente a Roda)** — Hono, commander, GitHub Actions, GHCR, Trivy, @hono/zod-openapi are all battle-tested. We adopt, we don't reinvent.

## Objective

- [ ] Sub-goal 1 — 12th DIP `AuthVerifier` declared + `BearerAuthVerifier` impl wired (T0.1 + T1.1)
- [ ] Sub-goal 2 — REST API server at `@usetheo/memory/server` exposing 4 verbs + `/v1/health` + `/v1/scopes/:type/:id/memories` paginated listing (T1.2 + T1.3)
- [ ] Sub-goal 3 — OpenAPI 3.1 spec auto-generated from zod schemas via `@hono/zod-openapi` at `GET /v1/openapi.json` (T1.4)
- [ ] Sub-goal 4 — OTel span observability per handler + domain-error → HTTP envelope mapping (T1.5 + T1.6)
- [ ] Sub-goal 5 — `themory` multi-subcommand CLI (`mcp` / `server` / `migrate` / `health`) replacing single-purpose `themory-mcp` with one-release backward-compat alias (T2.1 → T2.5)
- [ ] Sub-goal 6 — Multi-stage Dockerfile (Node 22 → distroless) + production `docker-compose.prod.yaml` + GHCR build/scan workflow with Trivy scan + allowlist (T3.1 → T3.4) — **migrate-on-startup baked INTO `themory server` binary per ADR D13** (EC-47 absorbed)
- [ ] Sub-goal 7 — `themory server` invokes `runMigrations()` BEFORE binding port (stricter than Mem0/Letta references per `architecture.md § 10.2`; replaces deleted docker-entrypoint.sh design) (T2.3 + T3.4)
- [ ] Sub-goal 8 — THE GOAL TEST `tests/integration/docker-stack.test.ts` round-tripping `POST /v1/remember` + `POST /v1/recall` against `ghcr.io/usetheo/themory:0.1.0-alpha` returns 100% PASS

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | ^1.29.0 | npm | MCP runtime — `themory mcp` subcommand backward-compat |
| `pg` | ^8.13.0 | npm | DB driver — `themory migrate` + `themory health` + REST server pool |
| `drizzle-orm` | ^0.45.0 | npm | Migration runner — `themory migrate` wraps `runMigrations(pool)` from `src/local/index.ts:1026` |
| `zod` | ^3.25.0 | npm | Request schema validation per `architecture.md § 8 (boundary validation)` |
| Node | >=20.0.0 | runtime | per `package.json` engines (line 57) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `hono` (NEW) | ^4.6.0 | npm | Evaluated: Express (mature but verbose + Node-only), Fastify (TS-friendly + faster but heavier), Hono (TS-first + edge-ready + smallest viable + ~12KB). FastAPI Python equivalent. | TS-first + Web Standards + smallest viable — closest TS analog to FastAPI used by Mem0 + Letta. |
| `@hono/node-server` (NEW) | ^1.13.0 | npm | Hono's official Node adapter (peer of `hono`). Required to bind Hono app to Node HTTP server. | Canonical adapter; aligned with `hono` major version. |
| `@hono/zod-openapi` (NEW) | ^0.18.0 | npm | Evaluated: hand-write OpenAPI YAML (high maintenance + drift risk), `@asteasolutions/zod-to-openapi` (works but not Hono-native), `@hono/zod-openapi` (auto-derives spec from zod schemas + Hono-native + ships RouteConfig type). | Single source of truth (zod schemas) → no spec drift. Honors `architecture.md § 8` validation discipline. Version aligned with `hono ^4.6` per EC-18 absorption. |
| `commander` (NEW) | ^12.1.0 | npm | Evaluated: citty (~5KB, less mature), yargs (~200KB, heavyweight, deprecated patterns), commander (~30KB, 100M+ weekly downloads, TS types ship, used by Node ecosystem). | Conservative choice; most Node CLI tooling reads as commander. Trade-off: 6x heavier than citty for 5x more battle-testing. Acceptable. |
| dev `strip-ansi` (NEW) | ^7.1.0 | npm | Evaluated: hand-roll ANSI regex (fragile across terminals), `chalk` strip util (heavy dep), `strip-ansi` (5KB, single purpose, 100M weekly). | Mirror of Mem0 P3 pattern (test_cli_integration.py:_ANSI_RE). Used in tests only. |
| dev `@apidevtools/swagger-parser` (NEW) | ^10.1.1 | npm | Evaluated: hand-roll OpenAPI 3.1 schema validation (high cost + spec evolution risk), `ajv` + manual schema fetch (works but reinvents), `swagger-parser` (canonical OpenAPI parser + validator). | Single-purpose dep for T1.4 RED test (`test_openapi_spec_validates_against_schema`). Used in tests only. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

### Defer to P1 (intentional)

| Package | Why deferred |
|---|---|
| `testcontainers` | Heavy dev dep (~80MB) for Docker integration tests. P0 acceptance reuses existing `themem_pgvector` already-running convention (matches contract suite). Re-evaluate if multi-Docker matrix expands. |
| ARM64 builds | Mem0 + Letta both ship amd64-only initially. ARM64 needs QEMU + cross-build CI complexity. Defer to P1. |

## ADRs

### D1 — REST framework: Hono (over Fastify / Express)

**Decision:** Use `hono ^4.6.0` for the REST server.

**Rationale:** Hono is the TS-first Web Standards equivalent of FastAPI (used by Mem0 + Letta). Smallest viable runtime (~12KB), edge-ready (Cloudflare Workers + Vercel + Bun + Node), zero deps in core. `@hono/zod-openapi` extension provides single-source-of-truth spec generation matching `architecture.md § 8` boundary-validation discipline.

**Alternatives considered:**
- **Express ^4**: REJECTED. Mature but verbose; Node-only (no edge runtime); ~3MB tree; weak TS typing; community drifting to Hono/Fastify for new projects.
- **Fastify ^5**: REJECTED. Better perf than Express + TS support but heavier (~700KB) + plugin ecosystem complexity for small surface. Hono is ~50× lighter for our scope (6 endpoints).
- **Native `node:http`**: REJECTED. Zero deps but reinvents routing + body parsing + middleware — violates Rule 9 + adds maintenance debt for small saving.

**Consequences:** Hono's edge-runtime support means future cloud deploy (CloudFlare Workers, Vercel Edge Functions) is one config away. `@hono/zod-openapi` couples spec to validation — single change point. **(EC-18 absorbed)** Versions of `hono` + `@hono/zod-openapi` + `@hono/node-server` MUST stay in same major-version compatibility window — enforced via T0.1 RED test.

### D2 — Endpoint shape: RPC-mirror of 4 verbs (over REST-resource)

**Decision:** Endpoints mirror the SDK's 4 verbs as RPC POST calls: `POST /v1/remember`, `POST /v1/recall`, `POST /v1/forget`, `POST /v1/reflect`. Listing is `GET /v1/scopes/:type/:id/memories` (paginated). Health is `GET /v1/health`.

**Rationale:** The domain is **semantic memory operations**, not CRUD resources. `POST /v1/remember` reads naturally as "the memory system, remember this"; `POST /memories` reads as "create a memory row" which is the wrong mental model (memories may be extracted into N rows or deduped into zero). Mem0 uses similar RPC shape; Letta uses `/agents/messages` not `/messages`. Honoring `architecture.md § 4 (Mem0-shape, not Mem0-clone)`: same shape, different vocabulary (the 4 verbs).

**Alternatives considered:**
- **REST resource (POST /memories, GET /memories/:id, DELETE /memories/:id)**: REJECTED. Forces "memory = row" model, which is wrong (extraction may produce N rows, dedup may produce zero). Loses paridade with SDK.
- **GraphQL single endpoint**: REJECTED. Adds GraphQL runtime dep (~500KB) for 6 operations. Overkill.
- **JSON-RPC over HTTP (mirror agent-tools/MCP shape)**: REJECTED. Less consumer-friendly for curl/browser/Postman; MCP exists already at `themory mcp` subcommand.

**Consequences:** OpenAPI spec describes 6 operations cleanly. Future verbs add as new POST endpoints without redesign. `themory remember` CLI verb-subcommand (P1) maps 1:1 to `POST /v1/remember`.

### D3 — Auth: Bearer token via `THEMEMORY_API_KEY` env var (single DIP) — **AMENDED 2026-06-03**

**Decision:** REST server accepts `Authorization: Bearer <token>` header. Token compared against `THEMEMORY_API_KEY` env var. **Empty string OR whitespace-only env value ⇒ fail-closed (auth required, no token accepted)** per EC-1. **Header parsing is case-insensitive on the scheme name (`Bearer` / `bearer`) per RFC 6750** per EC-2. **Token portion is compared verbatim with no trim** (operator responsible for clean env values) per EC-3. No-auth fallback only when env var is truly `undefined` (alpha-mode convenience). 12th DIP `AuthVerifier` with single method `verify(token: string): Promise<boolean>` allows future OAuth/JWT swap.

**Rationale:** Mirror of `THEOKIT_API_KEY` shape per ADR-0009 — zero new mental model for ecosystem consumers. Bearer + env-var is the most common REST auth pattern in 2026 (used by OpenAI API, Anthropic API, GitHub API). DIP boundary preserves ADR-0008 method-count caps + enables future OAuth/JWT without surface change. **Empty-string ambiguity (EC-1) resolved fail-closed for security correctness** — an operator who wants no-auth must `unset THEMEMORY_API_KEY` explicitly, not blank it.

**Alternatives considered:**
- **`X-API-Key` header (Mem0 P1 pattern)**: REJECTED. Non-standard; `Authorization: Bearer` is the OAuth-derived idiom most clients send by default.
- **No auth at all (alpha)**: REJECTED. Single-line of defense against accidental public exposure is cheap; opt-out via unset env var preserves alpha-mode UX.
- **Empty-string = auth disabled (fail-open)**: REJECTED per EC-1. Undefined behavior at the operator boundary is the worst security posture; fail-closed forces explicit intent.
- **mTLS / client certs**: REJECTED. Out-of-scope for P0; high ops burden. P1 candidate.
- **Hardcoded auth check (no DIP)**: REJECTED. Forces breaking change when OAuth/JWT lands. DIP cost is one interface file.

**Consequences:** New 12th DIP `src/core/dip/auth-verifier.ts`. `BearerAuthVerifier` impl lives in `src/server/auth/bearer-verifier.ts` (under server module to keep `src/core/` DIP-clean per `architecture.md § 3`). OAuth/JWT impl deferred to P1. **JSDoc on `BearerAuthVerifier` constructor explicitly documents fail-closed empty-string contract** — operator confusion is the failure mode, documentation is the fix.

### D4 — CLI lib: commander (over citty)

**Decision:** Use `commander ^12.1.0` for the `themory` CLI.

**Rationale:** commander is the most-downloaded Node CLI lib (100M+/week) — TS types built-in, multi-subcommand pattern canonical, used by Node ecosystem core (npm, npx, semver). citty is ~6x smaller but ~5x less battle-tested + newer ecosystem.

**Alternatives considered:**
- **citty ^0.1.x**: REJECTED. Smaller (~5KB) but ecosystem younger; trade conservative robustness for size.
- **yargs ^17.x**: REJECTED. ~200KB heavyweight; deprecation patterns (some methods marked `@deprecated`); LOC cost not justified.
- **clipanion**: REJECTED. Used by Yarn but bespoke patterns; smaller community.
- **Hand-roll `process.argv`**: REJECTED. Reinvents help generation, subcommand routing, type validation. Violates Rule 9.

**Consequences:** ~30KB dep added. Multi-subcommand pattern: `themory.command('mcp').action(...)`, etc. Existing `themory-mcp` bin retained ONE release as alias with stderr deprecation warning.

### D5 — Docker test approach: reuse existing `themem_pgvector` (over testcontainers)

**Decision:** Docker stack integration test (T3.5) reuses the already-running `themem_pgvector` container per the contract-suite convention (env `THEOMEM_PG_URI` set; `describe.skipIf(PG_URI === '')` pattern from `tests/integration/v1-1-multi-peer-bitemporal.test.ts:52`).

**Rationale:** `testcontainers ^10.x` adds ~80MB dev dep for marginal value. The contract suite already gates integration tests on `THEOMEM_PG_URI`. Mirror that convention for `tests/integration/docker-stack.test.ts`: when env is set, spin up the TheMemory app container via `docker run`, point at the existing pgvector, exercise the round-trip.

**Alternatives considered:**
- **testcontainers**: REJECTED. Heavy dep + slower test runs + reinvents what `docker compose up` already gives us.
- **GitHub Actions service container**: REJECTED. Locks the test to CI environment; loses local repro.
- **No Docker test at all (CI-only smoke check)**: REJECTED. Item 17's acceptance gate REQUIRES the round-trip; no test = no proof.

**Consequences:** Integration test gated on `THEOMEM_PG_URI` + `DOCKER_INTEGRATION=true` to avoid surprising default-test runs with Docker requirement. Test author manages container lifecycle via `node:child_process` (same shape as `themem_pgvector` convention). **(EC-48 absorbed)** Test uses unique compose project name (`themory-test-${random}`) to prevent cross-run pollution.

### D6 — Multi-stage Dockerfile → distroless runtime — **AMENDED 2026-06-03**

**Decision:** Multi-stage Dockerfile: `node:22-alpine` build stage (tsc + postbuild migrations copy) → `gcr.io/distroless/nodejs22-debian12:nonroot` runtime. Layer cache via `package.json` + `package-lock.json` copied before source. **CAVEAT (EC-47 absorbed):** distroless `:nonroot` has NO shell — entrypoint MUST be a direct Node binary invocation, NOT a shell script. See ADR D13 for entrypoint shape.

**Rationale:** Distroless reduces image size + attack surface (no shell, no package manager, only Node runtime + app artifacts). Mem0 OpenMemory uses `python:slim` (200MB); Letta uses standard `python` (1.2GB). TheMemory distroless target: ~150MB final image. The no-shell constraint is a security feature, not a limitation — it forces the entrypoint to be the Node binary which carries the migrate-then-server discipline inside (per ADR D8 amended).

**Alternatives considered:**
- **`node:22-alpine` runtime stage**: REJECTED. Smaller than distroless but ships APK + busybox + shell — larger attack surface; muslibc compatibility quirks with native deps.
- **`distroless:debug` variant with busybox**: REJECTED (EC-47 absorption alternative). Adds shell but sacrifices security minimalism for convenience — the migrate-in-binary approach (D8 amended) avoids the trade-off entirely.
- **Single-stage `node:22-bullseye`**: REJECTED. ~1GB+ image; surface tracking includes ALL apt packages.
- **`bun` runtime**: REJECTED. Bun is fast but not yet a battle-tested deploy target; Node 22 LTS aligns with `engines` declaration.

**Consequences:** Build stage size ~600MB (cached); runtime stage ~150MB (shipped). Image scanned by Trivy in CI — zero CRITICAL/HIGH expected. Distroless `nonroot` user means no UID 0 in runtime — file ownership in image build stage. **No shell available**: forces ADR D13 entrypoint shape (direct Node binary).

### D7 — Image registry: GHCR (over Docker Hub)

**Decision:** Build to `ghcr.io/usetheo/themory:0.1.0-alpha`. GitHub Actions workflow auto-tags on release.

**Rationale:** GHCR free for OSS + tied to GitHub repo audit trail + no rate limits for public pulls. Docker Hub free tier added rate limits (100 pulls/6h for anonymous) — friction for OSS consumers. Letta ships to Docker Hub (`letta/letta`); we choose GHCR per the cleaner default.

**Alternatives considered:**
- **Docker Hub** (`docker.io/usetheo/themory`): REJECTED. Free tier rate-limited; ops burden of registry-creds maintenance separate from GitHub.
- **AWS ECR Public**: REJECTED. Locks us to AWS account; AWS-specific tooling.
- **Quay.io**: REJECTED. RedHat-owned; ecosystem fragmentation.

**Consequences:** Consumer pull command: `docker pull ghcr.io/usetheo/themory:0.1.0-alpha`. **(EC-44 absorbed)** Workflow MUST declare `permissions: { contents: read, packages: write }` to push to GHCR — RED test validates YAML structure.

### D8 — Migrations on startup baked INTO `themory server` binary — **AMENDED 2026-06-03 (EC-47 absorption)**

**Decision:** `themory server` subcommand invokes `runMigrations(pool)` (from `src/local/index.ts:1026`) INSIDE its action handler, BEFORE binding the REST port. Failure exits 1 — fail-fast. **NO `docker-entrypoint.sh` shipped** — the discipline lives inside the binary, not in a shell wrapper. This is compatible with distroless `:nonroot` (no shell required per D6 amendment + D13).

**Rationale:** Per `architecture.md § 10.2`, drizzle-kit push vs runMigrations divergence is a known footgun. Production deploys must use `runMigrations()` against fresh DBs. Bundling this inside startup eliminates the "did you remember to migrate?" failure class. Mem0 + Letta both ASSUME the operator ran migrations manually — we ship stricter. **Moving the discipline INTO the binary (vs shell entrypoint) means it works in distroless without shell**, also means it works regardless of how the operator invokes `themory server` (Docker, k8s, systemd, direct).

**Alternatives considered:**
- **`docker-entrypoint.sh` (v1.0 original)**: REJECTED per EC-47. Distroless `:nonroot` has no `/bin/sh` — script cannot execute.
- **Init container (k8s pattern)**: REJECTED. Adds complexity for non-k8s users (docker-compose, local dev). Locks discipline to k8s consumers.
- **Optional flag `--skip-migrations`**: REJECTED. Same forgetting-failure-class. If user needs to skip (e.g., read replica with no DDL perm), they can set env `THEMEMORY_SKIP_MIGRATIONS=true` documented as escape hatch.
- **CMD chained shell expression (`themory migrate && themory server`)**: REJECTED. Same distroless-no-shell problem.
- **Distroless `:debug` variant (busybox shell)**: REJECTED. Forfeits security benefit.

**Consequences:** Container startup is 1-3 seconds slower (migration runtime + idempotent journal check). Acceptable trade. Failure mode "migrations failed" is loud (exit 1 + structured log line) — port never opens, health endpoint never reaches 200. Operators using `themory server` directly (without Docker) ALSO get migrations-on-startup automatically. Escape hatch via `THEMEMORY_SKIP_MIGRATIONS=true` env var.

### D9 — Backward-compat: `themory-mcp` alias for ONE release

**Decision:** Existing `bin: themory-mcp` retained as a symlink/alias to `themory mcp` for v0.1.0-alpha. On invocation, emits stderr warning: `DEPRECATED: themory-mcp will be removed in 0.2.0. Use 'themory mcp' instead.` Removed in 0.2.0.

**Rationale:** Inquebrável Rule 3 (extreme honesty) + cycle-implement.md anti-pattern #5 (no breaking changes without notice). One-release deprecation window is the project's idiom (matches v0.4b `Memory.forget(memoryId, options?: ForgetOptions)` widening).

**Alternatives considered:**
- **Remove `themory-mcp` immediately**: REJECTED. Breaks the v0.3 GOAL TEST callers + any external automation. No notice = trust-erosion.
- **Keep `themory-mcp` indefinitely**: REJECTED. Doubles maintenance + confuses new users.
- **Print deprecation warning + DO NOT remove**: REJECTED. Half-measure; deprecation without sunset is theater.

**Consequences:** `package.json` keeps BOTH `themory` and `themory-mcp` entries until 0.2.0. Test T2.2 verifies the regression + the deprecation stderr output. **(EC-27 absorbed)** Alias detection uses `process.argv[1]?.endsWith('themory-mcp')` OR `process.argv[1]?.includes('themory-mcp')` to handle npm exec / npx / direct invocation patterns.

### D10 — File-size budget: each new server file ≤ 500 LoC per `architecture.md § Module hygiene`

**Decision:** Every new file in `src/server/` enforces the 500 LoC budget. Split routes into per-handler files (one file per verb) under `src/server/handlers/`. Aggregate via `src/server/app.ts` (router composition < 100 LoC).

**Rationale:** Mirrors v0.6.1 PgvectorStore split decision (composition over inheritance). Avoids the F-arch-6/F-arch-7 LoC overruns surfaced in v1.1 /review.

**Alternatives considered:**
- **Single `src/server/app.ts` with inline handlers**: REJECTED. Would push past 500 LoC quickly + violate SRP per `architecture.md § Module hygiene`.
- **Per-resource sub-routers (`/memories`, `/scopes`)**: REJECTED. We chose RPC shape (D2), not REST resource — sub-router split doesn't fit.

**Consequences:** 6 handler files (remember/recall/forget/reflect/health/scopes) + 1 app composer + 1 errors + 1 openapi + 1 index = 10 files in `src/server/`. Each ≤ 200 LoC expected; total ~1200 LoC over module.

### D11 — Wiring discipline: REST handlers compose `Memory` factory via DI, NOT new factory

**Decision:** REST server consumes `Memory` instances via DI. `createServer({ memory: Memory, authVerifier?: AuthVerifier }): Hono` is the public factory. Caller wires `createMemory({ ... })` → `createServer({ memory })`. No `createServerWithMemory()` shortcut.

**Rationale:** Single composition pattern over factory proliferation. Honors `architecture.md § 3 (DIP)` — server depends on the `Memory` interface, not on `createMemory`. Caller control over lifecycle (single Memory, single Server, shared pool).

**Alternatives considered:**
- **`createServerWithMemory(config)` shortcut**: REJECTED. Doubles API surface for marginal convenience; obscures the composition.
- **Server owns Memory factory internally**: REJECTED. Violates DIP — server should consume the interface, not own the implementation.
- **CLI-level composition only (no public `createServer` export)**: REJECTED. Locks server consumption to CLI users; cuts off library-mode embed (e.g., consumer wants to mount the REST routes inside their existing Hono app).

**Consequences:** Subpath `@usetheo/memory/server` exports `createServer` + `AuthVerifier` interface + `BearerAuthVerifier` impl. CLI `themory server` is one of the consumers, not the only one.

### D12 — Single scope tier per request (EC-9 absorption) — NEW 2026-06-03

**Decision:** `POST /v1/remember`, `POST /v1/recall`, `POST /v1/forget`, `POST /v1/reflect` accept EXACTLY ONE scope tier per request body: `userId` XOR `sessionId` XOR `agentId` XOR `skillRepoId`. Multiple tiers in same body → 422 `InvalidScope` with `field: "scope"` envelope. Zero tiers → 422 same error. Single tier → handler routes to `memory.user(id)` (or session/agent/skills) accordingly.

**Rationale:** The SDK shape (`memory.user(id)` vs `memory.session(id)` etc.) returns DIFFERENT `ScopedMemory` instances — multi-tier in same call is undefined at the SDK level. Surfacing the constraint at the REST boundary (zod refine) prevents silent semantic confusion. Single-tier requirement matches the 3-tier scope model locked in `architecture.md § 1`.

**Alternatives considered:**
- **Allow multiple tiers; persist into each**: REJECTED. Doubles write surface; not how SDK works; consumer mental model: "memory is one tier OR another, not both".
- **Prioritize one (first declared wins)**: REJECTED. Silent — consumer never knows which tier consumed.
- **Make scope optional, default to `agentId="default"`**: REJECTED. Silently coerces; violates `architecture.md § 8 (validate at boundary)`.

**Consequences:** Zod schema in `src/server/schemas.ts` uses `z.union([userScope, sessionScope, agentScope, skillScope])` with mutually-exclusive refines. OpenAPI spec documents the union shape — consumers see the constraint upfront. RED test in T1.2: `{ userId: "alice", sessionId: "s1", text: "..." }` → 422.

### D13 — Container entrypoint = direct Node binary invocation (NO shell) — NEW 2026-06-03 (EC-47 absorption)

**Decision:** Dockerfile `ENTRYPOINT ["node", "/app/dist/agent-tools/cli.js", "server"]`. `CMD []` empty (subcommand baked into entrypoint). No `docker-entrypoint.sh`. No bash. No `/bin/sh`.

**Rationale:** Distroless `:nonroot` has no shell (per D6). The migrate-then-server discipline (per D8 amended) lives INSIDE the `themory server` subcommand binary, not in a wrapper. ENTRYPOINT direct-Node forwards SIGTERM correctly (no shell PID 1 intermediary that fails to propagate signals). Matches container best practice — Node binary as PID 1.

**Alternatives considered:**
- **Shell entrypoint script (`docker-entrypoint.sh`)**: REJECTED per EC-47. Distroless has no shell.
- **`tini` init system**: REJECTED. Adds ~700KB dep + complexity for zombie-reaping that Node 22 handles natively when PID 1.
- **`s6-overlay`**: REJECTED. Multi-process container philosophy doesn't fit our single-process Node app.
- **`CMD` overridable (require operator to specify subcommand)**: REJECTED. Image not self-contained — operator confusion.

**Consequences:** Container always runs `themory server`. To run `themory migrate` or `themory health` standalone, operator overrides ENTRYPOINT: `docker run --entrypoint node ghcr.io/usetheo/themory:0.1.0-alpha /app/dist/agent-tools/cli.js migrate`. Documented in CHANGELOG `### Added` for v0.1.0-alpha. **(EC-32 absorbed)** Node-as-PID-1 means SIGTERM reaches process directly — `themory server` registers `process.on('SIGTERM', gracefulShutdown)` to close server + pool.

## Dependency Graph

```
Phase 0 — Foundation (deps + AuthVerifier DIP declaration)
   │
   └──▶ Phase 1 — REST API server (Item 16)
            │
            ├── T1.1 BearerAuthVerifier impl (+ EC-1/2/3/4/5)
            ├── T1.2 4-verb handlers (+ EC-6/7/9/10/11/12)
            ├── T1.3 health + scopes pagination (+ EC-13/14/15/16/17)
            ├── T1.4 OpenAPI 3.1 spec (+ EC-18/19/20)
            ├── T1.5 OTel observability (+ EC-21/22)
            ├── T1.6 Domain-error envelope (+ EC-23/24)
            └── T1.7 Subpath export + isolation (+ EC-25/26/52)
                  │
                  └──▶ Phase 2 — CLI consolidado (Item 18)
                           │
                           ├── T2.1 commander scaffold (+ EC-27/28/29)
                           ├── T2.2 themory mcp (+ EC-30 doc)
                           ├── T2.3 themory server (+ EC-31/32/33)
                           ├── T2.4 themory migrate (+ EC-35/36)
                           └── T2.5 themory health (+ EC-37)
                                 │
                                 └──▶ Phase 3 — Docker stack (Item 17)
                                          │
                                          ├── T3.1 Multi-stage Dockerfile (+ EC-38/39/40)
                                          ├── T3.2 docker-compose.prod.yaml (+ EC-41/42)
                                          ├── T3.3 GitHub Actions + Trivy + allowlist (+ EC-43/44)
                                          ├── T3.4 ENTRYPOINT direct Node (per D13; EC-47 absorbed)
                                          └── T3.5 docker-stack E2E test (+ EC-48/49/51)
                                                │
                                                └──▶ Final Phase — Integration Validation
```

Sequential: Phase 0 → 1 → 2 → 3 → Final. Within each phase, tasks may parallelize (T1.1-T1.6 are mostly independent; T2.1-T2.5 share the CLI scaffold and serialize via T2.1).

---

## Phase 0 — Foundation

**Objective:** Add deps + declare 12th DIP. Single task to land the foundation.

### T0.1 — Add 6 deps + declare AuthVerifier DIP

#### Objective
Add Hono + @hono/node-server + commander + @hono/zod-openapi + strip-ansi + @apidevtools/swagger-parser to `package.json`; declare 12th DIP `AuthVerifier` at `src/core/dip/auth-verifier.ts`.

#### Evidence
Research note `.claude/knowledge-base/research/theo-memory-standalone-p0-test-patterns-2026-06-03.md § Summary`. ADR D1, D3, D4. EC-18 absorption: version alignment between `hono` + `@hono/zod-openapi` + `@hono/node-server`.

#### Files to edit
```
package.json — add 6 deps (Rule 9 evaluated per § Dependencies)
src/core/dip/auth-verifier.ts (NEW) — declare AuthVerifier interface
src/core/dip/__tests__/auth-verifier.test-d.ts (NEW) — type tests
src/core/index.ts — re-export AuthVerifier interface
```

#### Tasks
1. Add `hono ^4.6.0`, `@hono/node-server ^1.13.0`, `@hono/zod-openapi ^0.18.0`, `commander ^12.1.0` to `dependencies`.
2. Add `strip-ansi ^7.1.0`, `@apidevtools/swagger-parser ^10.1.1` to `devDependencies`.
3. Run `npm install`; lock versions.
4. Run `/deps-audit theo-memory-standalone-p0` to validate zero new CRITICAL/HIGH CVE.
5. Create `src/core/dip/auth-verifier.ts` with single-method interface.
6. Create type test `src/core/dip/__tests__/auth-verifier.test-d.ts`.
7. Re-export from `src/core/index.ts`.

#### TDD
```
RED:     test-d auth-verifier.test-d.ts — assert AuthVerifier shape
RED:     test('hono + @hono/zod-openapi + @hono/node-server major versions aligned') (EC-18)
GREEN:   create interface + install deps
VERIFY:  npm run typecheck && npm test -- src/core/dip/__tests__/auth-verifier
```

#### Acceptance Criteria
- [ ] `npm install` exits 0
- [ ] `/deps-audit` ≥ PASS_WITH_CAVEATS
- [ ] `npm run typecheck` PASS
- [ ] EC-18: dep version compat smoke test passes
- [ ] Size ≤ 50 LoC per new file

---

## Phase 1 — REST API server (Item 16)

### T1.1 — BearerAuthVerifier impl + bearer middleware (+ EC-1/2/3/4/5)

#### Objective
Implement `BearerAuthVerifier` + Hono middleware. **Absorb 5 ECs**: EC-1 empty/whitespace env fail-closed (per ADR D3 amended); EC-2 lowercase `bearer` accepted; EC-3 token compared verbatim (no trim); EC-4 length-check BEFORE `timingSafeEqual` (prevents RangeError crash); EC-5 env var isolation between tests.

#### Files to edit
```
src/server/auth/bearer-verifier.ts (NEW) — BearerAuthVerifier class
src/server/auth/middleware.ts (NEW) — Hono middleware factory
src/server/auth/__tests__/bearer-verifier.test.ts (NEW)
vitest.contract.config.ts — add src/server/**/__tests__/**/*.test.ts to include
```

#### Deep Dives
- **EC-4 absorption**: `verify(token)` implementation:
  ```ts
  if (token.length !== this.expectedToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.expectedToken));
  ```
  Length-check FIRST — `timingSafeEqual` throws `RangeError` on different-length inputs. Without this guard, auth path crashes 500 instead of clean 401.
- **EC-1 absorption**: env-read helper at module top:
  ```ts
  function readApiKey(): string | undefined {
    const raw = process.env['THEMEMORY_API_KEY'];
    if (raw === undefined) return undefined; // auth disabled
    if (raw.trim() === '') return ''; // fail-closed sentinel
    return raw;
  }
  ```
  Empty/whitespace → returns `''` which makes ALL bearer compares fail → 401 on every request.
- **EC-2 absorption**: scheme parsing:
  ```ts
  const match = /^bearer\s+(.+)$/i.exec(authHeader); // case-insensitive
  ```

#### TDD
```
RED:     test('verify returns true for matching token')
RED:     test('verify returns false for non-matching token')
RED:     test('verify returns false for length-mismatch WITHOUT throwing') (EC-4)
RED:     test('verify uses timingSafeEqual after length check')
RED:     test('readApiKey returns undefined when env unset (auth disabled)')
RED:     test('readApiKey returns empty-string sentinel when env is empty') (EC-1)
RED:     test('readApiKey returns empty-string sentinel when env is whitespace-only') (EC-1)
RED:     test('middleware accepts Authorization: bearer xyz (lowercase prefix)') (EC-2)
RED:     test('middleware accepts Authorization: BEARER xyz (uppercase prefix)') (EC-2)
RED:     test('middleware rejects token with leading/trailing whitespace mismatch') (EC-3)
RED:     test('middleware returns 401 with www-authenticate: Bearer header')
RED:     test('middleware passthrough when THEMEMORY_API_KEY undefined')
RED:     test('middleware fail-closed when THEMEMORY_API_KEY empty') (EC-1)
GREEN:   implement BearerAuthVerifier + middleware
REFACTOR: extract bearerSchemeParse helper if reused
VERIFY:  npm test -- src/server/auth/__tests__/bearer-verifier
```

#### Acceptance Criteria
- [ ] 13 RED tests pass GREEN (3 are EC-1, 2 are EC-2, 1 is EC-3, 2 are EC-4)
- [ ] `BearerAuthVerifier` implements `AuthVerifier` (type-check)
- [ ] `verify()` uses `crypto.timingSafeEqual` AFTER length-check (grep audit)
- [ ] 401 includes `www-authenticate: Bearer` header
- [ ] **EC-5**: tests use `beforeEach` to save + `afterEach` to restore `process.env['THEMEMORY_API_KEY']`
- [ ] JSDoc on `BearerAuthVerifier` constructor documents fail-closed empty-string contract (per D3 amended)
- [ ] Size ≤ 100 LoC per file; lint zero warnings; typecheck zero errors

### T1.2 — REST handlers for 4 verbs (+ EC-6/7/9/10/11/12)

#### Objective
Implement 4 RPC handlers + Hono app composer. **Absorb 6 ECs**: EC-6 malformed JSON → 400; EC-7 empty body → 422; EC-9 single-scope-tier enforcement per ADR D12; EC-10 unmapped errors → 500 envelope; EC-11 empty recall → 200 with `{ results: [] }`; EC-12 `infer: false` propagation documented.

#### Files to edit
```
src/server/handlers/remember.ts (NEW)
src/server/handlers/recall.ts (NEW)
src/server/handlers/forget.ts (NEW)
src/server/handlers/reflect.ts (NEW)
src/server/schemas.ts (NEW) — shared zod schemas incl. single-scope union per D12
src/server/app.ts (NEW) — Hono app composer
src/server/index.ts (NEW) — createServer factory
src/server/__tests__/handlers.test.ts (NEW)
```

#### Deep Dives
- **EC-9 / ADR D12 absorption**: `ScopeSchema = z.union([z.object({userId: z.string().min(1)}).strict(), z.object({sessionId: z.string().min(1)}).strict(), z.object({agentId: z.string().min(1)}).strict(), z.object({skillRepoId: z.string().min(1)}).strict()])`. `strict()` rejects unknown keys → multi-tier requests get clean 422.
- **EC-10**: app.onError(handler) catches everything not mapped by T1.6; returns `{ code: "INTERNAL_ERROR", message: "Internal server error" }` (NO stack).
- **EC-11**: zero-result recall is 200 success, not 404.

#### TDD
```
RED:     test('POST /v1/remember returns 201 with memoryId')
RED:     test('POST /v1/recall returns { results: [...] } shape')
RED:     test('POST /v1/recall empty results returns 200 not 404') (EC-11)
RED:     test('POST /v1/forget returns 204; subsequent recall excludes id')
RED:     test('POST /v1/reflect returns 202 + reflection-job-id')
RED:     test('POST /v1/remember with malformed JSON returns 400') (EC-6)
RED:     test('POST /v1/remember with empty body returns 422') (EC-7)
RED:     test('POST /v1/remember with zero scope tiers returns 422 InvalidScope') (EC-9)
RED:     test('POST /v1/remember with userId AND sessionId returns 422 InvalidScope') (EC-9 / D12)
RED:     test('POST /v1/remember with infer:false bypasses LLM pipeline') (EC-12 doc)
RED:     test('createServer wires middleware when authVerifier provided')
RED:     test('unknown error from Memory throws 500 with sanitized envelope') (EC-10)
GREEN:   implement handlers + app composer + factory + onError
REFACTOR: extract scope-resolver helper
VERIFY:  npm test -- src/server/__tests__/handlers
```

#### Acceptance Criteria
- [ ] 12 RED tests pass GREEN
- [ ] Each handler ≤ 100 LoC; `app.ts` ≤ 150 LoC; `index.ts` ≤ 50 LoC
- [ ] No `any` types
- [ ] Zod `.strict()` on scope union (D12 enforcement)
- [ ] Pass: lint, typecheck

### T1.3 — Health + scopes pagination (+ EC-13/14/15/16/17)

#### Objective
Implement `GET /v1/health` (readiness), `GET /v1/health/db` (liveness with TIMEOUT per EC-17), `GET /v1/scopes/:type/:id/memories?cursor=&limit=` (paginated, BOUNDED per EC-14).

#### Files to edit
```
src/server/handlers/health.ts (NEW)
src/server/handlers/scopes.ts (NEW)
src/server/__tests__/health.test.ts (NEW)
src/server/__tests__/scopes.test.ts (NEW)
```

#### Deep Dives
- **EC-14 absorption**: `limit: z.coerce.number().int().min(1).max(100).default(20)`. Cap at 100 prevents DOS.
- **EC-17 absorption**: `/v1/health/db` wraps `pool.query` in `Promise.race` with 2s timeout:
  ```ts
  await Promise.race([
    pool.query('SELECT 1'),
    new Promise((_, rej) => setTimeout(() => rej(new Error('db_probe_timeout')), 2000)),
  ]);
  ```
- **EC-13**: scope type enum strict `z.enum(['user', 'session', 'agent', 'skill'])` — case-sensitive.
- **EC-15**: cursor opaque base64 — `try { Buffer.from(cursor, 'base64').toString('utf-8') } catch { return c.json({code:"INVALID_CURSOR"}, 400) }`.
- **EC-16 (DOCUMENT)**: no caching on `/v1/health/db` — query-each-time. Acceptable for low-frequency probes.

#### TDD
```
RED:     test('GET /v1/health returns { status: "ok" }')
RED:     test('GET /v1/health/db returns 200 when pool query succeeds')
RED:     test('GET /v1/health/db returns 503 when pool query throws')
RED:     test('GET /v1/health/db returns 503 within 2s when pool query hangs') (EC-17)
RED:     test('GET /v1/scopes/user/alice/memories returns paginated results')
RED:     test('GET /v1/scopes/User/alice/memories returns 404 (case-sensitive)') (EC-13)
RED:     test('GET /v1/scopes/user/alice/memories?limit=999 returns 422 (capped at 100)') (EC-14)
RED:     test('GET /v1/scopes/user/alice/memories?cursor=invalid returns 400') (EC-15)
GREEN:   implement health + scopes handlers with timeout + cap + cursor parse
REFACTOR: extract pgPing helper with timeout
VERIFY:  npm test -- src/server/__tests__/{health,scopes}
```

#### Acceptance Criteria
- [ ] 8 RED tests pass GREEN
- [ ] EC-17 timeout proven via mock hung pool
- [ ] EC-14 max-100 enforced via zod refine
- [ ] Pass: size, lint, typecheck

### T1.4 — OpenAPI 3.1 spec auto-generation (+ EC-18/19/20)

#### Objective
Wire `@hono/zod-openapi` to auto-derive OpenAPI 3.1 spec. **Absorb 3 ECs**: EC-18 dep version alignment (T0.1 covers); EC-19 spec endpoint auth-exempt; EC-20 circular schemas documented as out-of-scope.

#### Files to edit
```
src/server/openapi.ts (NEW)
src/server/handlers/*.ts — migrate to RouteConfig pattern
src/server/__tests__/openapi.test.ts (NEW)
src/server/app.ts — order middleware: openapi route BEFORE bearer middleware (EC-19)
```

#### Deep Dives
- **EC-19 absorption**: register openapi spec route BEFORE bearer middleware in `app.ts`. Hono router order matters — first match wins. `GET /v1/openapi.json` registers without `app.use(bearerAuth)`.
- **EC-20 (DOCUMENT)**: zod circular schemas (e.g., `MemoryItem.derivedFrom: MemoryItem[]`) NOT used in v0.0 contract; ADR Consequence notes the limitation if ever introduced.

#### TDD
```
RED:     test('GET /v1/openapi.json returns valid OpenAPI 3.1 schema (swagger-parser validates)')
RED:     test('GET /v1/openapi.json accessible WITHOUT bearer token even when THEMEMORY_API_KEY set') (EC-19)
RED:     test('openapi spec lists all 6 operations with stable operationId')
RED:     test('openapi spec advertises license MIT')
GREEN:   implement OpenAPIHono + RouteConfig migration + middleware order
REFACTOR: extract shared zod fragments to schemas.ts
VERIFY:  npm test -- src/server/__tests__/openapi
```

#### Acceptance Criteria
- [ ] 4 RED tests pass GREEN
- [ ] EC-19 confirmed via test with bearer set + 200 on openapi endpoint
- [ ] swagger-parser validation exits 0
- [ ] Spec license = MIT
- [ ] Pass: size, lint, typecheck

### T1.5 — OTel span observability per handler (+ EC-21/22)

#### Objective
Wrap each handler in an OTel span. **Absorb 2 ECs**: EC-21 production TracerProvider documented as consumer-wired; EC-22 exporter failures swallowed silently.

#### Files to edit
```
src/server/observability/otel-middleware.ts (NEW)
src/server/__tests__/otel.test.ts (NEW)
```

#### Deep Dives
- **EC-22 absorption**: middleware try/catches span operations:
  ```ts
  try { span.setAttribute(...); span.end(); } catch { /* swallow — don't break request */ }
  ```
- **EC-21 (DOCUMENT)**: middleware is no-op when no TracerProvider registered (OTel default). Consumer wires their own (Vercel OTel, Grafana, Honeycomb, etc.).

#### TDD
```
RED:     test('POST /v1/remember emits span name rest.v1.remember')
RED:     test('span includes http.status_code attribute')
RED:     test('5xx errors mark span status ERROR')
RED:     test('handler returns 201 even when OTel exporter throws synchronously') (EC-22)
GREEN:   implement otel-middleware with try/catch around span ops
REFACTOR: none
VERIFY:  npm test -- src/server/__tests__/otel
```

#### Acceptance Criteria
- [ ] 4 RED tests pass GREEN
- [ ] In-memory exporter records ≥ 1 span per integration test
- [ ] Mock-throwing exporter doesn't break request
- [ ] **Runtime-metric proof**: span count > 0 in `tests/integration/rest-api.test.ts`

### T1.6 — Domain-error envelope (+ EC-23/24)

#### Objective
Map domain errors to HTTP. **Absorb 2 ECs**: EC-23 pg lib errors mapped to 500 sanitized; EC-24 error message sanitization (no PII/secret leak).

#### Files to edit
```
src/server/errors.ts (NEW)
src/server/__tests__/errors.test.ts (NEW)
```

#### Deep Dives
- **EC-23 absorption**: `mapDomainErrorToResponse` switch with default case checking `err.constructor.name`. pg errors (`error: relation X does not exist`) → 500 with envelope `{ code: "INTERNAL_ERROR", message: "Database error" }`. Original `err.message` logged via `console.error` (NOT returned in body).
- **EC-24 absorption**: secret-pattern regex `/Bearer\s+\S+/g` redacts before logging + envelope generation.

#### TDD
```
RED:     test('InvalidScope error returns 422 with code: INVALID_SCOPE')
RED:     test('MemoryNotFound error returns 404')
RED:     test('Unknown error returns 500 without stack trace in body')
RED:     test('pg error message NOT echoed in response body') (EC-23)
RED:     test('Error envelope shape: { code, message, field? }')
RED:     test('Bearer token in error.message is redacted before logging') (EC-24)
GREEN:   implement mapDomainErrorToResponse + wire app.onError
REFACTOR: none
VERIFY:  npm test -- src/server/__tests__/errors
```

#### Acceptance Criteria
- [ ] 6 RED tests pass GREEN
- [ ] No raw stack trace in body (grep audit)
- [ ] No bearer token leak in logs (grep audit)
- [ ] Pass: size, lint, typecheck

### T1.7 — Subpath export + isolation (+ EC-25/26/52)

#### Objective
Expose `@usetheo/memory/server` subpath. **Absorb 3 ECs**: EC-25 ESM-only documented; EC-26 default import does NOT pull Hono (tree-shaking isolation); EC-52 npm pack manifest includes server files.

#### Files to edit
```
package.json — add "./server" subpath + verify "files" whitelist
tsconfig.contract.json — add src/server/** to include
vitest.contract.config.ts — verify src/server/** include (added T1.1)
README.md — add "REST API server" section
CHANGELOG.md — [Unreleased] ### Added Phase 1 entries
tests/integration/subpath-isolation.test.ts (NEW) — EC-26 test
```

#### Deep Dives
- **EC-26 absorption**: integration test creates a fake consumer that ONLY imports default `@usetheo/memory`; uses Node `--experimental-vm-modules` + esbuild to bundle; asserts bundle string does NOT contain `hono` package name. Cheap defense against accidental cross-imports.
- **EC-52 absorption**: `npm pack --dry-run` listing must include `src/server/index.ts` + `src/server/handlers/*.ts` + `src/server/auth/*.ts`. Test asserts via parsing pack output.
- **EC-25 (DOCUMENT)**: subpath is ESM-only — matches `"type": "module"` package.json. CJS consumers receive clear error message. README documents requirement.

#### TDD
```
RED:     test('@usetheo/memory/server resolves to createServer factory in typecheck') (EC-25)
RED:     test('default @usetheo/memory bundle does NOT contain hono') (EC-26)
RED:     test('npm pack --dry-run output contains src/server/index.ts') (EC-52)
RED:     test('npm pack --dry-run output contains src/server/handlers/remember.ts') (EC-52)
GREEN:   exports + tsconfig include + verify files whitelist
REFACTOR: none
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] 4 RED tests pass GREEN
- [ ] EC-26 bundle isolation test passes
- [ ] EC-52 pack manifest test passes
- [ ] CHANGELOG entry written
- [ ] README updated with REST API section
- [ ] Pass: lint, typecheck

---

## Phase 2 — CLI consolidado (Item 18)

### T2.1 — commander scaffold + alias (+ EC-27/28/29)

#### Objective
Rewrite `src/agent-tools/cli.ts` as commander multi-subcommand router. **Absorb 3 ECs**: EC-27 alias detection robust across npm exec/npx/direct; EC-28 npm install creates both bins; EC-29 argv mutation sequence documented.

#### Files to edit
```
src/agent-tools/cli.ts — REWRITE as commander entry
src/agent-tools/__tests__/cli.test.ts (NEW)
package.json — bin: { themory, themory-mcp }
tests/integration/cli-consolidated.test.ts (NEW)
```

#### Deep Dives
- **EC-27 absorption**: alias detection uses regex `/themory-mcp(\.js)?$/` on `process.argv[1]` — handles npm exec wrapper paths, npx temp paths, direct invocations.
- **EC-29 (DOCUMENT)**: argv mutation `process.argv.splice(2, 0, 'mcp')` documented in JSDoc on entry function. Subsequent code reads argv as if user typed `themory mcp`.

#### TDD
```
RED:     test('themory --help lists exactly 4 subcommands') (EC pattern)
RED:     test('themory-mcp alias detected via direct path basename') (EC-27)
RED:     test('themory-mcp alias detected via npm exec wrapper') (EC-27)
RED:     test('themory-mcp alias emits DEPRECATED warning to stderr')
RED:     test('themory-mcp alias still runs MCP server (v0.3 regression)')
RED:     test('package.json bin lists BOTH themory and themory-mcp entries') (EC-28)
GREEN:   implement commander scaffold + alias detection
VERIFY:  npm test -- tests/integration/cli-consolidated -t scaffold
```

#### Acceptance Criteria
- [ ] 6 RED tests pass GREEN
- [ ] v0.3 `tests/e2e/agent-tools/round-trip.test.ts` PASS (regression)
- [ ] Pass: size (cli.ts ≤ 200 LoC due to absorbed ECs), lint, typecheck

### T2.2 — themory mcp wired

#### Objective
Wire `themory mcp` subcommand with options. EC-30 (Windows stdio) documented as out-of-P0-scope.

#### Files to edit
```
src/agent-tools/cli.ts — flesh out .command('mcp')
tests/integration/cli-consolidated.test.ts — add mcp tests
```

#### TDD
```
RED:     test('themory mcp --transport stdio starts MCP server')
RED:     test('themory mcp --transport streamable-http --port 8081 binds HTTP')
GREEN:   wire subcommand
VERIFY:  npm test -- tests/integration/cli-consolidated -t mcp
```

#### Acceptance Criteria
- [ ] 2 RED tests pass GREEN
- [ ] v0.3 regression still passes
- [ ] EC-30: README notes Linux/macOS tested; Windows out-of-P0-scope

### T2.3 — themory server (+ EC-31/32/33 + ADR D8 inline)

#### Objective
Wire `themory server` subcommand. **Absorb 3 ECs**: EC-31 EADDRINUSE clear stderr; EC-32 SIGTERM graceful shutdown; EC-33 readiness gate while Memory factory warms up. **Implements ADR D8 amended: invokes `runMigrations()` BEFORE binding port** (replaces deleted docker-entrypoint.sh per EC-47 / D13).

#### Files to edit
```
src/agent-tools/cli.ts — flesh out .command('server') action
tests/integration/cli-consolidated.test.ts — add server tests
```

#### Deep Dives
- **EC-32 + ADR D13 absorption**: `themory server` action:
  ```ts
  const server = serve({ fetch: app.fetch, port }, ({ port }) => { console.log(`listening ${port}`) });
  process.on('SIGTERM', async () => {
    server.close();
    await pool.end();
    process.exit(0);
  });
  process.on('SIGINT', /* same */);
  ```
- **D8 absorption (migrate-on-startup)**: action sequence: create pool → `if (!process.env['THEMEMORY_SKIP_MIGRATIONS']) await runMigrations(pool)` → create Memory factory → create AuthVerifier → `createServer({ memory, authVerifier })` → bind port.
- **EC-33 absorption**: while Memory factory warming, `/v1/health` returns 503. Factory completes → readiness flag set → 200. Avoids "container says healthy but Memory not ready" race.
- **EC-31 absorption**: try/catch around `serve()`; on `EADDRINUSE`, stderr `Port ${port} already in use` + exit 1.

#### TDD
```
RED:     test('themory server --port 9999 starts REST server')
RED:     test('themory server runs migrations BEFORE binding port (D8)') 
RED:     test('themory server skips migrations when THEMEMORY_SKIP_MIGRATIONS=true (escape hatch)')
RED:     test('themory server --port <held> exits 1 with stderr EADDRINUSE message') (EC-31)
RED:     test('themory server SIGTERM closes server + pool before exit 0') (EC-32)
RED:     test('themory server /v1/health returns 503 while Memory factory loading') (EC-33)
RED:     test('themory server fails fast with exit 1 when DB unreachable')
GREEN:   wire server subcommand with migrations + signal handlers + readiness gate
REFACTOR: extract migration runner if reused by T2.4
VERIFY:  npm test -- tests/integration/cli-consolidated -t server
```

#### Acceptance Criteria
- [ ] 7 RED tests pass GREEN
- [ ] EC-32: SIGTERM closes pool (no zombie connections)
- [ ] EC-31: EADDRINUSE detected + clean error
- [ ] EC-33: 503-then-200 transition observable
- [ ] D8: migrations applied before port bind (regression test against fresh DB)
- [ ] Pass: lint, typecheck

### T2.4 — themory migrate (+ EC-35/36)

#### Objective
Wire `themory migrate`. **Absorb 2 ECs**: EC-35 drizzle tx-per-migration documented; EC-36 concurrent migrate safe via drizzle's advisory lock.

#### Files to edit
```
src/agent-tools/cli.ts — flesh out .command('migrate')
tests/integration/cli-consolidated.test.ts — add migrate tests
```

#### TDD
```
RED:     test('themory migrate applies pending Drizzle migrations against fresh DB')
RED:     test('themory migrate idempotent: second invocation no-op')
RED:     test('themory migrate concurrent invocations safe — second is no-op') (EC-36)
GREEN:   wire migrate subcommand
VERIFY:  npm test -- tests/integration/cli-consolidated -t migrate
```

#### Acceptance Criteria
- [ ] 3 RED tests pass GREEN
- [ ] EC-35: README notes drizzle wraps each migration in tx by default
- [ ] EC-36: concurrent test confirms drizzle journal-lock behavior

### T2.5 — themory health (+ EC-37 concrete DI checks)

#### Objective
Wire `themory health`. **Absorb EC-37**: concrete DI graph checks defined — mandatory checks (pool.query + Memory factory) + optional deep checks (embedder/LLM ping behind `--deep` flag).

#### Files to edit
```
src/agent-tools/cli.ts — flesh out .command('health') with --deep flag
tests/integration/cli-consolidated.test.ts — add health tests
```

#### Deep Dives
- **EC-37 absorption**: `themory health` checks:
  1. **Mandatory**: `pool.query('SELECT 1')` with 2s timeout → fail → exit 1
  2. **Mandatory**: `createMemory({...})` composes without throw → fail → exit 1
  3. **Optional (--deep)**: embedder.embed("ping") + llm.chat([{role:"user", content:"ok"}]) — adds latency + LLM cost; off by default.

#### TDD
```
RED:     test('themory health: valid DB URI + composable Memory → exit 0')
RED:     test('themory health: invalid DB URI → exit 1 with stderr')
RED:     test('themory health: Memory factory throws → exit 1 with stderr mention factory failure')
RED:     test('themory health --deep: pings embedder + llm → exit 0 on success')
RED:     test('themory health --deep: embedder failure → exit 1 + stderr')
GREEN:   wire health subcommand with --deep flag
VERIFY:  npm test -- tests/integration/cli-consolidated -t health
```

#### Acceptance Criteria
- [ ] 5 RED tests pass GREEN
- [ ] Mandatory checks documented in JSDoc + README
- [ ] `--deep` flag tested in both pass + fail paths
- [ ] CHANGELOG `[Unreleased]` updated with Phase 2 entries

---

## Phase 3 — Docker stack (Item 17)

### T3.1 — Multi-stage Dockerfile (+ EC-38/39/40)

#### Objective
Author multi-stage Dockerfile per ADR D6 (amended). **Absorb 3 ECs**: EC-38 distroless + native deps (glibc check); EC-39 optional deps included for now (DOCUMENT); EC-40 docker build proves tsc passes.

#### Files to edit
```
Dockerfile (NEW)
.dockerignore (NEW)
```

#### Deep Dives
- **EC-38**: distroless `:nonroot` uses glibc (Debian 12 base). Native deps (`@xenova/transformers` ONNX runtime, `natural` BM25 lib) require glibc → compatible. Smoke check at T3.5 via runtime load.
- **EC-39 (DOCUMENT)**: production image includes optional deps (~30MB bloat from `@xenova/transformers`). Acceptable for alpha; consumer can pass `OPTIONAL_DEPS=false` env in P1 to skip.

#### Acceptance Criteria
- [ ] `docker build -t themory:dev .` succeeds locally
- [ ] Final image < 200MB
- [ ] Image runs as `nonroot` user
- [ ] EC-40: build stage runs `npm run build` (tsc) — failure aborts build
- [ ] No shell present in runtime image (grep `which sh` returns nothing — EC-47 verification)

### T3.2 — Production docker-compose.prod.yaml (+ EC-41/42)

#### Objective
Author production-flavored compose. **Absorb 2 ECs**: EC-41 `--wait-timeout` documented; EC-42 `${VERSION:-latest}` defaults validate.

#### Files to edit
```
docker-compose.prod.yaml (NEW)
```

#### TDD
```
RED:     test('docker compose -f docker-compose.prod.yaml config (no VERSION env) validates') (EC-42)
GREEN:   write compose file with sensible defaults
VERIFY:  docker compose config exits 0
```

#### Acceptance Criteria
- [ ] Compose YAML valid
- [ ] Local boot: both services healthy within 60s (with operator using `docker compose up --wait --wait-timeout 60` per EC-41 doc)

### T3.3 — GitHub Actions + GHCR build + Trivy + allowlist (+ EC-43/44)

#### Objective
GitHub Actions workflow. **Absorb 2 ECs**: EC-43 Trivy gate aligned with `deps-audit-golden-rule.md` severity rubric + `.trivyignore` allowlist; EC-44 workflow declares `packages: write` permission.

#### Files to edit
```
.github/workflows/docker-publish.yml (NEW)
.trivyignore (NEW) — sunset-dated entries (mirror deps-audit-allowlist.txt format)
```

#### Deep Dives
- **EC-43 absorption**: Trivy step `trivy image --severity CRITICAL,HIGH --ignorefile .trivyignore --exit-code 1`. `.trivyignore` file format: `CVE-ID|REASON|SUNSET-DATE` (mirrors `deps-audit-allowlist.txt`). Empty file at v0.1; entries added with sunset ≤ 30 days for CRITICAL, ≤ 60 days for HIGH per golden rule.
- **EC-44 absorption**: workflow `permissions: { contents: read, packages: write }` declared at job level.

#### TDD
```
RED:     test('workflow YAML declares permissions: packages: write') (EC-44 static check)
RED:     test('.trivyignore file exists with valid format (or empty at v0.1)') (EC-43)
GREEN:   author workflow + .trivyignore
VERIFY:  actionlint .github/workflows/docker-publish.yml && yamllint .trivyignore
```

#### Acceptance Criteria
- [ ] Workflow YAML valid (actionlint)
- [ ] `.trivyignore` committed (empty acceptable at v0.1)
- [ ] EC-43 Trivy severity rubric matches `deps-audit-golden-rule.md`
- [ ] EC-44 permissions declared

### T3.4 — ENTRYPOINT direct Node binary (NO shell) per ADR D13

#### Objective
**EC-47 absorption (BLOCKER resolved via Opção A).** Dockerfile `ENTRYPOINT ["node", "/app/dist/agent-tools/cli.js", "server"]`. No `docker-entrypoint.sh`. Migrations-on-startup discipline lives inside `themory server` binary per T2.3 + ADR D8 amended.

#### Files to edit
```
Dockerfile — set ENTRYPOINT to direct Node invocation per D13
```

(NO `docker-entrypoint.sh` file shipped — explicitly removed from v1.0 plan.)

#### Deep Dives
- **EC-47 / ADR D13 absorption**: container always runs `themory server`. Operator override for migrate/health standalone:
  ```
  docker run --entrypoint node ghcr.io/usetheo/themory:0.1.0-alpha /app/dist/agent-tools/cli.js migrate
  docker run --entrypoint node ghcr.io/usetheo/themory:0.1.0-alpha /app/dist/agent-tools/cli.js health
  ```
  Documented in README + CHANGELOG.
- **EC-45/46 (DOCUMENT)**: Node-as-PID-1 receives signals natively; no shell intermediary to lose SIGTERM. EC-45/46 originally about `exec` signal forwarding — irrelevant once shell is eliminated.

#### Acceptance Criteria
- [ ] ENTRYPOINT in Dockerfile matches D13 exactly
- [ ] CMD empty
- [ ] No docker-entrypoint.sh in repo
- [ ] README documents `--entrypoint` override pattern for migrate/health
- [ ] CHANGELOG `### Added` documents ENTRYPOINT shape

### T3.5 — THE GOAL TEST docker-stack (+ EC-48/49/51)

#### Objective
Integration test E2E. **Absorb 3 ECs**: EC-48 unique compose project name; EC-49 localhost port doc; EC-51 timeout configurable.

#### Files to edit
```
tests/integration/docker-stack.test.ts (NEW) — gated on DOCKER_INTEGRATION=true
```

#### Deep Dives
- **EC-48 absorption**: `const projectName = `themory-test-${randomUUID().slice(0, 8)}`; spawnSync('docker', ['compose', '-p', projectName, 'up', '-d'])`. afterAll uses same project name; no cross-run leak.
- **EC-49 (DOCUMENT)**: test uses port 8080 by default; developer running locally with another service on 8080 sets `THEMORY_TEST_PORT=8081`.
- **EC-51 absorption**: `const timeoutMs = parseInt(process.env['DOCKER_HEALTH_TIMEOUT_MS'] ?? '60000', 10);` — default 60s, CI matrix can extend.

#### TDD
```
RED:     test('docker compose up brings app + pgvector healthy within timeout') (Pattern P4 + EC-51)
RED:     test('POST /v1/remember + POST /v1/recall round-trip against compose') (THE GOAL METRIC)
RED:     test('image runs migrations on startup (D8 + EC-47 absorbed)')
RED:     test('GET /v1/health/db pings pgvector successfully (with 2s timeout per EC-17)')
RED:     test('compose project name unique per test run — no cross-run state') (EC-48)
RED:     test('image runs as nonroot user (D6 + EC-47 verification)')
GREEN:   implement integration test
REFACTOR: extract health-poll + compose-spawn helpers to tests/integration/helpers/docker-compose.ts
VERIFY:  DOCKER_INTEGRATION=true npm test -- tests/integration/docker-stack
```

#### Acceptance Criteria
- [ ] 6 RED tests pass GREEN
- [ ] **THE GOAL METRIC observed**: round-trip PASS recorded
- [ ] EC-48 unique project name confirmed
- [ ] EC-51 timeout honored
- [ ] No shell in image (EC-47 verification: `docker run --rm <image> /bin/sh` exits non-zero "exec format error" — confirms distroless integrity)

---

## Coverage Matrix

### Original v1.0 gaps (36 rows preserved)

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | 12th DIP AuthVerifier declared | T0.1 | Interface at src/core/dip/auth-verifier.ts |
| 2 | Hono REST framework adopted | T0.1 + ADR D1 | hono ^4.6.0 in deps |
| 3 | commander CLI lib adopted | T0.1 + ADR D4 | commander ^12.1.0 in deps |
| 4 | OpenAPI auto-gen via zod-openapi | T0.1 + T1.4 + ADR D6 | @hono/zod-openapi ^0.18 |
| 5 | BearerAuthVerifier impl | T1.1 + ADR D3 | src/server/auth/bearer-verifier.ts |
| 6 | Bearer middleware | T1.1 | src/server/auth/middleware.ts |
| 7 | POST /v1/remember | T1.2 | src/server/handlers/remember.ts |
| 8 | POST /v1/recall | T1.2 | src/server/handlers/recall.ts |
| 9 | POST /v1/forget | T1.2 | src/server/handlers/forget.ts |
| 10 | POST /v1/reflect | T1.2 | src/server/handlers/reflect.ts |
| 11 | createServer factory | T1.2 + ADR D11 | src/server/index.ts |
| 12 | GET /v1/health + /v1/health/db | T1.3 | src/server/handlers/health.ts |
| 13 | GET /v1/scopes pagination | T1.3 | src/server/handlers/scopes.ts |
| 14 | OpenAPI 3.1 spec | T1.4 | src/server/openapi.ts |
| 15 | OTel spans per handler | T1.5 | src/server/observability/otel-middleware.ts |
| 16 | Domain-error envelope | T1.6 | src/server/errors.ts |
| 17 | Subpath @usetheo/memory/server | T1.7 | package.json#exports |
| 18 | tsconfig + vitest include src/server/** | T1.1 + T1.7 | config updates |
| 19 | themory CLI scaffold | T2.1 | src/agent-tools/cli.ts rewrite |
| 20 | themory-mcp alias + deprecation | T2.1 + ADR D9 | alias detection + stderr |
| 21 | themory mcp | T2.2 | runMcpServer() wired |
| 22 | themory server | T2.3 + ADR D8 | createServer() wired + migrate-on-startup |
| 23 | themory migrate | T2.4 | runMigrations() wrapper |
| 24 | themory health | T2.5 | DB + DI graph check |
| 25 | Multi-stage Dockerfile distroless | T3.1 + ADR D6 | Dockerfile |
| 26 | docker-compose.prod.yaml | T3.2 | compose file |
| 27 | GHCR build + Trivy | T3.3 + ADR D7 | workflow + allowlist |
| 28 | ENTRYPOINT direct Node (per EC-47/D13) | T3.4 + ADR D13 | Dockerfile ENTRYPOINT |
| 29 | docker-stack E2E goal test | T3.5 | tests/integration/docker-stack.test.ts |
| 30 | T16-RED-1..13 REST tests | T1.1-T1.7 | distributed |
| 31 | T17-RED-1..5 Docker tests | T3.1-T3.5 | distributed |
| 32 | T18-RED-1..8 CLI tests | T2.1-T2.5 | distributed |
| 33 | v0.3 GOAL TEST regression | T2.1 | alias detection + runMcpServer extraction |
| 34 | CHANGELOG entries | T1.7 + T2.5 + Final | Inquebrável Rule 6 |
| 35 | README REST API section | T1.7 | Planned API contract |
| 36 | /deps-audit clean | T0.1 | Rule 9 evaluation in § Dependencies |

### v1.1 absorption rows (49 new entries — 12 MUST FIX + 25 SHOULD TEST + 12 DOCUMENT)

| # | EC | Task(s) | Class | Resolution |
|---|---|---|---|---|
| 37 | EC-1 empty/whitespace THEMEMORY_API_KEY fail-closed | T1.1 + ADR D3 amend | MUST FIX | readApiKey() sentinel + RED test |
| 38 | EC-2 lowercase "bearer" prefix accepted | T1.1 + ADR D3 amend | SHOULD TEST | regex case-insensitive + RED test |
| 39 | EC-3 token compared verbatim (no trim) | T1.1 + ADR D3 amend | SHOULD TEST | docs + RED test |
| 40 | EC-4 timingSafeEqual length-check first | T1.1 | MUST FIX | length check before crypto + RED test |
| 41 | EC-5 env var isolation between tests | T1.1 | SHOULD TEST | beforeEach/afterEach env save/restore |
| 42 | EC-6 malformed JSON 400 | T1.2 | SHOULD TEST | Hono default + RED test |
| 43 | EC-7 empty body 422 | T1.2 | SHOULD TEST | zod refine + RED test |
| 44 | EC-8 body size limit Hono default | T1.2 | DOCUMENT | ADR D2 Consequence |
| 45 | EC-9 single scope tier per request | T1.2 + ADR D12 NEW | MUST FIX | zod union strict + RED test |
| 46 | EC-10 unmapped error 500 envelope | T1.2 + T1.6 | SHOULD TEST | app.onError + RED test |
| 47 | EC-11 empty recall 200 not 404 | T1.2 | SHOULD TEST | RED test |
| 48 | EC-12 infer:false propagation | T1.2 | DOCUMENT | RED test + JSDoc |
| 49 | EC-13 scope type case-sensitive | T1.3 | SHOULD TEST | zod enum + RED test |
| 50 | EC-14 pagination limit cap at 100 | T1.3 | MUST FIX | zod.max(100) + RED test |
| 51 | EC-15 cursor format invalid 400 | T1.3 | SHOULD TEST | base64 try/catch + RED test |
| 52 | EC-16 /v1/health/db no caching | T1.3 | DOCUMENT | ADR Consequence |
| 53 | EC-17 /v1/health/db 2s timeout | T1.3 | MUST FIX | Promise.race + RED test |
| 54 | EC-18 hono + zod-openapi version aligned | T0.1 | SHOULD TEST | dep smoke test |
| 55 | EC-19 OpenAPI spec auth-exempt | T1.4 | MUST FIX | middleware order + RED test |
| 56 | EC-20 circular zod schema none in v0.0 | T1.4 | DOCUMENT | ADR Consequence |
| 57 | EC-21 production TracerProvider consumer-wired | T1.5 | DOCUMENT | ADR Consequence |
| 58 | EC-22 OTel exporter failure swallowed | T1.5 | SHOULD TEST | try/catch in middleware + RED test |
| 59 | EC-23 pg lib error mapped to 500 sanitized | T1.6 | SHOULD TEST | default case in error mapper + RED test |
| 60 | EC-24 error message no PII/secret leak | T1.6 | SHOULD TEST | redaction regex + RED test |
| 61 | EC-25 subpath ESM-only documented | T1.7 | SHOULD TEST | RED test + README note |
| 62 | EC-26 default import does NOT pull Hono | T1.7 | MUST FIX | bundle isolation test + RED test |
| 63 | EC-27 alias detection multi-pattern | T2.1 | SHOULD TEST | regex + RED tests |
| 64 | EC-28 npm install creates both bins | T2.1 | SHOULD TEST | package.json bin manifest test |
| 65 | EC-29 argv mutation sequence documented | T2.1 | DOCUMENT | JSDoc |
| 66 | EC-30 Windows stdio out-of-P0 | T2.2 | DOCUMENT | README note |
| 67 | EC-31 EADDRINUSE clear stderr | T2.3 | SHOULD TEST | try/catch + RED test |
| 68 | EC-32 SIGTERM graceful shutdown | T2.3 + ADR D13 | MUST FIX | signal handler + RED test |
| 69 | EC-33 readiness gate Memory factory | T2.3 | SHOULD TEST | flag + RED test |
| 70 | EC-35 drizzle tx-per-migration | T2.4 | DOCUMENT | ADR Consequence |
| 71 | EC-36 concurrent migrate safe | T2.4 | SHOULD TEST | RED test |
| 72 | EC-37 DI graph concrete checks | T2.5 | MUST FIX | mandatory + --deep flag |
| 73 | EC-38 distroless + native deps glibc | T3.1 + T3.5 | SHOULD TEST | runtime smoke check |
| 74 | EC-39 production image includes optional deps | T3.1 | DOCUMENT | ADR D6 Consequence |
| 75 | EC-40 docker build runs tsc | T3.1 | SHOULD TEST | build stage RUN command |
| 76 | EC-41 docker compose --wait-timeout doc | T3.2 | DOCUMENT | compose comment + README |
| 77 | EC-42 compose ${VERSION:-latest} validates | T3.2 | SHOULD TEST | docker compose config exit 0 |
| 78 | EC-43 Trivy severity + allowlist | T3.3 + ADR D7 amend | MUST FIX | .trivyignore file + workflow flag |
| 79 | EC-44 workflow packages:write permission | T3.3 | SHOULD TEST | static YAML check |
| 80 | EC-45/46 exec signal forwarding (post-EC-47) | T3.4 | DOCUMENT | Node-as-PID-1 docs |
| 81 | EC-47 distroless no shell — ENTRYPOINT direct Node (Opção A) | T3.4 + ADR D13 NEW + ADR D6/D8 amend | MUST FIX (BLOCKER) | Dockerfile ENTRYPOINT array |
| 82 | EC-48 unique compose project name | T3.5 + ADR D5 amend | SHOULD TEST | randomUUID + RED test |
| 83 | EC-49 localhost port doc | T3.5 | DOCUMENT | env var override |
| 84 | EC-51 docker health timeout configurable | T3.5 | SHOULD TEST | env var + RED test |
| 85 | EC-52 npm pack manifest includes server files | T1.7 | MUST FIX | pack --dry-run test + RED test |

**Coverage: 85/85 gaps covered (100%)** — original 36 + 49 EC absorptions

## Global Definition of Done

- [ ] All phases completed (Phase 0 → 1 → 2 → 3 → Final)
- [ ] All tests passing — `npm test` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected per `architecture.md § Module hygiene` (≤ 500 LoC; target ≤ 200 LoC per handler per ADR D10)
- [ ] CHANGELOG.md `[Unreleased]` updated with Phase 1/2/3 entries (Inquebrável Rule 6)
- [ ] Backward compatibility: `tests/e2e/agent-tools/round-trip.test.ts` (v0.3) PASS via `themory mcp` AND `themory-mcp` alias paths
- [ ] No new public exports from `src/index.ts` (server lives at subpath `@usetheo/memory/server` per ADR D11)
- [ ] Plan-specific criterion 1: 12th DIP AuthVerifier declared + impl wired + tested
- [ ] Plan-specific criterion 2: THE GOAL TEST `tests/integration/docker-stack.test.ts` 6/6 PASS with `DOCKER_INTEGRATION=true`
- [ ] Plan-specific criterion 3: `@usetheo/memory/server` subpath import resolves cleanly
- [ ] Plan-specific criterion 4: `themory --help` lists exactly 4 subcommands
- [ ] Plan-specific criterion 5: `/deps-audit theo-memory-standalone-p0` returns ≥ PASS_WITH_CAVEATS
- [ ] **EC absorption tracking**: All 12 MUST FIX absorbed (EC-1, EC-4, EC-9, EC-14, EC-17, EC-19, EC-26, EC-32, EC-37, EC-43, EC-47, EC-52); All 25 SHOULD TEST absorbed as RED tests; All 12 DOCUMENT absorbed in ADR Consequences / AC notes
- [ ] **EC-47 verification**: image has NO shell — `docker run --rm <image> /bin/sh -c "echo hi"` fails with "exec format error" or equivalent
- [ ] **EC-32 verification**: SIGTERM-during-in-flight-request closes server + pool cleanly (no half-written rows in pgvector)
- [ ] **EC-26 verification**: bundle isolation test passes (default import does not contain "hono")
- [ ] **Runtime-metric proof**: OTel span count > 0 in `tests/integration/rest-api.test.ts`
- [ ] **Plan archived** after `/review` returns READY_TO_MERGE_WITH_CAVEATS AND PR merged

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phase 0/1/2/3 complete. Plan NOT done until this passes.

### Execution

```bash
npm test
npm run test:coverage
npm run typecheck
npm run lint

DOCKER_INTEGRATION=true THEOMEM_PG_URI=postgresql://postgres:postgres@localhost:5432/postgres npm test -- tests/integration/docker-stack
THEOMEM_PG_URI=postgresql://postgres:postgres@localhost:5432/postgres npm test -- tests/integration/cli-consolidated
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Coverage ≥ 90% on changed files; critical paths (auth, handlers, errors) 100%
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] **Runtime-metric proof**: span count > 0
- [ ] **THE GOAL TEST**: 6/6 PASS
- [ ] **EC-47 honesty check**: distroless image has no shell (verified via runtime test)
- [ ] **EC-32 honesty check**: SIGTERM observed via test before exit 0

### If Validation Fails

1. Identify plan-caused vs pre-existing failures
2. Pre-existing logged for separate triage; does NOT block plan
3. Plan-caused: fix; re-run
4. 3 implementation attempts on same task → BLOCKED per cycle-implement Stop Condition #1

### Handoff to `/review`

When validation PASSes: report at `.claude/knowledge-base/reviews/theo-memory-standalone-p0-implement-validate-{date}.md`. Plan ready for `/review theo-memory-standalone-p0`.

---

## Cross-references

- **Research basis**: `.claude/knowledge-base/research/theo-memory-standalone-p0-test-patterns-2026-06-03.md`
- **Edge case report**: `.claude/knowledge-base/reviews/theo-memory-standalone-p0-edge-cases-2026-06-03.md` (49 ECs absorbed via v1.1)
- **Roadmap**: `CLAUDE.md § Phase III bis — Standalone distribution (P0)` Items 16/17/18
- **Project rules cited**: `architecture.md § 1, 3, 4, 8, 10.2, Module hygiene`; `testing.md`; `no-paper-names-in-code.md`; `deps-audit-golden-rule.md § Severity rubric` (T3.3 + .trivyignore)
- **ADRs amended/referenced**: ADR-0008 (DIP cap — 12th uniformly); ADR-0009 (THEOKIT_API_KEY mirrored in D3); ADR-0011 (BiTemporalNotSupportedLocally mapped in T1.6 for future cloud)
- **Inquebrável Rules cited**: Rule 3 (honesty — deprecation discipline + fail-closed empty-string); Rule 5 (TDD-first); Rule 6 (CHANGELOG); Rule 9 (Não Reinvente)
- **Companion artifacts post-plan**:
  - `/deps-audit theo-memory-standalone-p0` (after this v1.1)
  - `/plan-confidence theo-memory-standalone-p0` (M2 score with 85-row Coverage Matrix)
  - (if verdict < SHIPPABLE_WITH_CAVEATS) `/plan-improve` + re-score
