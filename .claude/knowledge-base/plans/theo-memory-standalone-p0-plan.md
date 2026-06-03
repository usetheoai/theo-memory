# Plan: TheMemory Standalone P0 — REST API + Docker stack + CLI consolidado

> **Version 1.0** (2026-06-03) — Ship the standalone-distribution surface for TheMemory (CLAUDE.md § Phase III bis, Items 16/17/18). Anchored on `/research/theo-memory-standalone-p0-test-patterns-2026-06-03.md` (canonical RED test inventory + 5 patterns lifted from Mem0 + Letta). The plan ships: (a) REST API server at `@usetheo/memory/server` wrapping the 4 verbs over Hono + bearer auth + OpenAPI 3.1 spec + OTel observability + domain-error envelope; (b) multi-stage Dockerfile → distroless image → published to GHCR via GitHub Actions with Trivy scan gate; (c) consolidated `themory` CLI with 4 subcommands (`mcp`/`server`/`migrate`/`health`) preserving backward-compat alias. Goal-test is an integration round-trip of `POST /v1/remember` + `POST /v1/recall` against `ghcr.io/usetheo/themory:0.1.0-alpha` started via `docker compose up` with ZERO manual setup steps. Unblocks non-MCP consumers (admin dashboards, mobile clients, multi-language consumers via OpenAPI codegen, monitoring/probing via `curl`). Honors Cross-Project Rule 6 override (lock-in still feature when consumer chooses cloud path) but parallel-tracks OSS adoption while TheoCloud PaaS GA remains blocked.

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

Per the strategic gap analysis 2026-06-03 (conversation transcript + CLAUDE.md Phase III bis preamble): **`/dogfood` EVIDENCE_INSUFFICIENT + zero published packages = adoption ceiling at zero**. Consequence: every shipped feature (reflection, forgetting, skill library, distillation, multi-peer, bi-temporal) is paper-only without consumer evidence. The biggest gap is NOT a missing feature — it is **distribution surface for non-MCP consumers**.

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
- [ ] Sub-goal 6 — Multi-stage Dockerfile (Node 22 → distroless) + production `docker-compose.prod.yaml` + GHCR publish workflow with Trivy scan (T3.1 → T3.4)
- [ ] Sub-goal 7 — Image runs migrations on startup (stricter than Mem0/Letta references per `architecture.md § 10.2`) (T3.5)
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
| `@hono/zod-openapi` (NEW) | ^0.18.0 | npm | Evaluated: hand-write OpenAPI YAML (high maintenance + drift risk), `@asteasolutions/zod-to-openapi` (works but not Hono-native), `@hono/zod-openapi` (auto-derives spec from zod schemas + Hono-native + ships RouteConfig type). | Single source of truth (zod schemas) → no spec drift. Honors `architecture.md § 8` validation discipline. |
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

**Consequences:** Hono's edge-runtime support means future cloud deploy (CloudFlare Workers, Vercel Edge Functions) is one config away. `@hono/zod-openapi` couples spec to validation — single change point.

### D2 — Endpoint shape: RPC-mirror of 4 verbs (over REST-resource)

**Decision:** Endpoints mirror the SDK's 4 verbs as RPC POST calls: `POST /v1/remember`, `POST /v1/recall`, `POST /v1/forget`, `POST /v1/reflect`. Listing is `GET /v1/scopes/:type/:id/memories` (paginated). Health is `GET /v1/health`.

**Rationale:** The domain is **semantic memory operations**, not CRUD resources. `POST /v1/remember` reads naturally as "the memory system, remember this"; `POST /memories` reads as "create a memory row" which is the wrong mental model (memories may be extracted into N rows or deduped into zero). Mem0 uses similar RPC shape (`/memories/add`, `/memories/search`); Letta uses `/agents/messages` not `/messages`. Honoring `architecture.md § 4 (Mem0-shape, not Mem0-clone)`: same shape, different vocabulary (the 4 verbs).

**Alternatives considered:**
- **REST resource (POST /memories, GET /memories/:id, DELETE /memories/:id)**: REJECTED. Forces "memory = row" model, which is wrong (extraction may produce N rows, dedup may produce zero). Loses paridade with SDK.
- **GraphQL single endpoint**: REJECTED. Adds GraphQL runtime dep (~500KB) for 6 operations. Overkill.
- **JSON-RPC over HTTP (mirror agent-tools/MCP shape)**: REJECTED. Less consumer-friendly for curl/browser/Postman; MCP exists already at `themory mcp` subcommand.

**Consequences:** OpenAPI spec describes 6 operations cleanly. Future verbs (e.g. `/v1/distill`) add as new POST endpoints without redesign. `themory remember` CLI verb-subcommand (P1) maps 1:1 to `POST /v1/remember`.

### D3 — Auth: Bearer token via `THEMEMORY_API_KEY` env var (single DIP)

**Decision:** REST server accepts `Authorization: Bearer <token>` header. Token compared against `THEMEMORY_API_KEY` env var. No-auth fallback when env unset (alpha-mode convenience). 12th DIP `AuthVerifier` with single method `verify(token: string): Promise<boolean>` allows future OAuth/JWT swap.

**Rationale:** Mirror of `THEOKIT_API_KEY` shape per ADR-0009 — zero new mental model for ecosystem consumers. Bearer + env-var is the most common REST auth pattern in 2026 (used by OpenAI API, Anthropic API, GitHub API). DIP boundary preserves ADR-0008 method-count caps + enables future OAuth/JWT without surface change.

**Alternatives considered:**
- **`X-API-Key` header (Mem0 P1 pattern)**: REJECTED. Non-standard; `Authorization: Bearer` is the OAuth-derived idiom most clients send by default.
- **No auth at all (alpha)**: REJECTED. Single-line of defense against accidental public exposure is cheap; opt-out via unset env var preserves alpha-mode UX.
- **mTLS / client certs**: REJECTED. Out-of-scope for P0; high ops burden. P1 candidate.
- **Hardcoded auth check (no DIP)**: REJECTED. Forces breaking change when OAuth/JWT lands. DIP cost is one interface file.

**Consequences:** New 12th DIP `src/core/dip/auth-verifier.ts`. `BearerAuthVerifier` impl lives in `src/server/auth/bearer-verifier.ts` (under server module to keep `src/core/` DIP-clean per `architecture.md § 3`). OAuth/JWT impl deferred to P1.

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

**Consequences:** Integration test gated on `THEOMEM_PG_URI` + `DOCKER_INTEGRATION=true` to avoid surprising default-test runs with Docker requirement. Test author manages container lifecycle via `node:child_process` (same shape as `themem_pgvector` convention).

### D6 — Multi-stage Dockerfile → distroless runtime

**Decision:** Multi-stage Dockerfile: `node:22-alpine` build stage (tsc + postbuild migrations copy) → `gcr.io/distroless/nodejs22-debian12:nonroot` runtime. Layer cache via `package.json` + `package-lock.json` copied before source.

**Rationale:** Distroless reduces image size + attack surface (no shell, no package manager, only Node runtime + app artifacts). Mem0 OpenMemory uses `python:slim` (200MB); Letta uses standard `python` (1.2GB). TheMemory distroless target: ~150MB final image.

**Alternatives considered:**
- **`node:22-alpine` runtime stage**: REJECTED. Smaller than distroless but ships APK + busybox + shell — larger attack surface; muslibc compatibility quirks with native deps.
- **Single-stage `node:22-bullseye`**: REJECTED. ~1GB+ image; surface tracking includes ALL apt packages.
- **`bun` runtime**: REJECTED. Bun is fast but not yet a battle-tested deploy target; Node 22 LTS aligns with `engines` declaration.

**Consequences:** Build stage size ~600MB (cached); runtime stage ~150MB (shipped). Image scanned by Trivy in CI — zero CRITICAL/HIGH expected. Distroless `nonroot` user means no UID 0 in runtime — file ownership in image build stage.

### D7 — Image registry: GHCR (over Docker Hub)

**Decision:** Publish to `ghcr.io/usetheo/themory:0.1.0-alpha`. GitHub Actions workflow auto-tags on release.

**Rationale:** GHCR free for OSS + tied to GitHub repo audit trail + no rate limits for public pulls. Docker Hub free tier added rate limits (100 pulls/6h for anonymous) — friction for OSS consumers. Letta ships to Docker Hub (`letta/letta`); we choose GHCR per the cleaner default.

**Alternatives considered:**
- **Docker Hub** (`docker.io/usetheo/themory`): REJECTED. Free tier rate-limited; ops burden of registry-creds maintenance separate from GitHub.
- **AWS ECR Public**: REJECTED. Locks us to AWS account; AWS-specific tooling.
- **Quay.io**: REJECTED. RedHat-owned; ecosystem fragmentation.

**Consequences:** Consumer pull command: `docker pull ghcr.io/usetheo/themory:0.1.0-alpha`. Docker Hub mirror NOT shipped — if a consumer asks, can add as a follow-up release-cycle.

### D8 — Migrations on startup (stricter than Mem0/Letta references)

**Decision:** Container startup runs `runMigrations(pool)` (from `src/local/index.ts:1026`) inline BEFORE binding the REST port. If migrations fail, container exits 1 — fail-fast.

**Rationale:** Per `architecture.md § 10.2`, drizzle-kit push vs runMigrations divergence is a known footgun. Production deploys must use `runMigrations()` against fresh DBs. Bundling this inside startup eliminates the "did you remember to migrate?" failure class. Mem0 + Letta both ASSUME the operator ran migrations manually — we ship stricter.

**Alternatives considered:**
- **Manual migrate step in compose `entrypoint`**: REJECTED. Easy to forget; doubles ops surface.
- **Init container (k8s pattern)**: REJECTED. Adds complexity for non-k8s users (docker-compose, local dev).
- **Optional flag `--skip-migrations`**: REJECTED. Same forgetting-failure-class. If user needs to skip, they invoke `themory server` directly without compose orchestration.

**Consequences:** Container startup is 1-3 seconds slower (migration runtime + idempotent journal check). Acceptable trade. Failure mode "migrations failed" is loud (exit 1 + stderr) — health endpoint never reached.

### D9 — Backward-compat: `themory-mcp` alias for ONE release

**Decision:** Existing `bin: themory-mcp` retained as a symlink/alias to `themory mcp` for v0.1.0-alpha. On invocation, emits stderr warning: `DEPRECATED: themory-mcp will be removed in 0.2.0. Use 'themory mcp' instead.` Removed in 0.2.0.

**Rationale:** Inquebrável Rule 3 (extreme honesty) + cycle-implement.md anti-pattern #5 (no breaking changes without notice). One-release deprecation window is the project's idiom (matches v0.4b `Memory.forget(memoryId, options?: ForgetOptions)` widening).

**Alternatives considered:**
- **Remove `themory-mcp` immediately**: REJECTED. Breaks the v0.3 GOAL TEST callers + any external automation. No notice = trust-erosion.
- **Keep `themory-mcp` indefinitely**: REJECTED. Doubles maintenance + confuses new users.
- **Print deprecation warning + DO NOT remove**: REJECTED. Half-measure; deprecation without sunset is theater.

**Consequences:** `package.json` keeps BOTH `themory` and `themory-mcp` entries until 0.2.0. Test T2.2 verifies the regression + the deprecation stderr output.

### D10 — File-size budget: each new server file ≤ 500 LoC per `architecture.md § Module hygiene`

**Decision:** Every new file in `src/server/` enforces the 500 LoC budget. Split routes into per-handler files (one file per verb) under `src/server/handlers/`. Aggregate via `src/server/app.ts` (router composition < 100 LoC).

**Rationale:** Mirrors v0.6.1 PgvectorStore split decision (composition over inheritance). Avoids the F-arch-6/F-arch-7 LoC overruns surfaced in v1.1 /review.

**Alternatives considered:**
- **Single `src/server/app.ts` with inline handlers**: REJECTED. Would push past 500 LoC quickly + violate SRP per `architecture.md § Module hygiene`.
- **Per-resource sub-routers (`/memories`, `/scopes`)**: REJECTED. We chose RPC shape (D2), not REST resource — sub-router split doesn't fit.

**Consequences:** 6 handler files (remember/recall/forget/reflect/health/scopes) + 1 app composer + 1 errors + 1 openapi + 1 index = 10 files in `src/server/`. Each ≤ 200 LoC expected; total ~1200 LoC over module.

### D11 — Wiring discipline: REST handlers compose `Memory` factory, NOT new factory

**Decision:** REST server consumes `Memory` instances via DI. `createServer({ memory: Memory, authVerifier?: AuthVerifier }): Hono` is the public factory. Caller wires `createMemory({ ... })` → `createServer({ memory })`. No `createServerWithMemory()` shortcut.

**Rationale:** Single composition pattern over factory proliferation. Honors `architecture.md § 3 (DIP)` — server depends on the `Memory` interface, not on `createMemory`. Caller control over lifecycle (single Memory, single Server, shared pool).

**Alternatives considered:**
- **`createServerWithMemory(config)` shortcut**: REJECTED. Doubles API surface for marginal convenience; obscures the composition.
- **Server owns Memory factory internally**: REJECTED. Violates DIP — server should consume the interface, not own the implementation.
- **CLI-level composition only (no public `createServer` export)**: REJECTED. Locks server consumption to CLI users; cuts off library-mode embed (e.g., consumer wants to mount the REST routes inside their existing Hono app).

**Consequences:** Subpath `@usetheo/memory/server` exports `createServer` + `AuthVerifier` interface + `BearerAuthVerifier` impl. CLI `themory server` is one of the consumers, not the only one.

## Dependency Graph

```
Phase 0 — Foundation (deps + AuthVerifier DIP declaration)
   │
   └──▶ Phase 1 — REST API server (Item 16)
            │
            ├── T1.1 BearerAuthVerifier impl
            ├── T1.2 4-verb handlers + StubMemory fixture
            ├── T1.3 health + scopes pagination
            ├── T1.4 OpenAPI 3.1 spec
            ├── T1.5 OTel observability
            ├── T1.6 Domain-error envelope
            └── T1.7 Subpath export + tsconfig include update
                  │
                  └──▶ Phase 2 — CLI consolidado (Item 18)
                           │
                           ├── T2.1 commander scaffold + help screen
                           ├── T2.2 themory mcp + backward-compat alias
                           ├── T2.3 themory server (starts REST)
                           ├── T2.4 themory migrate
                           └── T2.5 themory health
                                 │
                                 └──▶ Phase 3 — Docker stack (Item 17)
                                          │
                                          ├── T3.1 Multi-stage Dockerfile
                                          ├── T3.2 docker-compose.prod.yaml
                                          ├── T3.3 GitHub Actions workflow + Trivy
                                          ├── T3.4 Migrations on startup wiring
                                          └── T3.5 docker-stack E2E test (THE GOAL TEST)
                                                │
                                                └──▶ Final Phase — Integration Validation
```

Sequential: Phase 0 → 1 → 2 → 3 → Final. Within each phase, tasks may parallelize (T1.1-T1.6 are mostly independent; T2.1-T2.5 share the CLI scaffold and serialize via T2.1).

---

## Phase 0 — Foundation

**Objective:** Add deps + declare 12th DIP. Single task to land the foundation.

### T0.1 — Add 5 deps + declare AuthVerifier DIP

#### Objective
Add Hono + commander + @hono/zod-openapi + strip-ansi + @apidevtools/swagger-parser to `package.json`; declare 12th DIP `AuthVerifier` at `src/core/dip/auth-verifier.ts`.

#### Evidence
Research note `.claude/knowledge-base/research/theo-memory-standalone-p0-test-patterns-2026-06-03.md § Summary` enumerates the 5 deps with Rule 9 evaluation. ADR D1, D3, D4 specify the choices.

#### Files to edit
```
package.json — add dependencies + devDependencies (Rule 9 evaluated per § Dependencies)
src/core/dip/auth-verifier.ts (NEW) — declare AuthVerifier interface
src/core/dip/__tests__/auth-verifier.test-d.ts (NEW) — type tests for AuthVerifier interface
src/core/index.ts — re-export AuthVerifier interface from contract
```

#### Deep file dependency analysis
- `package.json`: 5 new lines under `dependencies`/`devDependencies`. No removals. `peerDependencies` unchanged.
- `src/core/dip/auth-verifier.ts`: NEW — 1 method `verify(token: string): Promise<boolean>`. ~15 LoC.
- `src/core/dip/__tests__/auth-verifier.test-d.ts`: NEW — type-level tests via `expectTypeOf`.
- `src/core/index.ts`: ~3 lines added to re-export.

#### Deep Dives
- **DIP method-count cap (ADR-0008)**: AuthVerifier has 1 method → does not affect cap (existing DIPs have 1-3 methods; AuthVerifier is uniform).
- **No file-size budget concern**: all changes < 50 LoC per file.

#### Tasks
1. Add `hono ^4.6.0`, `@hono/zod-openapi ^0.18.0`, `commander ^12.1.0` to `dependencies` block of `package.json` (alphabetical order; mirror existing pattern).
2. Add `strip-ansi ^7.1.0`, `@apidevtools/swagger-parser ^10.1.1` to `devDependencies` block.
3. Run `npm install` to lock versions.
4. Run `/deps-audit theo-memory-standalone-p0` to validate zero new CRITICAL/HIGH CVE on declared deps.
5. Create `src/core/dip/auth-verifier.ts` with:
   ```ts
   /**
    * AuthVerifier — 12th DIP. Single-method interface for bearer/OAuth/JWT swaps.
    * @see Plan theo-memory-standalone-p0 ADR D3.
    */
   export interface AuthVerifier {
     verify(token: string): Promise<boolean>;
   }
   ```
6. Create `src/core/dip/__tests__/auth-verifier.test-d.ts` with `expectTypeOf<AuthVerifier>().toHaveProperty('verify')` + signature assertion.
7. Add `export type { AuthVerifier } from './dip/auth-verifier.js';` to `src/core/index.ts`.

#### TDD
```
RED:     test-d auth-verifier.test-d.ts — assert AuthVerifier has verify(string): Promise<boolean> (FAIL — interface does not exist yet)
GREEN:   create src/core/dip/auth-verifier.ts with declared interface
REFACTOR: none expected — interface is canonical-minimal
VERIFY:  npm run typecheck && npm test -- src/core/dip/__tests__/auth-verifier
```

#### Acceptance Criteria
- [ ] `npm install` exits 0; 5 new deps present in `node_modules/`
- [ ] `/deps-audit theo-memory-standalone-p0` returns verdict ≥ PASS_WITH_CAVEATS
- [ ] `npm run typecheck` PASS zero errors
- [ ] `npm test -- src/core/dip/__tests__/auth-verifier` PASS
- [ ] Pass: size — `src/core/dip/auth-verifier.ts` ≤ 50 LoC

#### DoD
- [ ] All Tasks completed
- [ ] `tsc --noEmit` zero errors
- [ ] `npm run lint` zero warnings

---

## Phase 1 — REST API server (Item 16)

**Objective:** Implement `src/server/` exposing the 4 verbs + health + scopes pagination + OpenAPI spec + OTel + domain-error envelope.

### T1.1 — BearerAuthVerifier impl + bearer middleware

#### Objective
Implement `BearerAuthVerifier` (impl of AuthVerifier DIP) under `src/server/auth/` + Hono middleware that gates handlers based on `THEMEMORY_API_KEY` env presence.

#### Evidence
Research note § "Pattern P1 — In-process REST testing (Mem0 origin)" lines 150-244 documents the auth-disabled / auth-enabled fixture split. Plan ADR D3.

#### Files to edit
```
src/server/auth/bearer-verifier.ts (NEW) — BearerAuthVerifier class implements AuthVerifier
src/server/auth/middleware.ts (NEW) — Hono middleware: if THEMEMORY_API_KEY set, require Authorization: Bearer; else passthrough
src/server/auth/__tests__/bearer-verifier.test.ts (NEW) — unit tests for verify()
```

#### Deep file dependency analysis
- `bearer-verifier.ts`: constructor takes `expectedToken: string`; `verify(token)` returns `token === expectedToken`. ~25 LoC.
- `middleware.ts`: reads `process.env['THEMEMORY_API_KEY']`; if unset, `await next()`; if set, validates `Authorization: Bearer <token>` header via `BearerAuthVerifier`; on failure, returns 401 with `www-authenticate: Bearer` header. ~40 LoC.
- Test file: 6 tests (no env / valid token / invalid token / missing header / case-sensitivity / whitespace handling).

#### Deep Dives
- **Constant-time comparison**: `verify()` uses `crypto.timingSafeEqual` to defeat timing attacks. ~5 extra LoC; honors `architecture.md § 8 (error handling)` — fail-fast on length mismatch first.
- **Response shape**: 401 returns `{ "code": "UNAUTHORIZED", "message": "Bearer token required" }` per envelope chosen in T1.6.

#### Tasks
1. Create `src/server/` dir.
2. Create `src/server/auth/bearer-verifier.ts`: class `BearerAuthVerifier implements AuthVerifier` with constructor + `verify()` using `crypto.timingSafeEqual`.
3. Create `src/server/auth/middleware.ts`: Hono middleware factory `bearerAuth(verifier?: AuthVerifier)`.
4. Create `src/server/auth/__tests__/bearer-verifier.test.ts` with 6 unit tests (RED).
5. Update `vitest.contract.config.ts` `include` to add `src/server/**/__tests__/**/*.test.ts` (Step 0 path validation requirement).

#### TDD
```
RED:     test('verify returns true for matching token') — FAIL (class does not exist)
RED:     test('verify returns false for non-matching token')
RED:     test('verify returns false for empty token')
RED:     test('verify uses timingSafeEqual (no early-exit on prefix match)')
RED:     test('middleware passthrough when THEMEMORY_API_KEY env unset')
RED:     test('middleware returns 401 with www-authenticate: Bearer when token missing or invalid')
GREEN:   implement BearerAuthVerifier + middleware factory
REFACTOR: extract Bearer token parsing helper if used in 2+ places
VERIFY:  npm test -- src/server/auth/__tests__/bearer-verifier
```

#### Acceptance Criteria
- [ ] 6 RED tests pass GREEN
- [ ] `BearerAuthVerifier` implements `AuthVerifier` from `src/core/dip/auth-verifier.ts` (compile-time check)
- [ ] `verify()` uses `crypto.timingSafeEqual` (grep audit)
- [ ] 401 response includes `www-authenticate: Bearer` header
- [ ] Pass: size — each file ≤ 100 LoC
- [ ] Pass: lint zero warnings
- [ ] Pass: typecheck zero errors

#### DoD
- [ ] All Tasks completed; all RED tests GREEN
- [ ] `vitest.contract.config.ts` updated with `src/server/**/__tests__/**` include
- [ ] No new public exports from `src/index.ts` yet (server lives at subpath, exposed in T1.7)

### T1.2 — REST handlers for 4 verbs (remember/recall/forget/reflect)

#### Objective
Implement 4 RPC handlers under `src/server/handlers/` + Hono app composer at `src/server/app.ts`.

#### Evidence
Research note § "Item 16 RED tests": T16-RED-1 (POST /v1/remember 201) through T16-RED-4 (POST /v1/reflect 202). Plan ADR D2 (RPC shape), D11 (DI composition).

#### Files to edit
```
src/server/handlers/remember.ts (NEW) — POST /v1/remember handler
src/server/handlers/recall.ts (NEW) — POST /v1/recall handler
src/server/handlers/forget.ts (NEW) — POST /v1/forget handler
src/server/handlers/reflect.ts (NEW) — POST /v1/reflect handler
src/server/app.ts (NEW) — Hono app composer; mounts handlers; applies bearer middleware
src/server/index.ts (NEW) — public factory createServer({ memory, authVerifier? })
src/server/__tests__/handlers.test.ts (NEW) — integration tests (in-process app.fetch())
```

#### Deep file dependency analysis
- Each handler file: zod request schema + handler function + zod response schema. ~50 LoC each.
- `app.ts`: Hono router composition, middleware chain. ~80 LoC.
- `index.ts`: exports `createServer({ memory, authVerifier? })`, `BearerAuthVerifier`, types. ~30 LoC.
- Test file: 4 handler tests + 2 composition tests (app boots, middleware applied). ~150 LoC.

#### Deep Dives
- **Request shape (remember)**: `{ userId?, sessionId?, agentId?, text, infer?, attributedTo? }` — at least one scope tier required (validated by zod refine).
- **Response shape (recall)**: `{ results: Array<{ id, text, score, scope, attributedTo? }> }` — wrapped in object (not raw array) per JSON:API guidance + future pagination.
- **HTTP status codes**: 201 (remember), 200 (recall), 204 (forget), 202 (reflect — async/queued semantic).
- **Scope resolution**: handler reads scope from request body → calls `memory.user(id).remember(...)` (or session / agent) per the 3-tier shape.

#### Tasks
1. Create `src/server/handlers/remember.ts` with zod schema + handler.
2. Create `src/server/handlers/recall.ts`.
3. Create `src/server/handlers/forget.ts`.
4. Create `src/server/handlers/reflect.ts`.
5. Create `src/server/app.ts` — composes Hono app + mounts handlers under `/v1` prefix + applies bearer middleware (only when authVerifier provided).
6. Create `src/server/index.ts` — public factory `createServer({ memory: Memory, authVerifier?: AuthVerifier }): Hono`.
7. Create `src/server/__tests__/handlers.test.ts` — uses `app.fetch(new Request(url, init))` for in-process tests (Pattern P1).

#### TDD
```
RED:     test('POST /v1/remember returns 201 with memoryId') — FAIL (no handler)
RED:     test('POST /v1/recall returns { results: [...] } shape')
RED:     test('POST /v1/forget returns 204; subsequent recall excludes id')
RED:     test('POST /v1/reflect returns 202 + reflection-job-id')
RED:     test('POST /v1/remember with missing scope returns 422')
RED:     test('createServer wires middleware when authVerifier provided')
GREEN:   implement 4 handlers + app composer + factory
REFACTOR: extract scope-resolver helper if 4 handlers duplicate the same scope-routing logic
VERIFY:  npm test -- src/server/__tests__/handlers
```

#### Acceptance Criteria
- [ ] 6 RED tests pass GREEN against StubMemory fixture
- [ ] Each handler ≤ 100 LoC; `app.ts` ≤ 150 LoC; `index.ts` ≤ 50 LoC
- [ ] No `any` types (per `architecture.md § Module hygiene`)
- [ ] zod schemas validate at handler boundary (per `architecture.md § 8`)
- [ ] Pass: lint zero warnings
- [ ] Pass: typecheck zero errors

#### DoD
- [ ] All Tasks completed; all RED tests GREEN
- [ ] `createServer` consumes `Memory` interface only — no import from `src/local/` (DIP per `architecture.md § 3`)

### T1.3 — Health + scopes pagination endpoints

#### Objective
Implement `GET /v1/health` (readiness — process alive + DB pool ready), `GET /v1/health/db` (liveness — DB ping), and `GET /v1/scopes/:type/:id/memories?cursor=&limit=` (paginated listing).

#### Files to edit
```
src/server/handlers/health.ts (NEW) — GET /v1/health + GET /v1/health/db
src/server/handlers/scopes.ts (NEW) — GET /v1/scopes/:type/:id/memories
src/server/__tests__/health.test.ts (NEW)
src/server/__tests__/scopes.test.ts (NEW)
```

#### Deep file dependency analysis
- `health.ts`: 2 endpoints — `/v1/health` (returns `{ status: 'ok' }`); `/v1/health/db` (executes `pool.query('SELECT 1')`; on error returns 503). ~40 LoC.
- `scopes.ts`: paginated listing. Cursor = base64-encoded `id|created_at` opaque token. ~80 LoC.

#### Deep Dives
- **Cursor pagination**: opaque cursor (not offset) for stability under writes. Mirrors GitHub API + Stripe pattern.
- **`:type` validation**: enum `user | session | agent | skill` — reject 404 for other strings.

#### Tasks
1. Create `src/server/handlers/health.ts`.
2. Create `src/server/handlers/scopes.ts`.
3. Wire both into `src/server/app.ts` (under `/v1` prefix).
4. Write tests.

#### TDD
```
RED:     test('GET /v1/health returns { status: "ok" }')
RED:     test('GET /v1/health/db returns 200 when pool query succeeds')
RED:     test('GET /v1/health/db returns 503 when pool query throws')
RED:     test('GET /v1/scopes/user/alice/memories returns paginated results')
RED:     test('GET /v1/scopes/invalid/x/memories returns 404')
GREEN:   implement health + scopes handlers
REFACTOR: none expected
VERIFY:  npm test -- src/server/__tests__/{health,scopes}
```

#### Acceptance Criteria
- [ ] All 5 RED tests pass GREEN
- [ ] Pass: size, lint, typecheck

#### DoD
- [ ] All Tasks completed; RED tests GREEN

### T1.4 — OpenAPI 3.1 spec auto-generation

#### Objective
Wire `@hono/zod-openapi` to auto-derive the OpenAPI 3.1 spec from existing zod request/response schemas. Expose via `GET /v1/openapi.json`.

#### Evidence
Research note Item 16 RED test T16-RED-11: `test('GET /v1/openapi.json validates against OpenAPI 3.1 schema')`. Plan ADR D1 + D6 framework choice.

#### Files to edit
```
src/server/openapi.ts (NEW) — OpenAPIHono setup + spec endpoint
src/server/handlers/*.ts — migrate from raw Hono routes to RouteConfig pattern (uses zod-openapi `createRoute`)
src/server/__tests__/openapi.test.ts (NEW) — validates spec against `@apidevtools/swagger-parser`
```

#### Deep file dependency analysis
- `openapi.ts`: ~40 LoC — OpenAPIHono instance + doc metadata (title, version, license MIT).
- Each handler migration: zod schemas exported as RouteConfig + handler signature shifts to `c: Context<...>`. ~20 LoC delta per handler.

#### Deep Dives
- **Spec stability across versions**: spec generation pinned to `@hono/zod-openapi ^0.18` minor; major bump goes through ADR + plan amendment.
- **License field**: spec advertises `license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' }` per `Locked names` MIT override.

#### Tasks
1. Create `src/server/openapi.ts` with OpenAPIHono instance.
2. Migrate 6 handlers (remember/recall/forget/reflect/health/scopes) to use `createRoute` + RouteConfig pattern.
3. Expose `GET /v1/openapi.json` returning the auto-generated spec.
4. Write test that fetches spec + validates via `@apidevtools/swagger-parser.validate(spec)`.

#### TDD
```
RED:     test('GET /v1/openapi.json returns valid OpenAPI 3.1 schema (swagger-parser validates)')
RED:     test('openapi spec lists all 6 operations with stable operationId')
RED:     test('openapi spec advertises license MIT')
GREEN:   implement OpenAPIHono + RouteConfig migration
REFACTOR: extract shared zod schema fragments (ScopeRequest etc.) into src/server/schemas.ts
VERIFY:  npm test -- src/server/__tests__/openapi
```

#### Acceptance Criteria
- [ ] 3 RED tests pass GREEN
- [ ] Spec endpoint returns `Content-Type: application/json`
- [ ] swagger-parser validation exits 0
- [ ] Pass: size, lint, typecheck

#### DoD
- [ ] All Tasks completed
- [ ] All 6 handler operations represented in spec with `operationId` (stable for client codegen)

### T1.5 — OTel span observability per handler

#### Objective
Wrap each handler in an OTel span (`rest.v1.<verb>` naming). Span includes `http.method`, `http.status_code`, `themory.scope.type` attributes.

#### Evidence
Research note Item 16 RED test T16-RED-13. v0.4b runtime pattern (`pgvector_recall_duration_ms` etc.) — OTel already in SDK.

#### Files to edit
```
src/server/observability/otel-middleware.ts (NEW) — Hono middleware that wraps each request
src/server/__tests__/otel.test.ts (NEW) — in-memory exporter assertion
```

#### Deep file dependency analysis
- `otel-middleware.ts`: ~50 LoC — uses `@opentelemetry/api` (transitive via existing v0.4b OTel deps; if not present, add via T0.1 amendment).

#### Deep Dives
- **Span naming**: `rest.v1.remember`, `rest.v1.recall`, etc. — stable across versions.
- **Error propagation**: span status set to `ERROR` on 5xx; `OK` on 2xx/3xx; spans for 4xx use `ERROR` only when domain-error (not client error).

#### Tasks
1. Create `src/server/observability/otel-middleware.ts`.
2. Wire into `src/server/app.ts` middleware chain (BEFORE bearer auth so unauth requests are also observed).
3. Write test using in-memory SpanExporter.

#### TDD
```
RED:     test('POST /v1/remember emits span name rest.v1.remember')
RED:     test('span includes http.status_code attribute')
RED:     test('5xx errors mark span status ERROR')
GREEN:   implement otel-middleware
REFACTOR: none expected
VERIFY:  npm test -- src/server/__tests__/otel
```

#### Acceptance Criteria
- [ ] 3 RED tests pass GREEN
- [ ] In-memory SpanExporter records ≥ 1 span per integration test invocation
- [ ] Pass: size, lint, typecheck

#### DoD
- [ ] All Tasks completed
- [ ] **Runtime-metric proof**: `npm test -- tests/integration/rest-api.test.ts` shows span count > 0 in exporter (closes wiring triad pillar c for REST handlers)

### T1.6 — Domain-error → HTTP envelope mapping

#### Objective
Map domain errors from `src/core/errors.ts` (`InvalidScope`, `MemoryNotFound`, etc.) to HTTP responses with stable envelope `{ code, message, field? }`.

#### Evidence
Research note § "Item 16 RED tests" T16-RED-12. `architecture.md § 8` (typed domain errors + fail-fast + boundary validation).

#### Files to edit
```
src/server/errors.ts (NEW) — mapDomainErrorToResponse(err: Error): Response
src/server/__tests__/errors.test.ts (NEW)
```

#### Deep file dependency analysis
- `errors.ts`: ~60 LoC — switch on `err.constructor.name` returning HTTP status + envelope.
- Mapping:
  - `InvalidScope` → 422
  - `MemoryNotFound` → 404
  - `BiTemporalNotSupportedLocally` → 422 (cloud-only feature on local — already lifted by ADR-0011 but kept for future cloud)
  - `InvalidEmbeddingDim` → 422
  - Other / unknown → 500 (logged + traced; never expose raw stack)

#### Tasks
1. Create `src/server/errors.ts` with `mapDomainErrorToResponse`.
2. Wire global error handler in `src/server/app.ts` (`app.onError(...)`).
3. Write tests.

#### TDD
```
RED:     test('InvalidScope error returns 422 with code: INVALID_SCOPE')
RED:     test('MemoryNotFound error returns 404 with code: MEMORY_NOT_FOUND')
RED:     test('Unknown error returns 500 without stack trace in response body')
RED:     test('Error envelope shape: { code, message, field? }')
GREEN:   implement mapDomainErrorToResponse + wire app.onError
REFACTOR: none expected
VERIFY:  npm test -- src/server/__tests__/errors
```

#### Acceptance Criteria
- [ ] 4 RED tests pass GREEN
- [ ] No raw stack trace in response body (grep audit on test response)
- [ ] Pass: size, lint, typecheck

#### DoD
- [ ] All Tasks completed; all errors mapped

### T1.7 — Subpath export + tsconfig include update

#### Objective
Expose `@usetheo/memory/server` via `package.json#exports`; add `src/server/**` to `tsconfig.contract.json` include + `vitest.contract.config.ts` include (already added in T1.1, double-check).

#### Files to edit
```
package.json — add "./server" subpath under exports
tsconfig.contract.json — add src/server/** to include
vitest.contract.config.ts — verify src/server/** in include (added T1.1)
README.md — add 1-paragraph "REST API server" section to Planned API contract
```

#### Deep file dependency analysis
- `package.json` exports: add `"./server": { "types": "./src/server/index.ts", "default": "./src/server/index.ts" }` between `./agent-tools` and `./embedders` (alphabetical).
- `tsconfig.contract.json` include: add `"src/server/**/*.ts"` to globs.

#### Tasks
1. Update `package.json#exports`.
2. Update `tsconfig.contract.json#include`.
3. Verify `vitest.contract.config.ts` include includes `server`.
4. Add 1-paragraph "REST API server" section to README under "Planned API contract".
5. Add `### Added` entry to CHANGELOG.md `[Unreleased]` describing T1.x landing (per Inquebrável Rule 6).

#### TDD
```
RED:     test('@usetheo/memory/server subpath resolves to createServer factory') — runs from a sibling tsconfig test
GREEN:   exports + tsconfig include
REFACTOR: none
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] `import { createServer } from '@usetheo/memory/server'` resolves under `npm run typecheck`
- [ ] `npm test` 845+ tests pass (no regression)
- [ ] CHANGELOG entry written
- [ ] Pass: lint, typecheck

#### DoD
- [ ] All Tasks completed
- [ ] subpath consumer-importable

---

## Phase 2 — CLI consolidado (Item 18)

**Objective:** Replace single-purpose `themory-mcp` bin with multi-subcommand `themory` CLI. Preserve backward-compat alias for ONE release.

### T2.1 — commander scaffold + 4-subcommand help screen

#### Objective
Replace `src/agent-tools/cli.ts` content with multi-subcommand commander scaffold. Move MCP-specific logic to a function called by the `themory mcp` subcommand.

#### Files to edit
```
src/agent-tools/cli.ts — REWRITE as commander multi-subcommand router; existing MCP logic extracted to runMcpServer()
src/agent-tools/cli.test.ts (NEW under src/agent-tools/__tests__/) — unit test help screen output
package.json — replace bin "themory-mcp" with bin "themory" + backward-compat alias "themory-mcp"
tests/integration/cli-consolidated.test.ts (NEW) — integration tests using subprocess (Pattern P3)
```

#### Deep file dependency analysis
- `src/agent-tools/cli.ts`: currently a single-purpose MCP server boot. Rewrite as commander entry; subcommand `mcp` invokes the same existing logic (now extracted to `runMcpServer(options)`). ~100 LoC after rewrite.
- `package.json` bin: `{ "themory": "./dist/agent-tools/cli.js", "themory-mcp": "./dist/agent-tools/cli.js" }` — both point to the same entry; entry detects argv[0] basename to choose subcommand-mode vs alias-mode.

#### Deep Dives
- **`themory-mcp` alias detection**: at entry top, `if (process.argv[1]?.endsWith('themory-mcp')) { console.error('DEPRECATED: themory-mcp will be removed in 0.2.0. Use \'themory mcp\' instead.'); process.argv.splice(2, 0, 'mcp'); }` — injects subcommand then proceeds.
- **Help screen content**: `Usage: themory [options] [command]` with 4 subcommand descriptions. Mirrors mem0 CLI structure (research note Pattern P3).

#### Tasks
1. Extract existing MCP boot logic from `src/agent-tools/cli.ts` to `runMcpServer(options)` function.
2. Rewrite `cli.ts` head: commander program + 4 `.command(...)` declarations (mcp/server/migrate/health) — `server`, `migrate`, `health` stubbed with `console.log('TODO')` for now (filled by T2.3-T2.5).
3. Update `package.json` bin: add `themory`, retain `themory-mcp`.
4. Add backward-compat alias detection at entry top.
5. Write test that asserts `themory --help` lists exactly 4 subcommands.
6. Write test that asserts `themory-mcp` alias emits deprecation warning to stderr + still runs MCP.

#### TDD
```
RED:     test('themory --help lists exactly 4 subcommands: mcp, server, migrate, health')
RED:     test('themory-mcp alias emits DEPRECATED warning to stderr')
RED:     test('themory-mcp alias still runs MCP server (regression for v0.3 tests/e2e/agent-tools/round-trip)')
GREEN:   implement commander scaffold + alias detection
REFACTOR: extract help-screen rendering to const if used in 2+ tests
VERIFY:  npm test -- tests/integration/cli-consolidated && npm test -- tests/e2e/agent-tools/round-trip
```

#### Acceptance Criteria
- [ ] 3 RED tests pass GREEN
- [ ] Existing `tests/e2e/agent-tools/round-trip.test.ts` PASS (regression — MCP still works through new entry)
- [ ] Help screen lists 4 subcommands
- [ ] Pass: size (cli.ts ≤ 150 LoC), lint, typecheck

#### DoD
- [ ] All Tasks completed
- [ ] No backward-compat regression in v0.3 GOAL TEST

### T2.2 — themory mcp subcommand wired

#### Objective
Wire `themory mcp` subcommand to `runMcpServer()` function with all existing options (`--transport`, `--port` for streamable-HTTP).

#### Files to edit
```
src/agent-tools/cli.ts — flesh out `.command('mcp')` with options + action
tests/integration/cli-consolidated.test.ts — add mcp subcommand integration test
```

#### Tasks
1. Wire `mcp` subcommand with options: `--transport <stdio|streamable-http>`, `--port <number>`.
2. Validate options via zod schema.
3. Call `runMcpServer(options)`.

#### TDD
```
RED:     test('themory mcp --transport stdio starts MCP server on stdio')
RED:     test('themory mcp --transport streamable-http --port 8081 binds HTTP port')
GREEN:   wire mcp subcommand
REFACTOR: none
VERIFY:  npm test -- tests/integration/cli-consolidated -t mcp
```

#### Acceptance Criteria
- [ ] 2 RED tests pass GREEN
- [ ] v0.3 GOAL TEST regression still passes
- [ ] Pass: lint, typecheck

#### DoD
- [ ] All Tasks completed

### T2.3 — themory server subcommand wired

#### Objective
Wire `themory server` subcommand that starts the REST API server (Phase 1 work) bound to `--port` (default 8080) with `--db-uri` (default `THEOMEM_PG_URI` env).

#### Files to edit
```
src/agent-tools/cli.ts — flesh out `.command('server')` with options + action
tests/integration/cli-consolidated.test.ts — add server subcommand test
```

#### Tasks
1. Wire `server` subcommand with options: `--port <number>` (default 8080), `--db-uri <string>` (default from env).
2. Action: create pg pool → run migrations → create Memory factory → create server via `createServer({ memory, authVerifier })` → bind to port via `@hono/node-server` adapter.

#### TDD
```
RED:     test('themory server --port 9999 starts REST server')
RED:     test('themory server fails fast with exit 1 when DB unreachable')
GREEN:   wire server subcommand
REFACTOR: none
VERIFY:  npm test -- tests/integration/cli-consolidated -t server
```

#### Acceptance Criteria
- [ ] 2 RED tests pass GREEN
- [ ] `curl http://localhost:9999/v1/health` returns 200 after 5s of subprocess start
- [ ] Pass: lint, typecheck

#### DoD
- [ ] All Tasks completed

### T2.4 — themory migrate subcommand wired

#### Objective
Wire `themory migrate` subcommand that runs `runMigrations(pool)` from `src/local/index.ts:1026`.

#### Files to edit
```
src/agent-tools/cli.ts — flesh out `.command('migrate')` with action
tests/integration/cli-consolidated.test.ts — add migrate test
```

#### Tasks
1. Action: create pg pool → invoke `runMigrations(pool)` → exit 0 on success, 1 on error.
2. Log migration journal entries applied.

#### TDD
```
RED:     test('themory migrate applies pending Drizzle migrations against fresh DB')
RED:     test('themory migrate idempotent: second invocation no-op')
GREEN:   wire migrate subcommand
REFACTOR: none
VERIFY:  npm test -- tests/integration/cli-consolidated -t migrate
```

#### Acceptance Criteria
- [ ] 2 RED tests pass GREEN
- [ ] Exit code 0 on success
- [ ] Pass: lint, typecheck

#### DoD
- [ ] All Tasks completed

### T2.5 — themory health subcommand wired

#### Objective
Wire `themory health` subcommand: DB ping + DI graph readiness check. Exit 0 if both pass; 1 otherwise.

#### Files to edit
```
src/agent-tools/cli.ts — flesh out `.command('health')` with action
tests/integration/cli-consolidated.test.ts — add health test
```

#### Tasks
1. Action: create pg pool → `pool.query('SELECT 1')` → if successful + DI graph composable, exit 0. Else exit 1 with stderr diagnostic.

#### TDD
```
RED:     test('themory health: valid DB URI → exit 0')
RED:     test('themory health: invalid DB URI → exit 1 with stderr mentioning failure')
GREEN:   wire health subcommand
REFACTOR: none
VERIFY:  npm test -- tests/integration/cli-consolidated -t health
```

#### Acceptance Criteria
- [ ] 2 RED tests pass GREEN
- [ ] Stderr non-empty on failure
- [ ] Pass: lint, typecheck

#### DoD
- [ ] All Tasks completed
- [ ] CHANGELOG `[Unreleased]` updated with Phase 2 entries

---

## Phase 3 — Docker stack (Item 17)

**Objective:** Multi-stage Dockerfile → distroless image → production docker-compose → GitHub Actions workflow with GHCR publish + Trivy scan + migrations-on-startup discipline + E2E goal test.

### T3.1 — Multi-stage Dockerfile

#### Objective
Author multi-stage Dockerfile: `node:22-alpine` build → `gcr.io/distroless/nodejs22-debian12:nonroot` runtime.

#### Files to edit
```
Dockerfile (NEW) — multi-stage build
.dockerignore (NEW) — exclude node_modules, .git, tests, .claude/
```

#### Deep file dependency analysis
- `Dockerfile`: ~40 LoC. Stages: `builder` (npm ci + npm run build), `runtime` (COPY --from=builder /app/dist + node_modules production-only).
- `.dockerignore`: aggressive — exclude .git, node_modules (rebuilt in image), tests/, .claude/, *.md, src/**/__tests__/.

#### Tasks
1. Create `Dockerfile` per ADR D6.
2. Create `.dockerignore`.
3. Local build test: `docker build -t themory:dev .` → size < 200MB.

#### TDD
N/A — Dockerfile correctness validated empirically + by T3.5 integration test.

#### Acceptance Criteria
- [ ] `docker build` succeeds locally
- [ ] Final image size < 200MB
- [ ] Image runs as non-root user (`docker inspect` shows `User: nonroot`)

#### DoD
- [ ] Dockerfile + .dockerignore committed

### T3.2 — Production docker-compose.prod.yaml

#### Objective
Author `docker-compose.prod.yaml` wiring the app image + pgvector + optional OTel collector. Production-flavored — separate from existing dev `docker-compose.yaml`.

#### Files to edit
```
docker-compose.prod.yaml (NEW) — production-flavored stack
```

#### Deep file dependency analysis
- `docker-compose.prod.yaml`: ~50 LoC. Services: `themory` (image: `ghcr.io/usetheo/themory:${VERSION:-latest}`, env from `.env`, depends_on: pgvector with `condition: service_healthy`), `pgvector` (same `ankane/pgvector:v0.5.1` as dev). Healthchecks: `/v1/health` HTTP + `pg_isready`.

#### Tasks
1. Create `docker-compose.prod.yaml`.
2. Test locally: `docker compose -f docker-compose.prod.yaml up` → both services healthy within 60s.

#### Acceptance Criteria
- [ ] Compose file YAML valid (`docker compose config` succeeds)
- [ ] Local boot: both services healthy within 60s

#### DoD
- [ ] Compose file committed

### T3.3 — GitHub Actions workflow + GHCR publish + Trivy scan

#### Objective
GitHub Actions workflow building the image, publishing to GHCR on tagged releases, scanning with Trivy.

#### Files to edit
```
.github/workflows/docker-publish.yml (NEW) — build + publish to GHCR + Trivy scan
```

#### Deep file dependency analysis
- Workflow triggers: `push` to `develop` (build only, no publish — verify build doesn't break) + `release` tags `v*.*.*` (build + publish).
- Steps: checkout → buildx setup → login GHCR (`secrets.GITHUB_TOKEN`) → build + push tag → Trivy scan (severity CRITICAL,HIGH; exit 1 on hit).

#### Tasks
1. Create `.github/workflows/docker-publish.yml`.
2. Configure Trivy step with severity threshold per `deps-audit-golden-rule.md`.

#### Acceptance Criteria
- [ ] Workflow YAML valid (`actionlint` if available)
- [ ] Manual dry-run on develop succeeds (build stage only)

#### DoD
- [ ] Workflow committed

### T3.4 — Migrations-on-startup wiring + entrypoint discipline

#### Objective
Container entrypoint: invoke `themory migrate` BEFORE `themory server`. Fail-fast on migration error per ADR D8.

#### Files to edit
```
Dockerfile — set ENTRYPOINT to a shell script OR multi-line CMD
docker-entrypoint.sh (NEW) — runs migrate then server
```

#### Tasks
1. Create `docker-entrypoint.sh` with `set -euo pipefail; themory migrate; exec themory server "$@"`.
2. Copy to image + chmod +x in builder stage.
3. Update Dockerfile ENTRYPOINT.

#### Acceptance Criteria
- [ ] Image startup invokes migrate before server bind
- [ ] Migration failure exits container with code 1

#### DoD
- [ ] Entrypoint committed

### T3.5 — THE GOAL TEST: tests/integration/docker-stack.test.ts

#### Objective
Integration test that spawns the docker compose stack, polls /v1/health, round-trips POST /v1/remember + POST /v1/recall, asserts the recall returns the remembered memory. **THIS IS THE GOAL METRIC.**

#### Files to edit
```
tests/integration/docker-stack.test.ts (NEW) — gated on DOCKER_INTEGRATION=true OR CI=true
```

#### Deep file dependency analysis
- Test uses `node:child_process.spawnSync('docker', ['compose', '-f', 'docker-compose.prod.yaml', 'up', '-d'])`.
- Health-poll loop: `fetch('http://localhost:8080/v1/health')` with 60s timeout, 100ms retry (Pattern P4).
- Round-trip: `POST /v1/remember { userId: 'docker-test-user', text: 'docker compose works' }` → 201 → `POST /v1/recall { userId: 'docker-test-user', query: 'compose' }` → results contains the memory.
- Cleanup: `docker compose down` in `afterAll`.

#### Deep Dives
- **CI vs local**: `describe.skipIf(!process.env['DOCKER_INTEGRATION'] && !process.env['CI'])` mirrors `THEOMEM_PG_URI` gate.
- **Test isolation**: uses ephemeral userId scope; cleans up after.

#### Tasks
1. Create `tests/integration/docker-stack.test.ts`.
2. Implement spawn + health poll + round-trip + cleanup.

#### TDD
```
RED:     test('docker compose up brings app + pgvector healthy within 60s') — FAIL (no test)
RED:     test('POST /v1/remember + POST /v1/recall round-trip against compose stack') — THE GOAL METRIC
RED:     test('image runs migrations on startup (first remember succeeds without manual psql)')
RED:     test('GET /v1/health/db pings pgvector successfully')
GREEN:   implement integration test
REFACTOR: extract health-poll helper to tests/integration/helpers/docker-compose.ts if reused
VERIFY:  DOCKER_INTEGRATION=true npm test -- tests/integration/docker-stack
```

#### Acceptance Criteria
- [ ] 4 RED tests pass GREEN
- [ ] Compose stack boots clean in < 60s
- [ ] Round-trip succeeds against `ghcr.io/usetheo/themory:0.1.0-alpha` OR local-built `themory:dev`
- [ ] Pass: lint, typecheck

#### DoD
- [ ] All Tasks completed
- [ ] **THE GOAL METRIC observed**: round-trip PASS recorded in test output

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | 12th DIP AuthVerifier declared | T0.1 | Interface at src/core/dip/auth-verifier.ts |
| 2 | Hono REST framework adopted | T0.1 + ADR D1 | hono ^4.6.0 in deps |
| 3 | commander CLI lib adopted | T0.1 + ADR D4 | commander ^12.1.0 in deps |
| 4 | OpenAPI auto-gen via zod-openapi | T0.1 + T1.4 + ADR D6 | @hono/zod-openapi ^0.18 + RouteConfig migration |
| 5 | BearerAuthVerifier impl | T1.1 + ADR D3 | src/server/auth/bearer-verifier.ts |
| 6 | Bearer middleware (env-driven gate) | T1.1 | src/server/auth/middleware.ts |
| 7 | POST /v1/remember handler | T1.2 | src/server/handlers/remember.ts |
| 8 | POST /v1/recall handler | T1.2 | src/server/handlers/recall.ts |
| 9 | POST /v1/forget handler | T1.2 | src/server/handlers/forget.ts |
| 10 | POST /v1/reflect handler | T1.2 | src/server/handlers/reflect.ts |
| 11 | createServer factory (DI composition) | T1.2 + ADR D11 | src/server/index.ts |
| 12 | GET /v1/health + GET /v1/health/db | T1.3 | src/server/handlers/health.ts |
| 13 | GET /v1/scopes/:type/:id/memories pagination | T1.3 | src/server/handlers/scopes.ts |
| 14 | OpenAPI 3.1 spec at /v1/openapi.json | T1.4 | src/server/openapi.ts + handler RouteConfig migration |
| 15 | OTel spans per handler | T1.5 | src/server/observability/otel-middleware.ts |
| 16 | Domain-error → HTTP envelope mapping | T1.6 | src/server/errors.ts |
| 17 | Subpath @usetheo/memory/server exported | T1.7 | package.json#exports + tsconfig include |
| 18 | tsconfig + vitest include src/server/** | T1.1 + T1.7 | config updates |
| 19 | themory CLI commander scaffold | T2.1 | src/agent-tools/cli.ts rewrite |
| 20 | themory-mcp backward-compat alias + deprecation | T2.1 + ADR D9 | alias detection + stderr warning |
| 21 | themory mcp subcommand | T2.2 | runMcpServer() function extracted + wired |
| 22 | themory server subcommand | T2.3 | createServer() wired to commander action |
| 23 | themory migrate subcommand | T2.4 | runMigrations() wrapper |
| 24 | themory health subcommand | T2.5 | DB ping + DI graph check |
| 25 | Multi-stage Dockerfile distroless | T3.1 + ADR D6 | Dockerfile NEW |
| 26 | Production docker-compose.prod.yaml | T3.2 | compose file NEW |
| 27 | GitHub Actions GHCR publish + Trivy | T3.3 + ADR D7 | .github/workflows/docker-publish.yml NEW |
| 28 | Migrations-on-startup discipline | T3.4 + ADR D8 | docker-entrypoint.sh NEW |
| 29 | THE GOAL TEST: docker-stack E2E round-trip | T3.5 | tests/integration/docker-stack.test.ts NEW |
| 30 | T16-RED-1..13 (REST API RED tests) | T1.1-T1.7 | distributed across handlers + auth + openapi + otel + errors |
| 31 | T17-RED-1..5 (Docker stack RED tests) | T3.1-T3.5 | docker-stack.test.ts + Dockerfile + compose + entrypoint |
| 32 | T18-RED-1..8 (CLI RED tests) | T2.1-T2.5 + cli-consolidated.test.ts | per-subcommand + alias regression |
| 33 | Backward-compat: v0.3 GOAL TEST tests/e2e/agent-tools/round-trip still passes | T2.1 | alias detection + runMcpServer extraction |
| 34 | CHANGELOG.md [Unreleased] entries | T1.7 + T2.5 + Final Phase | Inquebrável Rule 6 |
| 35 | README.md "REST API server" paragraph | T1.7 | Planned API contract update |
| 36 | /deps-audit clean for 5 new deps | T0.1 | Rule 9 evaluation persisted in this plan § Dependencies |

**Coverage: 36/36 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed (Phase 0 → 1 → 2 → 3 → Final)
- [ ] All tests passing — `npm test` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected per `architecture.md § Module hygiene` (each new file ≤ 500 LoC; per ADR D10, target ≤ 200 LoC per handler)
- [ ] CHANGELOG.md updated under `[Unreleased]` with Phase 1/2/3 entries (Inquebrável Rule 6)
- [ ] Backward compatibility preserved: `tests/e2e/agent-tools/round-trip.test.ts` (v0.3 GOAL TEST) still PASS via `themory mcp` and `themory-mcp` alias paths
- [ ] No new public exports from `src/index.ts` (server lives at subpath `@usetheo/memory/server` per ADR D11)
- [ ] Plan-specific criterion 1: 12th DIP AuthVerifier declared + impl wired + tested
- [ ] Plan-specific criterion 2: THE GOAL TEST `tests/integration/docker-stack.test.ts` 4/4 PASS with `DOCKER_INTEGRATION=true npm test -- tests/integration/docker-stack`
- [ ] Plan-specific criterion 3: `@usetheo/memory/server` subpath import resolves cleanly (`import { createServer } from '@usetheo/memory/server'` typechecks)
- [ ] Plan-specific criterion 4: `themory --help` lists exactly 4 subcommands (mcp/server/migrate/health)
- [ ] Plan-specific criterion 5: `/deps-audit theo-memory-standalone-p0` returns ≥ PASS_WITH_CAVEATS (5 new deps clean)
- [ ] **Runtime-metric proof**: OTel span count > 0 observed in `npm test -- tests/integration/rest-api.test.ts` (closes wiring triad pillar c for REST handlers per T1.5 DoD)
- [ ] **Plan archived**: after `/review` returns `READY_TO_MERGE_WITH_CAVEATS` AND PR merged to `main`, move `.claude/knowledge-base/plans/theo-memory-standalone-p0-plan.md` to `.claude/knowledge-base/plans/completed/`

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phase 0/1/2/3 complete. Plan NOT done until this passes.

**Objective:** Validate that the standalone-distribution stack works end-to-end against `docker compose up` with zero manual setup.

### Execution

```bash
# Unit + integration (default; gated tests skipped without env)
npm test

# Coverage check (≥ 90% on changed files; critical paths 100%)
npm run test:coverage

# Type-check
npm run typecheck

# Lint
npm run lint

# E2E goal test (gated on Docker availability)
DOCKER_INTEGRATION=true THEOMEM_PG_URI=postgresql://postgres:postgres@localhost:5432/postgres npm test -- tests/integration/docker-stack

# CLI integration (gated on running pgvector)
THEOMEM_PG_URI=postgresql://postgres:postgres@localhost:5432/postgres npm test -- tests/integration/cli-consolidated
```

### Acceptance Criteria

- [ ] All test suites green (unit + integration + e2e where present)
- [ ] Coverage ≥ 90% on changed files; critical paths (`src/server/auth/`, `src/server/handlers/`, `src/server/errors.ts`) 100%
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] **Runtime-metric proof**: span count > 0 in REST integration test
- [ ] **THE GOAL TEST**: `tests/integration/docker-stack.test.ts` 4/4 PASS — round-trip works against `docker compose up`

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Pre-existing (NOT caused by Phase 0-3): logged for separate triage; does NOT block plan
3. Plan-caused: fix in same plan-implementation cycle; re-run validation
4. If 3 implementation attempts fail to GREEN on the same task: mark task BLOCKED per cycle-implement.md Stop Condition #1; surface to human

### Handoff to `/review`

When validation PASSes:

- Report state at `.claude/knowledge-base/reviews/theo-memory-standalone-p0-implement-validate-{date}.md`
- Plan ready for `/review theo-memory-standalone-p0`
- Plan archive deferred until `/review` returns READY_TO_MERGE per cycle-plan archive discipline

---

## Cross-references

- **Research basis**: `.claude/knowledge-base/research/theo-memory-standalone-p0-test-patterns-2026-06-03.md` (5 patterns + 28 RED tests + Rule 9 evaluation)
- **Roadmap**: `CLAUDE.md § Phase III bis — Standalone distribution (P0)` Items 16/17/18
- **Project rules cited**: `architecture.md § 3 (DIP)`, `§ 4 (Mem0-shape)`, `§ 8 (error handling)`, `§ 10.2 (drizzle-kit vs runMigrations)`, `§ Module hygiene` (500 LoC budget); `testing.md` (TDD pyramid); `no-paper-names-in-code.md`; `deps-audit-golden-rule.md` (Trivy severity table)
- **ADRs amended/referenced**: ADR-0008 (DIP method-count cap — 12th DIP added uniformly); ADR-0009 (THEOKIT_API_KEY pattern mirrored); ADR-0011 (BiTemporalNotSupportedLocally still mapped in T1.6 for future cloud)
- **Inquebrável Rules cited**: Rule 3 (extreme honesty — backward-compat deprecation discipline); Rule 5 (TDD-first); Rule 6 (CHANGELOG); Rule 9 (Não Reinvente)
- **Companion artifacts produced post-plan**:
  - `/edge-case-plan theo-memory-standalone-p0` (next step)
  - `/deps-audit theo-memory-standalone-p0` (after edge-case plan)
  - `/plan-confidence theo-memory-standalone-p0` (after deps-audit)
