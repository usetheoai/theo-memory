# TheMemory — Temporal Context Graph Completeness Roadmap

> Created 2026-07-10 (resolving the `/roadmap-feature` impediment: no `ROADMAP.md` existed).
> This is a **macro** roadmap for the go-forward *temporal context graph* track. It is the
> formal, machine-parseable milestone tracker (`cycle-roadmap` / `/roadmap-feature`).
> The project's full historical record (Items 1–26, shipped) stays in `CLAUDE.md § Roadmap`.
> These three milestones **are** CLAUDE.md Items 27/28/29 — same three deltas, two views.
> Decomposition into tasks is `/to-plan`'s job per milestone (`/auto-plan M<N>`).

## Vision

TheMemory already ships a **temporal context graph** in Postgres-relational form — entities +
`entity_edges` (triples with provenance) + first-class episodes (v0.22) + ontology/custom-types
(v0.16) + graph-aware 1–2 hop recall (v0.19) + bi-temporal `asOf` (v1.1). That is **8 of the 11**
/ "context graph" components already present. This roadmap closes the remaining three
deltas **without a graph database** (Item 14 stays declined) and without chasing feature-parity
with a competitor whose architecture bets on the graph being the substrate — ours is the deduped
bi-temporal memory, with the graph as augmentation.

## Problem

**Root problem:** the shipped graph has three honest gaps — one is a likely correctness bug
(graph traversal ignores temporal validity), the other two are parity niceties of varying value.

**Whose pain:** agents/consumers using `recall({ graphExpand })` can be handed **superseded /
forgotten** memories through the graph path (the only recall path that does not filter `t_invalid`).

## Users

- **Primary:** agent developers using `@usetheo/memory` graph-aware recall (SDK), REST `POST /v1/recall`, and the MCP `recall` tool.
- **Secondary:** dashboard users browsing the Entities / graph views.

## Scope

### In scope (this track)

- Make the graph traversal temporally correct (honor `t_invalid` + `asOf`) — the load-bearing fix.
- Optional edge-own validity windows — only if a concrete need appears (YAGNI-gated).
- On-demand evolving entity summaries — dashboard enrichment.
- Every delta crosses **core (SDK) + REST + MCP + Dashboard** where applicable, behind a DIP.

### Explicitly out of scope

- **Graph-DB backend (Apache AGE / Neo4j)** — *why excluded:* Item 14, declined 2026-06-22. 1–2 hop needs only Postgres JOINs; poly-store complexity is unjustified.
- **Wrapping / as a backend or data-adapter** — *why excluded:* direct competitors; the "Adapters  cut 2026-05-21" decision stands (be the native backend, not a wrapper).
- **Maintained-on-write entity summaries (eager LLM per update)** — *why excluded:* recurring LLM cost for marginal value; M2 is on-demand only.

> To reconsider any of these, write a new roadmap revision — do not silently expand scope.

## Constraints

- TS/Node + Postgres + `pgvector`; Apache-2.0; every capability behind a DIP (ADR-0008 method-count caps).
- No paper/marketing names in `src/**` (`rules/no-paper-names-in-code.md`).
- **Sequencing:** this track sits **behind the in-flight `agentic-skill-execution-sandbox` (CLAUDE.md Item 21)** — it must not jump that queue.
- TDD: every milestone starts with a failing test; M0 is a regression-test-first bug fix.

---

## M0 — [x] Graph-aware recall temporal correctness

> = CLAUDE.md Item 27. Priority **HIGH**, effort **S**. Do this first.

**Objective:** graph-aware recall must never resurface superseded/evicted memories and must honor `asOf`, reusing the shipped bi-temporal predicate (ADR-0011).

**Definition of done:**

- [ ] `PgGraphExpansionStore` final SELECT (`packages/core/src/infrastructure/db/pg-graph-expansion-store.ts:81-92`) filters `m.t_invalid IS NULL` — proven by a RED regression test where a superseded memory is NOT returned through graph expansion, then GREEN.
- [ ] `RecallOptions.asOf` is threaded into the expansion query so the traversal returns the bi-temporal state valid at `asOf` (additive optional field on the `GraphExpansionStore` DIP).
- [ ] Surface parity — core `recall({ graphExpand, asOf })`, REST `POST /v1/recall`, MCP `recall` tool each covered by an integration test asserting the temporal filter.
- [ ] Existing graph-aware-recall suite stays green; `CHANGELOG.md [Unreleased]` updated.

**Dependencies:** graph-aware-recall (v0.19, shipped) + bi-temporal `asOf` (v1.1, shipped). Sequenced after Item 21 (sandbox).

**Top risks (new):**

1. Hidden callers relying on stale-inclusion behavior — mitigate: grep callers + integration coverage before merge.
2. `asOf` threading touches the DIP signature (pre-release breaking) — mitigate: additive **optional** field, default preserves current behavior.

**Why now:** it is almost certainly a correctness bug — the graph path is the ONLY recall path that ignores `t_invalid`, so it can silently resurrect forgotten facts. Cheap (S) and it restores trust in graph recall; it also delivers ~80% of M1's value via the source-memory FK.

---

## M1 — [x] Edge-level validity windows + fact invalidation

> = CLAUDE.md Item 28. Priority **MEDIUM**, effort **L**, **~80% redundant with M0**. YAGNI-gated — stays `[ ]` by design until a real need appears.

**Objective:** give `entity_edges` their own temporal validity + automatic fact invalidation, for contradictions that are independent of a single source memory.

**Definition of done:**

- [ ] **Decision gate FIRST** — a concrete edge-granular historical query is demonstrated to be needed. If not, this milestone remains `[ ]` (documented as intentionally parked, not incomplete).
- [ ] Migration adds `entity_edges.t_valid` / `t_invalid`.
- [ ] Invalidation policy behind a DIP; reuse distillation `ConflictResolutionPolicy` rather than fork a second contradiction engine.
- [ ] Surfaces: core, REST `/v1/entities` + graph, MCP, Dashboard graph view distinguishes active vs superseded edges.
- [ ] `CHANGELOG.md [Unreleased]` updated.

**Dependencies:** M0 (delivers ~80% of this via the `source_memory_id` FK).

**Top risks (new):**

1. Building it speculatively is wasted effort (~80% redundant with M0) — mitigate: the DoD's decision gate blocks work until need is proven.
2. Auto edge-invalidation duplicates distillation's `ConflictResolutionPolicy` — mitigate: reuse that policy, do not fork (DRY).

**Why now:** NOT now — parked. Listed for completeness/traceability so the delta is not lost.

---

## M2 — [x] Evolving entity summaries (on-demand)

> = CLAUDE.md Item 29. Priority **LOW**, nice-to-have. On-demand only — never eager LLM per write.

**Objective:** entities expose a `summary` reflecting accrued facts, computed on-demand at view time.

**Definition of done:**

- [ ] Entities expose a `summary` via REST `GET /v1/scopes/:type/:id/entities`.
- [ ] Summary is computed **on-demand** at view time (no per-write LLM cost) — locked by an ADR; optional cache invalidated on write.
- [ ] Surfaces: core, REST, MCP, Dashboard Entities tab renders it.
- [ ] `CHANGELOG.md [Unreleased]` updated.

**Dependencies:** entity+relation extraction (v0.11, shipped) + ontology (v0.16, shipped).

**Top risks (new):**

1. On-demand latency/cost if recomputed per view — mitigate: cache + invalidate-on-write.
2. Scope creep into maintained-on-write (eager LLM) — mitigate: ADR locks on-demand.

**Why now:** lowest priority; dashboard enrichment after M0. Do only if the Entities view demands it.

---

## M3 — [x] Dashboard UI for the temporal context graph (theo-cloud)

> Added 2026-07-10. The UI companion to M0/M1/M2 — surfaces the shipped backend in the
> **theo-cloud** dashboard (separate repo: `../../theo-cloud/theo-cloud/dashboard`, React 19 + Vite;
> BFF gateway in Go at `theo-cloud/internal/`). M0/M1/M2 are backend-complete + released
> (v0.28/29/30); this closes the honest UI gap the reviews flagged.

**Objective:** the dashboard renders the temporal context-graph features — entity `summary`
(M2) in the Entities tab, and an active-vs-superseded edge toggle (M1) in the graph view.
M0 (recall `graphExpand`/`asOf` in the playground) is already done.

**Definition of done:**

- [ ] BFF `Entity` struct carries `summary`; Entities tab renders a `summary` column (M2).
- [ ] BFF `Graph` handler forwards `?includeSuperseded`; graph view has a toggle to include superseded edges (M1).
- [ ] M0 playground (`graphExpand` + `asOf`) verified working end-to-end.
- [ ] Tests: dashboard (vitest) + BFF (`go test`); `CHANGELOG.md` in theo-cloud updated.

**Dependencies:** M0 (v0.28.0), M1 (v0.29.0), M2 (v0.30.0) — all shipped.

**Top risks (new):**

1. Cross-repo: the work is in theo-cloud, tracked here — mitigate: implement + release in theo-cloud per its own cycle; cross-reference this milestone.
2. Per-edge active/superseded styling needs a memory-side validity flag not yet in the `/graph` response — mitigate: M3 ships the include-superseded toggle; per-edge distinct styling is a documented followup if the memory endpoint gains a per-edge flag.

**Why now:** the project-owner asked to close the Dashboard UI gap; the backend is released and the BFF passes most fields through, so the FE lift is small.

---

## M4 — [x] Accountable-forgetting governance + surfaces (retention · MCP · dashboard)

> Added 2026-07-20 by `/roadmap-feature` (slug: `accountable-forgetting-governance`). See CHANGELOG `[Unreleased] § Added`. This is the "S3" that turns the shipped recall-trace wedge (S1 write + S2 read REST, ad-hoc, v0.35.0) into a governed, demoable product. **HONEST SIZE CAVEAT** (`/roadmap-feature` flagged this scope): the trio spans **2 repos** (dashboard in theo-cloud) — `/to-plan` will likely phase it (possible `NEEDS_SPLIT`); the theo-memory pieces gate the checkbox flip, the dashboard is tracked cross-repo.

**Objective:** make accountable forgetting governed + surfaced — per-tenant retention/opt-out bounds the `recall_traces` table, an MCP `explain_recall` tool lets an agent query the negative-space, and a theo-cloud dashboard view lets an operator see what was dropped and why.

**Definition of done:**

- [ ] `RecallTraceRetentionPolicy` DIP + per-workspace config (max-age / opt-out) + a sweep; integration test: traces older than the retention window are swept; an opted-out workspace writes 0 rows (default-safe: opt-out = tracing off, no unbounded growth).
- [ ] MCP tool `explain_recall` registered, workspace-scoped, MCP round-trip test (recall_id → drops), mirroring the S2 REST read.
- [ ] [theo-cloud, CROSS-REPO] dashboard view lists recent recall_ids + drills into the drops (breakdown + drop-reason); e2e/dogfood. Tracked in theo-cloud's own cycle; does NOT gate this checkbox.
- [ ] CHANGELOG `[Unreleased]` + README/docs updated; the retention default + opt-out documented.

**Dependencies:** S1 recall-trace write + S2 read surface (ad-hoc, shipped v0.35.0). Soft: M3 `[x]` (the theo-cloud dashboard infra the view reuses). None of M0–M2 (orthogonal context-graph track).

**Top risks (new):**

1. Cross-repo: the dashboard lives in theo-cloud → `cycle-release` (single-repo) cannot verify the view; risk of marking M4 done with the dashboard lagging. Mitigate: split the DoD — the theo-memory pieces (retention + MCP) gate the flip; the dashboard is a tracked, cross-referenced theo-cloud deliverable.
2. Retention sweep correctness under multi-tenancy: a `DELETE FROM recall_traces` sweep must be workspace-scoped + race-safe (concurrent writes), or it could delete another tenant's traces / leave orphans. Mitigate: workspace-scoped DELETE + a race-aware test; opt-out fail-closed (default safe).

**Why now:** S1 (write) + S2 (read REST) shipped ad-hoc in v0.35.0 — the raw capability exists but is neither governed (the `recall_traces` table grows unbounded) nor surfaced (not demoable), so the differentiator is a technical wedge, not a moat. This milestone makes it governed + operator-visible — the piece the honest competitive assessment identified as what turns the wedge into a defensible position, paired with real customer validation.

---

## M5 — [x] CD pipeline — 100% functional in dev

> Added 2026-07-20 by `/roadmap-feature` (slug: `cd-pipeline-dev`). See CHANGELOG `[Unreleased] § Added`. Adapts the org-standard "Theo CD Pipeline" 8-phase playbook (sibling reference: theo-rag) to theo-memory. **DoD shape = end-to-end** ("100% funcional em dev"): the cycle delivers all pipeline CODE; the live green requires owner-provided infra prerequisites (declared below). Grill: `knowledge-base/grills/cd-pipeline-dev-feature-grill.md`.

**Objective:** every push to `develop` builds the image, pushes it to GHCR, and updates the dev host under a version-gate + health-gate; a `v*` tag publishes a signed release image and deploys nothing — the same pipeline theo-rag runs.

**Definition of done:**

- [ ] **Build unblocked** — `@usetheo/memory/recall-trace-pg` (+ sibling subpaths) registered in `scripts/rewrite-dist-aliases.mjs`; `pnpm build` + `docker build` green; the `publish` run passes the Trivy gate and pushes `ghcr.io/<org>/themory:develop`. (Fixes the current CI red — an unregistered subpath from the S2/M4 recall-trace work, NOT the sharp/libvips flake.)
- [ ] **`deploy-dev` job** (on `develop` only; a `v*` tag SKIPS it) SSHes to the dev host, `git fetch`+`reset --hard $sha`, `docker login ghcr.io`, runs `scripts/deploy-dev.sh` which passes BOTH the version gate (running `themory_app` container's `org.opencontainers.image.revision` == pushed sha) AND the health gate (liveness + readiness green). Deploy files: `docker-compose.deploy.yml` (GHCR image + build-info env) + `scripts/deploy-dev.sh`.
- [ ] **Observability** — `GET /v1/version` → `{name,version,git_sha,built_at,node}` (deployed sha); `/v1/healthz` (liveness) + `/v1/healthz/ready` (readiness `SELECT 1`, 2s timeout) aliases; all auth-exempt + in the OpenAPI contract test.
- [ ] **CI hardening** — `integration.yml` (pgvector ephemeral port + `test:integration` gate) + `security-sast.yml` (semgrep via `docker run`, SHA-pinned `uses:`) on the self-hosted runner; `publish.yml` switched from `secrets: inherit` to an explicit secrets block (Docker Hub push + semgrep rule).
- [ ] **Live proof** — a push to `develop` turns every check green and `/v1/version` on the dev host shows the pushed sha; a tag publishes the signed release image with `deploy-dev` skipped (dev host unchanged).

**Dependencies:** M4 `[x]` (recency). **Owner-provided infra prerequisites** (block the *live* proof, not the code — a coding agent cannot self-serve these): repo secrets `DEV_SSH_KEY` + `OPENAI_API_KEY`; repo variable `DEV_HOST`; dev host provisioned (theo-memory mirror + docker/compose + deploy pubkey authorized + a running pgvector left untouched); GHCR image coordinate confirmed (`ghcr.io/usetheo` vs `usetheodev` divergence between compose and the publish job). Already satisfied: Phase 1 self-hosted runner (online), Phase 8 org fixes (in `usetheodev/theo`).

**Top risks (new):**

1. **Deploy secrets + SSH to a shared dev host.** The deploy job writes a runtime `.env` with `OPENAI_API_KEY` over SSH and logs into GHCR; a leaked `DEV_SSH_KEY` or a `.env` on a shared box is real exposure. Mitigate: dedicated ed25519 deploy key (repo secret), provisioned over stdin (never argv/process-list), removed in an `always` step; `.env` chmod 600; deploy dir isolated so it can't disrupt neighbours (the dev host is shared infra).
2. **Version-gate trusts an OCI label stamped by the ORG reusable workflow, not the Dockerfile.** `deploy-dev.sh` proves which code runs via `org.opencontainers.image.revision`, but theo-memory's Dockerfile does not stamp it (relies on `usetheodev/theo`'s metadata-action). If the label is absent, or the GHCR coordinate is wrong, the gate either always-fails or silently passes the wrong image. Mitigate: verify the label is present on a real pushed image + confirm the exact coordinate before trusting the gate.

**Why now:** the `publish` CI is currently RED (the `@usetheo/memory/recall-trace-pg` subpath from S2/M4 breaks `pnpm build`) so no image ships at all; theo-memory is the *reference* data-plane capability yet the only one without continuous delivery to a dev host (theo-rag already has it); and the shared org substrate is ready (self-hosted runner online, reusable build-publish + GHCR). Fixing + wiring the esteira makes every future merge auto-verified on a live dev host.

---

## M6 — [x] Global Claude Code ⇄ theo-memory integration + migration

> Added 2026-07-20 by `/roadmap-feature` (slug: `claude-code-memory-integration`). Grounded in the deep-research blueprint `knowledge-base/discoveries/blueprints/claude-code-theo-memory-integration-blueprint.md` (3 cited frames, SHIPPABLE_WITH_CAVEATS). Grill: `knowledge-base/grills/claude-code-memory-integration-feature-grill.md`. **Two coordinated pieces:** server-side (theo-memory repo, gates the milestone) + a global Claude Code kit under `~/.claude` (companion, not theo-memory `src`).

**Objective:** make Claude Code (all instances, globally) use theo-memory (hosted) as its persistent memory via a hooks-first hybrid (deterministic `SessionStart` auto-recall + `Stop` auto-remember; MCP as an explicit complement), plus a one-shot, secret-scrubbed, idempotent migration of Claude Code's 487 native memory files into theo-memory — every session becoming real dogfood evidence.

**Definition of done:**

- [ ] **Server-side batch import (theo-memory repo — gates the checkbox):** `POST /v1/remember/batch` (array body, `infer:false` raw-store, provenance `metadata`, `memory:write`, **batch-aware rate-limit** — the 30-writes/60s per-token limiter makes one-request-per-fact infeasible for thousands). Integration test vs real pgvector: batch inserts N facts, `metadata:{source}` round-trips on recall, re-run is idempotent (`confirmation_count` bumps, no double-insert). (The only server GAP — all per-item semantics already exist at the core layer.)
- [ ] **Migration tool:** parses Claude Code memory nodes (BOTH frontmatter variants — nested `metadata.type` + flat `type`; `[[wikilinks]]` → entity edges), runs a **MANDATORY fail-closed secret/PII scrub**, defaults to **dry-run + review** (nothing persists without approval), then batch-imports with provenance. Test: a fixture with a PLANTED secret proves it is scrubbed (never persisted) + re-import dedups.
- [ ] **Global Claude Code kit:** `SessionStart` (auto-recall → inject via `hookSpecificOutput.additionalContext`) + `Stop` (auto-remember, `async`) hooks (+ `UserPromptSubmit`/`PreCompact`) **MERGED** into `~/.claude/settings.json` (never clobbering the existing 3 hooks) + remote MCP `claude mcp add --transport http --scope user`. Recall is **project-namespaced** (no cross-project pollution).
- [ ] **Live proof:** a fact written in one Claude Code session is auto-recalled (injected) in a fresh session on the same project — end-to-end against hosted (or local-dev) theo-memory.
- [ ] Auth documented (`theo_live_*` dashboard-mint → Bearer → memory edge, ForwardAuth Model B) and the kit points at the **resolved** prod edge host.

**Dependencies:** Soft: M5 (deployed/reachable endpoint — the kit talks to the hosted REST). The server-side batch endpoint ships independently. **Owner-provided (blocks go-live, not the build):** the PRODUCTION edge host/path that accepts `theo_live_*` for `/v1/memory/*` (`app-dev.usetheo.dev` is the dashboard SPA, NOT the memory edge; only local dev `:8090` was verified). No hard dep on M0–M4.

**Top risks (new):**

1. **Production edge host unconfirmed (HIGH).** The authenticated `/v1/memory/*` edge for a `theo_live_*` key is only verified on local dev; `app-dev.usetheo.dev` serves the SPA. Wrong host → silent 404. Mitigate: resolve the prod edge with the team (owner task); validate the full flow on local dev first; make the endpoint a single config knob.
2. **Secret/PII leakage in the migration (HIGH).** Claude Code memory files are a known secret vector. A naive import embeds keys/tokens/PII into the shared store. Mitigate: the scrub stage is MANDATORY + fail-closed (un-scrubbable node is skipped, not imported); dry-run shows every redaction before any write.

**Why now:** theo-memory is now deployed + reachable (M5 CD live); this IS the product's own dogfood thesis (CLAUDE.md anchor = "Claude Code auto-memory backed by TheMemory"), so every session becomes real evidence; and the deep research settled the effective architecture — hooks beat MCP tools for reliable auto-capture (the model forgets to call MCP `remember`; hooks are deterministic).

---

## M7 — [x] Claude Code ⇄ theo-memory via the Theo MCP Gateway (dev, SOTA-level)

> Added 2026-07-21 by `/roadmap-feature` (slug: `claude-code-mcp-gateway-dev`). Grill: `knowledge-base/grills/claude-code-mcp-gateway-dev-feature-grill.md`. **Corrects the integration architecture M6 shipped** — M6's own risk #1 ("Production edge host unconfirmed … wrong host → silent 404") materialized.

**Objective:** every Claude Code instance uses theo-memory in the **dev environment** through the **Theo MCP Gateway** behind Traefik (`mcp-gateway-edge`: `PathPrefix(/mcp)`), with the client holding exactly ONE secret — a scoped `theo_live_*` — and the gateway performing MCP-aware auth + downstream credential injection (Model B). Owner directive: **SOTA-level, no workarounds, nothing insecure.**

**Definition of done:**

- [ ] **Discovery-backed design (gates everything else).** A `/discover` blueprint establishes the state-of-the-art Claude Code integration surface — hooks × MCP × plugins/skills × `settings.json` precedence × transport (stdio vs streamable-HTTP vs SSE) — citing primary sources (Anthropic Claude Code docs) **plus ≥ 2 real OSS implementations**. The chosen design is justified against rejected alternatives in an ADR. No assumption ships unexamined.
- [ ] **Gateway-only data path.** Every memory operation from Claude Code reaches theo-memory through the `/mcp` edge on **dev** (`app-dev.usetheo.dev`). The client config holds **exactly one** secret: a scoped `theo_live_*`. **Zero** database credentials and **zero** LLM API keys on any client.
- [ ] **Fail-closed proven at the edge.** No credential → 401/403 (never a default principal); revoked/invalid key → denied. Captured as real request/response evidence, not asserted.
- [ ] **Tenant isolation proven end-to-end.** Account A cannot read account B's memories through the MCP surface.
- [ ] **Every instance, one step.** A brand-new Claude Code instance on a *different* project gains memory with ONE documented command — auto-recall and auto-remember work with no per-project wiring.
- [ ] **No workaround left in the path.** The REST kit's dialect mismatch (`/v1/recall` vs `/v1/memory/recall`) fixed properly via a configurable prefix — not patched around; and no client touches the unauthenticated `:8080` path (issue #101 resolved or designed out).
- [ ] **Regression guard + evidence.** An automated test that fails if edge routing, auth, or MCP scope binding regresses, plus recorded evidence in the milestone run-file.

**Dependencies:** **M5** (CD pipeline — any redeploy of the gateway/BFF rides it) + **M6** (the kit and batch endpoint this milestone reconfigures). Both `[x]`, so M7 is immediately eligible.

**Top risks (new):**

1. **External dependency on a delegated track (HIGH).** The Theo MCP Gateway is `theo-cloud` **M7 — an explicitly delegated track owned by another team**. If it is not deployed/maintained on dev, this milestone blocks on someone else. Current signal: `POST https://app-dev.usetheo.dev/mcp` returns **405** (route exists; handshake/method unverified) while the local edge returns **502** (gateway service down locally). Mitigate: verify the deployed gateway state FIRST and escalate to the owning team — **never route around it with an insecure shortcut.** *Owner stance recorded: schedule risk accepted, insecure shortcuts are not.*
2. **The credential supply chain is broken in dev (HIGH).** `theo_api_keys` on the deployed droplet is **EMPTY (`0 total, 0 active`)** even though a key was minted through the dashboard UI. Either the creation flow does not persist (a defect in another repo) or the environment was cleanroom-rebuilt after minting. Without a valid `theo_live_*`, nothing authenticates and the whole milestone stalls. Mitigate: test the UI creation flow as the FIRST executable step; if it does not persist, file the upstream bug and treat it as blocking.

**Why now:** activating the M6 kit exposed that the live integration is on the **wrong architecture** — the MCP was registered as **stdio**, putting Postgres *and* OpenAI credentials on every client, while the hooks pointed at a **public endpoint with no authentication whatsoever** (issue #101: writes accepted with no header and with an invalid token, from an arbitrary internet IP). The correct design already exists in `theo-workspace/dev/traefik/dynamic.yml:79-91` — `/mcp` → Theo MCP Gateway, MCP-aware auth, Model B credential injection — it was simply never wired for Claude Code on dev. Per the owner: *"se o theo-memory não funciona com o Claude Code, ele é um produto morto."*

---

## M8 — [x] `(workspace, user)` isolation model + agent-chosen session↔global routing

> Added 2026-07-21 by `/roadmap-feature` (slug: `intelligent-memory-routing`). Grill: `knowledge-base/grills/intelligent-memory-routing-feature-grill.md`. First of the 4-milestone **agent-driven memory placement & lifecycle** initiative (M8–M11). Revised 2026-07-21 to the owner-corrected isolation model (see § shared model below).

**Shared isolation model (applies to M8–M11 — the load-bearing contract):**

- Memory is isolated by a hierarchy of composite keys, ALL rooted at `(workspace, user)`:
  - **global** = `(workspace_id, user_id)` — the user's durable memory, spanning ALL their sessions.
  - **session** = `(workspace_id, user_id, session_id)` — one conversation, ephemeral.
- **Every key includes `user_id`. There is NO `(workspace)`-only scope.** Sharing memory across users in a tenant is FORBIDDEN — user A must never read user B's memory (cross-user leak is a security defect, not a feature).
- **Attribution is orthogonal:** within any scope a memory records `attributed_to` = `user` (the human) OR `agent` (Claude Code). User-memory and agent-memory coexist in the same session and in global (reuses the existing `attributed_to` column).
- **Routing authority = the agent.** Claude Code chooses per fact whether it is `session` (ephemeral) or `global` (durable). Auto-hooks default to `session`; an explicit agent choice writes to `global`.

**Objective:** harden `(workspace, user)` into a REAL isolation boundary by making `user_id` mandatory across the session/agent scopes (today `SessionScope.userId?` / `AgentScope.userId?` are optional — a latent cross-user exposure), and add a `MemoryRoutingPolicy` DIP where the agent (Claude Code) routes each fact to `global` `(workspace, user)` or `session` `(workspace, user, session)`, attribution preserved; the default policy preserves today's behavior for backward-compat.

**Definition of done:**

- [ ] `user_id` is MANDATORY on the session (and agent) scopes: `session` = `(workspace_id, user_id, session_id)`. The current optional `SessionScope.userId?` / `AgentScope.userId?` become required; every store/recall query filters by the FULL composite key of the resolved Principal `{workspaceId, userId}`.
- [ ] **Cross-user isolation invariant PROVEN (hard gate).** Integration test against real `ankane/pgvector:v0.5.1`: within ONE workspace, user B cannot read user A's `global` OR `session` memory. No `(workspace)`-only shared scope exists in the schema or the query layer.
- [ ] `MemoryRoutingPolicy` DIP (within ADR-0008 method-count discipline) + default `LegacyRoutingPolicy` (backward-compat: preserves current placement). The agent decides `global` vs `session`: an explicit MCP `remember` durable choice → `global`; a Claude Code auto-hook write → `session`.
- [ ] Attribution recorded per memory: `attributed_to` = `user` | `agent`, coexisting in the same scope (reuse the shipped column — Rule 9).
- [ ] Every routing decision emits a typed `MEMORY_EVENTS` OTel event (Princípio 3): chosen scope + attribution + who decided (agent-explicit / hook-default).
- [ ] Integration test (real pgvector): an agent-durable write lands in `global` `(workspace, user)`; a hook write lands in `session` `(workspace, user, session)`; both filtered so another user in the same workspace sees neither.

**Dependencies:** **M6** + **M7** (the Claude Code write paths this routes). Both `[x]`, so M8 is immediately eligible.

**Top risks (new):**

1. **Per-user isolation is a SECURITY hardening of a currently-cosmetic partition (HIGH).** `scope.ts:74-76` documents `user_id` within a workspace as "a partition, NOT the security boundary" today. Promoting it to an enforced boundary + making it mandatory is security-critical: a mistake leaks one user's memory to another (FORBIDDEN). Mitigate: the cross-user isolation test is a hard gate; `user_id` mandatory enforced at BOTH the type layer and every query; fail-closed when the Principal has no `user_id`.
2. **Contract change to the scope shape (MEDIUM).** Making `SessionScope.userId` mandatory changes a public contract (currently optional) and interacts with the locked scope semantics → owner sign-off + CLAUDE.md amendment. Mitigate: ship behind the backward-compat default policy; migrate existing single-scope callers explicitly.

**Why now:** activating the M6/M7 integration proved every write is dumped into one durable scope while session/agent tiers sit empty AND their `user_id` is optional — so the moment session-tier writes are used as designed in a multi-user tenant, a memory becomes `(workspace, session)` with no user binding, a latent cross-user exposure. The system is multi-tenant AND multi-user-per-tenant; the isolation unit MUST be `(workspace, user)`. This milestone makes that true and lets the agent route durable-vs-ephemeral like the assistant's own memory does.

---

## M9 — [x] Session → global consolidation (within the same `(workspace, user)`)

> Added 2026-07-21 by `/roadmap-feature` (slug: `intelligent-memory-routing`). Second of the M8–M11 initiative. Uses the § shared isolation model in M8.

**Objective:** at session boundary / `reflect`, promote `session` `(workspace, user, session)` memories that prove durable UP to that same user's `global` `(workspace, user)` scope — never crossing to another user, never to a workspace-shared scope (none exists) — carrying provenance; the rest decay via the existing forgetting pipeline (bounded session growth).

**Definition of done:**

- [ ] A `ConsolidationPolicy` reusing the `reflect` / `ConflictResolutionPolicy` + triadic-eviction machinery (Rule 9) that promotes `session` → `global` **within the same `(workspace, user)`**, with `derivedFrom` provenance.
- [ ] Promotion rule: `session` → `global` on confirmation_count ≥ N (N ≥ 3) OR LLM-judged durable OR agent-marked-durable. No `global` → anything (global is already the user's top durable scope).
- [ ] Non-promoted session memories decay via triadic eviction (bounded session growth, proven).
- [ ] **Isolation preserved (hard gate):** promotion never moves a memory out of its `(workspace, user)` — a test asserts a promoted memory keeps the same `workspace_id` + `user_id` and is invisible to any other user.
- [ ] Integration test (real pgvector): 3 exact mentions of one fact by user A dedup (composite UPSERT, Princípio 1) to ONE row with `confirmation_count = 3`, which is then promoted to a `global` memory under `(workspace, userA)`; provenance is that row's id + a `consolidation_history` audit row (id-preserving, reversible via `forget`) — NOT 3 distinct source rows (the exact mentions dedup, so provenance resolves to the single promoted row). A one-off session fact is NOT promoted (stays session-scoped, left to the shipped eviction — M9 does not re-prove decay). User B in the same workspace sees none of it. Proven by `tests/integration/consolidation/session-to-global.test.ts` (dedup-chain + isolation) — review-reconciled 2026-07-22.

**Dependencies:** **M8** (routing must place memories in `global`/`session` under `(workspace, user)` before consolidation can move them).

**Top risks (new):**

1. **Wrong promotion pollutes the user's durable scope (HIGH).** A false-positive "durable" judgment permanently pollutes `global` `(workspace, user)`. Mitigate: conservative threshold (confirmation_count ≥ 3) + LLM/agent confirmation + provenance so every promotion is auditable and reversible via `forget`.
2. **Consolidation cost at scale (MEDIUM).** Scanning session scope per boundary is O(session). Mitigate: scoped to the single `(workspace, user)`, incremental (only new-since-last-consolidation), reuse the recall-cache SERIALIZABLE-retry helper.

**Why now:** routing (M8) fills the ephemeral `session` scope; without promotion, a durable fact captured mid-conversation would decay with the noise. This is the ai-memory "session observations consolidate at session-end" pattern, grounded in theo-memory Princípio 1 (confirmation_count) + the shipped eviction/reflect machinery — and it stays strictly inside the user's isolation.

---

## M10 — [x] Scope-aware recall (global + current session union, filtered by `(workspace, user)`)

> Added 2026-07-21 by `/roadmap-feature` (slug: `intelligent-memory-routing`). Third of the M8–M11 initiative. Uses the § shared isolation model in M8.

**Objective:** recall unions the user's `global` `(workspace, user)` with the current `session` `(workspace, user, session)` under a scope-aware ranking (session recency-boosted, global stability-boosted), opt-in via `RecallOptions.scopes`, ALWAYS filtered by `(workspace, user)`; the default preserves today's single-scope behavior (backward-compat).

**Definition of done:**

- [ ] `RecallOptions.scopes` opt-in that unions `global` + current `session` (both under one `(workspace, user)`); default keeps today's single-scope recall.
- [ ] Scope-aware ranking: `session` boosted by recency, `global` boosted by stability/confirmation — documented and deterministic given inputs. Attribution (`user`/`agent`) surfaced on each result.
- [ ] **Cross-user isolation invariant PROVEN (hard gate).** The union query filters by the FULL `(workspace_id, user_id)` of the Principal — a test asserts user B's recall NEVER returns user A's `global` or `session` rows.
- [ ] Integration test (real pgvector): a `session`-only fact surfaces in the current session's recall for its author; a stale/decayed session fact is deprioritized/absent; a `global` fact surfaces across that user's sessions; none of it leaks to another user.

**Dependencies:** **M8** (scopes must be populated under `(workspace, user)`). Independent of M9 — recall works even without auto-promotion.

**Top risks (new):**

1. **Cross-scope union must not break user isolation (HIGH / SECURITY).** Unioning `global` + `session` still has to filter by the FULL `(workspace, user)` key, not just `workspace`. Mitigate: every scope sub-query carries the resolved Principal's `workspace_id` AND `user_id`; the cross-user union test is a hard gate.
2. **Ranking regression hurts recall quality (MEDIUM).** A bad scope weight buries durable facts under session noise. Mitigate: benchmark recall@k before/after on a fixture set; weights configurable per `(workspace, user)`.

**Why now:** once memories live in `global` vs `session` under `(workspace, user)` (M8), a global-only recall misses the current conversation and a session-only recall misses durable knowledge — the union + ranking is what makes the two-scope model actually useful, exactly as the assistant's own memory blends durable facts with the current thread, and strictly within the user's isolation.

---

## M11 — [x] Routing governance & observability (per-`(workspace,user)` config + audit + dashboard)

> Added 2026-07-21 by `/roadmap-feature` (slug: `intelligent-memory-routing`). Fourth of the M8–M11 initiative. Uses the § shared isolation model in M8.

**Objective:** make routing operable and auditable — a per-`(workspace, user)` routing policy config, a full audit trail of every routing/promotion decision (Princípio 3), and a dashboard showing the per-scope (global vs session) distribution + attribution (user vs agent) + the "why" behind each placement — with cross-user isolation continuously asserted.

**Definition of done:**

- [ ] Per-`(workspace, user)` routing policy config (thresholds, LLM-on/off, default scope) with fail-closed defaults, `admin`-scoped writes; a user's config never affects another user.
- [ ] Every routing + promotion decision is a queryable audit record (reuse the M4 recall-trace / governance machinery, Rule 9) naming the chosen scope + attribution + who decided.
- [ ] Dashboard (theo-cloud): per-scope distribution (global vs session) + attribution split (user vs agent) + a per-memory "routed to X because Y" explainer. The cross-repo dashboard piece MAY be split like M4 (does not gate this checkbox if the REST/audit surface ships in theo-memory).
- [ ] **Isolation hard gate:** the audit/config surfaces are workspace+user-scoped — a request for another `(workspace, user)`'s routing record or config returns 404 (no cross-user, no cross-tenant read).
- [ ] Integration test (real pgvector): a routing decision is retrievable via the audit surface for its own `(workspace, user)`; another user's request returns 404.

**Dependencies:** **M8** (routing decisions to govern) + **M9** (promotion decisions to audit). M10 optional.

**Top risks (new):**

1. **Cross-repo dashboard dependency (MEDIUM).** The UI lives in theo-cloud. Mitigate: ship the self-sufficient REST/audit surface in theo-memory first; the dashboard rides M5 CD (as M3/M4 did); split the checkbox per the M4 precedent.
2. **Config surface = new misconfig/attack surface (MEDIUM).** A per-`(workspace, user)` policy that can disable routing could force everything into one scope, or (if mis-scoped) leak across users. Mitigate: fail-closed defaults, `admin`-scoped config writes bound to the caller's own `(workspace, user)`, audit every config change.

**Why now:** routing decisions that nobody can see or tune are unmaintainable — Princípio 3 (auditability) is a core theo-memory contract, operators need to configure and inspect placement to trust it, and the cross-user isolation invariant needs a continuous assertion surface. This is the M8–M11 initiative's operable-in-production capstone.

---

## M12 — [x] `themory import claude-code` — productize the Claude Code memory migration (CLI + kit skill)

> Added 2026-07-22 by `/roadmap-feature` (slug: `themory-import-cli`). Grill: `knowledge-base/grills/themory-import-cli-feature-grill.md`. Productizes the M6 T2.1 script; the deterministic CLI is the engine, the kit skill is the UX (LLM-driven migration REJECTED: fail-closed scrub is a security control, verbatim fidelity, 1 batch request vs 432 MCP calls, deterministic idempotency/reporting).

**Objective:** ship the Claude-Code-memory → theo-memory migration as a first-class surface — a `themory import claude-code` CLI subcommand (dry-run default) + a thin `/migrate-theo-memory` kit skill that orchestrates it — so any kit adopter can import their file-based memories safely (scrubbed, idempotent, zero-config with the kit env).

**Definition of done:**

- [ ] `themory import claude-code` shipped: dry-run default, `--commit`, `--source <dir>`, endpoint/token via `THEOMEM_*` env with `~/.claude/theo-memory.env` fallback; existing unit tests ported and green.
- [ ] Scrub canonical in the shipped package — single source with the kit hooks (M6-SEC-01) — with a sentinel parity test on the deny-list.
- [ ] Kit skill `/migrate-theo-memory` (dry-run → report → confirm → `--commit` → recall verification) + docs (kit README + RUNBOOK).
- [ ] Integration test (real pgvector): import round-trip idempotent (re-run → deduped, zero duplicates).
- [ ] `themory` CLI locked-names amended in CLAUDE.md (+ CHANGELOG): `import` verb added; ships ONLY `import claude-code` (namespace future-extensible, YAGNI).

**Dependencies:** **M6** (migration script + kit hooks + scrub) + **M7** (MCP-gateway path for the skill's recall verification). Both `[x]` — M12 immediately eligible.

**Top risks (new — pre-existing risks documented elsewhere in roadmap):**

1. **Diverged scrub copy in the CLI leaks secrets (HIGH).** Mitigate: ONE canonical scrub module in the shipped package; the kit copies from it; sentinel parity test on the deny-list.
2. **`import` namespace invites scope creep (MEDIUM)** — openmemory/mem0/... importers. Mitigate: ship ONLY `import claude-code`; document the namespace as future-extensible; add other sources only on real demand.

**Why now (from grill Q1):**

The 2026-07-22 live test proved the demand: 432 file-based memory nodes across local projects, 292 carrying secrets that only the fail-closed deterministic scrub kept off the server. The script is repo-internal today — kit adopters have no safe, zero-config migration path. Productizing it (CLI engine + skill UX) closes the last onboarding gap of the Claude Code ⇄ theo-memory integration (M6/M7).

---

## M13 — [x] Re-extração LLM de entidades com types semânticos (corrige #111)

> Added 2026-07-23 by `/roadmap-feature` (slug: `llm-entity-reextraction`). See CHANGELOG `[Unreleased] § Added`.

**Objective:** Substituir o grafo de entidades ruidoso (extração heurística EN-only + types de mecanismo) por extração LLM-primary com types SEMÂNTICOS, via backfill batch idempotente sobre a base existente + tipagem correta nas escritas novas — Fase B do blueprint `multilingual-entity-extraction`.

**Definition of done:**

- [ ] Comando/job de re-extração batch (ex.: `themory reextract`) idempotente, com provenance por substituição (Princípio 3) e custo LLM bounded (batching por contagem E bytes — lição #112) + dry-run com estimativa de custo antes do commit.
- [ ] Types SEMÂNTICOS (PERSON/ORG/PRODUCT/CONCEPT/…) persistidos nas escritas novas E no backfill — zero rótulos de mecanismo (PROPER/COMPOUND/QUOTED) em entidades novas.
- [ ] Ruído medido cai na base live pós-backfill: entidades ALL-CAPS ≤10 (baseline 80) e nomes ≤3 chars ≤10 (baseline 53).
- [ ] Memórias verbatim/importadas ganham grafo (blueprint D2 — gap deixado pela Phase A D1, que removeu a extração inline do `infer:false` por paridade mem0).
- [ ] Dashboard Entities Fase 2 desbloqueada: coluna TYPE + filtro por type (theo-cloud#253 deferral).

**Dependencies:** M12

> Skill-default: most recent `[x]` milestone at amendment time (todos M0–M12 já [x] → M13 elegível imediatamente).

**Top risks (new — pre-existing risks documented elsewhere in roadmap):**

1. Custo/latência LLM do backfill (~730 memórias + ~840 entidades) — mitigação: batching bounded, dry-run com estimativa de custo, idempotência (re-rodar nunca duplica).
2. Substituição destrutiva do grafo atual (perda de provenance/edges válidas) — mitigação: supersede/soft-delete (nunca hard-delete em massa) + verificação fail-closed de filtros em operações em massa (lição do incidente theo-cloud#252).

**Why now (from grill Q1):**

A análise da tela Entities (2026-07-23) MEDIU o ruído que a extração heurística deixou: 80 entidades ALL-CAPS (LOW/MEDIUM/HIGH/BLOCKER/UI/API…), 53 nomes ≤3 chars, fragmentos truncados como entidades, e types persistidos que são rótulos do MECANISMO de extração (PROPER 734 / COMPOUND 89 / QUOTED 16) — o ruído domina o ranking do dashboard e bloqueia a coluna TYPE. A Phase A (D1+D6, shipped) estancou a fonte; o M13 limpa o estoque e completa a tipagem semântica. Tracked: theo-memory#111.

---

## M14 — [x] Paridade de recall do kit Claude Code (leitura contínua + autoria), preservando `(workspace, user, session-opcional)`

> Added 2026-07-24 by `/roadmap-feature` (slug: `claude-code-kit-recall-parity`). See CHANGELOG `[Unreleased] § Added`.

**Objective:** Fechar o gap de LEITURA do agente em DUAS superfícies — os lifecycle hooks do kit (`docs/claude-code-kit/`) E as tools MCP. Hoje o kit registra 4 hooks e 3 são ESCRITA — medição live: 1.804 escritas/24h mas **79% das 2.520 memórias vivas nunca foram lidas** (`last_accessed_at IS NULL`). O único hook de leitura busca pelo NOME DO PROJETO (constante), uma vez por sessão, `topK:5`. No MCP, o agente escreve entidades (M13) mas não tem `list_entities` para recuperá-las. Este milestone entrega a experiência de recall contínuo + separação de autoria + as 9 tools MCP do plugin de memória de referência para o Claude Code — mas adaptada ao modelo multi-tenant, NUNCA copiada de um plugin single-tenant, e reconciliando cada tool com nossos contratos locked (ADD-only ADR-0003; guarda fail-closed do #252).

**Definition of done:**

- [ ] Hook `UserPromptSubmit` faz recall pelo **PROMPT** do usuário (não pelo nome do projeto), scoped a `(workspace, user, session-opcional)`; pula prompts curtos por limiar.
- [ ] `attributed_to` (v1.1) separa autoria por ORIGEM DE HOOK: user-prompt → `user`; resumos de sessão/compactação → `assistant` — nunca inferido. Impede que sugestões do assistente virem "preferência do usuário".
- [ ] `PreToolUse`/`PostToolUse` trazem memórias contextuais (por arquivo aberto / por erro de comando), no mesmo escopo.
- [ ] Wizard `/onboard` idempotente (detecta `CLAUDE.md`/`AGENTS.md`) + guarda `PreToolUse` anti-escrita em `MEMORY.md` + distribuição via marketplace de plugin.
- [ ] **Paridade de superfície MCP — as 9 tools da referência:** o server expõe `list_entities` (reusa o handler REST `/entities`), `get_memory` por ID (reusa `MemoryStore.get(memoryId)`, já shipado), `update_memory` e `delete_entities` — cada um herdando o Principal `(workspace, user)` da credencial/AsyncLocalStorage, JAMAIS aceitando `user_id` do argumento da tool.
  - `update_memory` preserva o contrato ADD-only (ADR-0003): a tool tem o nome da referência para paridade, mas por baixo é `forget(id) + remember(newText)` — mantém `history(memoryId)` para auditoria; NÃO é UPDATE in-place no banco. Se o supersede por identidade não bastar, é um novo verbo composto, não uma coluna mutável.
  - `delete_entities` exige um primitivo NOVO de forget-de-entidade no core (hoje só existe `supersedeEntity`, que re-tipa, não deleta). Ship OBRIGATORIAMENTE com **guarda fail-closed de filtro** — a lição do cascade-delete theo-cloud#252, onde um filtro descartado silenciosamente deletou memórias não relacionadas: a operação ABORTA se o filtro de escopo `(workspace, user)` não for ecoado/confirmado; evento tipado por deleção (Princípio 3 — auditável); soft-delete via `t_invalid`, nunca hard-delete em massa.
- [ ] **Teste de isolamento cross-tenant E cross-user PASSA** (como o M8 fez): o recall/autoria/`list_entities`/`get_memory`/`update_memory`/`delete_entities` de um `(workspace A, user X)` jamais retorna nem deleta dado de `(workspace B)` nem de `(workspace A, user Y)`. Para `delete_entities`, o teste inclui o cenário do #252: um filtro ausente ou não-confirmado ABORTA em vez de deletar em escopo aberto.

**Dependencies:** M8, M10, M12

> M8 = invariante de isolamento `(workspace,user)`; M10 = scope-aware recall (global ∪ session) que é o motor do recall por prompt; M12 = o kit + skill que este milestone estende. Todos `[x]` → M14 elegível imediatamente.

**Top risks (new — pre-existing risks documented elsewhere in roadmap):**

1. **Vazamento cross-tenant/cross-user** — um recall por prompt que aceite `user_id` do body (como o plugin single-tenant de referência faz) vazaria memória entre tenants/end-users, destruindo a tese do produto. *Mitigação:* `workspace` da credencial + `user` do Principal + `session` opcional do payload, jamais do body; teste de isolamento no DoD (bullet 5).
2. **Latência por prompt** — 1 recall por mensagem adiciona latência ao turno. *Mitigação:* pular prompts curtos por limiar + timeout não-bloqueante (o kit já escreve destacado via `theo-lib postDetached`).

**Why now (from grill Q1):**

O owner enviou a doc do plugin de memória de referência do Claude Code e pediu **a mesma experiência**, no nosso modelo `(workspace, user, session-opcional)`. O diagnóstico live justifica a urgência: o sistema ESCREVE muito e LÊ quase nada — 79% do acervo jamais consultado. Já shipamos a fundação de tenancy/routing (M8–M11) e a migração/kit (M12); o que falta é o agente REALMENTE recuperar a memória do end-user durante o trabalho. Escopo escolhido pelo owner: paridade TOTAL. Interop de SUPERFÍCIE (hooks/tool-shape), NÃO data-adapter de vendor — o cut de 2026-05-21 continua valendo (mesmo raciocínio de M12 e do OpenMemory-compat).

---

## M15 — [x] Entity boost realmente contribui no recall (liga o 3º sinal morto — #122)

> Added 2026-07-24. Tracked: theo-memory#122 (achado da análise comparativa mem0 vs theo-memory).

**Objective:** Fazer o componente `entity` do `combineScores` deixar de ser sempre `0` — populando `entityBoostById` a partir do grafo já persistido — e PROVAR por benchmark que o recall melhora, sem amplificar ruído nem ressuscitar candidato sub-threshold.

**Definition of done:**

- [ ] `entityBoostById` populado no Step 6 do `retrieval/pipeline.ts` a partir de `entities` + `memory_entities`, scoped pelo mesmo predicado `COALESCE` dos demais tiers (zero vazamento cross-scope).
- [ ] O boost é ADITIVO e roda DEPOIS do gate semântico — teste provando que um candidato sub-threshold NÃO é ressuscitado pelo boost.
- [ ] Normalização na mesma escala do BM25 (sigmoid) antes do `ENTITY_BOOST_WEIGHT`, para o componente não dominar a soma.
- [ ] **Benchmark obrigatório:** precisão@k medida COM e SEM boost sobre corpus com entidades reais; o número (delta) registrado no relatório de implementação. Sem ganho medido, o boost não liga por default.
- [ ] Comentário-guarda de `recall-trace-store.ts:46` ("Do NOT read signal into it today") removido/atualizado — a coluna `entity` do trace passa a ser significativa e o `explain_recall` mostra a contribuição.
- [ ] Custo controlado: a expansão por entidade não adiciona round-trip não-bounded por recall (medir latência antes/depois).
- [ ] ADR-0007 revisitado — hoje ele descreve `entityBoost` default `true` para um comportamento que não acontece.

**Dependencies:** M13 (grafo populado + filtro de ruído `entity-noise-filter.ts` — ambos já shipados).

**Top risks:**

1. **Amplificação de ruído** — o boost empurra memórias ligadas a entidades espúrias. *Mitigação:* o filtro de ruído já roda no write path (`entity-linking.ts:104`); o benchmark é o gate — sem ganho medido, não liga. Contexto: #111 mediu 83% de ruído no estoque ANTES do filtro; o estoque de dev foi limpo em 2026-07-24.
2. **Latência** — casar entidades da query contra o grafo a cada recall. *Mitigação:* bounded por escopo + medição obrigatória no DoD.
3. **Cobertura desigual** — memórias `infer:false` (import) não têm grafo (`infer-false-path.ts` não chama `linkEntities`; DoD do M13 não entregue), então não recebem boost. *Mitigação:* documentar honestamente; fechar esse gap é escopo separado.

**Why now:**

A análise comparativa com o mem0 (2026-07-24) mostrou que o boost de entidade é o ÚNICO sinal estrutural em que teríamos vantagem sobre o recall deles (o OSS deles é vetorial + filtros; reranker só na plataforma paga). Nós projetamos o sinal, construímos o grafo que o alimenta (M13) e o `combineScores` soma zero — `pipeline.ts:451` diz literalmente "numLinked=0 always". É capacidade construída e não conectada.


## M24 — [x] Bounded per-anchor consolidation que move o caso real 6a1eabeb (#146, fix real de #144; +#145 quarantine)

**Objetivo:** mover o caso real de knowledge-update `6a1eabeb` de stale (`27:12`) para fresh (`25:50`) no bench e2e-qa via consolidação bounded per-anchor (o par de contradição alcança o LLM judge sem abstain), elevando o bench acima do baseline 91.7%.

**Dependencies:** M23 [ ] (investigação que provou o whole-scope regredir).

**Definition of done:**
- [ ] `clusterByProximity` (domínio puro, determinístico) co-loca o par PB (embeddings reais congelados, cos 0.5117).
- [ ] Orquestrador consolida por cluster bounded (sem abstain a >clusterCap).
- [ ] #145: draft de reflect com provenance inválida é quarentenada (evento + counter), não aborta o reflect.
- [ ] Prova keyless vs pgvector real: escopo >clusterCap supersede a PB stale (recall → `25:50`); precision guard segura.
- [ ] THE GOAL TEST: bench real-LLM move `6a1eabeb` para `25:50` e overall ≥ 91.7% (senão, `[ ]` honesto + follow-up).

## M25 — [x] Config em camadas + `themory config` CLI (paridade mem0)

**Objetivo:** resolver a config do TheMemory por deep-merge em camadas (defaults → `~/.themory/config.json` global → `./.themory.json` projeto → env → flags CLI) e expor `themory config init/set/get/list`, centralizando a config hoje espalhada em env-vars — fechando o gap de paridade mais claro com o mem0 (o CLI deles tem config; o nosso não) e a dimensão mais baixa da cross-validation (Configuration 2.5/5).

**Dependencies:** o CLI consolidado `themory` (shipped, M18-era). Todos os milestones já `[x]` → sem bloqueio real; começa agora.

**Definition of done:**
- [ ] `loadConfig()` faz deep-merge defaults→global→project→env→flags; PRECEDÊNCIA unit-testada (env > project, flag > env).
- [ ] `themory config init/set/get/list` funciona; `get`/`list` mostram a FONTE (camada) de cada chave resolvida.
- [ ] ≥1 consumidor real wired (ex.: `themory server` resolve `THEOMEM_PG_URI` via `loadConfig`).
- [ ] SECRETS: `config list` mascara; `config set` recusa gravar chaves-secret no arquivo (env-only, precedente ADR D4); env continua camada 4 com a MESMA semântica (back-compat).
- [ ] Testes unit (precedência/deep-merge) + integração (round-trip do subcomando CLI) verdes; CHANGELOG atualizado.

**Riscos novos:**
- R1 (HIGH) Vazamento de secret: `.themory.json` com API key em plaintext, commitado. Mitig: `config set` recusa secret-keys (env-only); `config list` mascara; `init` avisa/gitignora.
- R2 (MED) Confusão de precedência: arquivo sobrescreve env silenciosamente. Mitig: `config get`/`list` SEMPRE mostram a fonte; precedência testada + documentada.

---

## M26 — [x] Auditoria da suíte de testes (coverage seams)

**Objetivo:** auditar a suíte INTEIRA caçando GAPS DE COSTURA entre features — interações não-testadas, verde-enganoso, e falta de teste do consumidor real — motivado pelo bug de atribuição (memória produzida pelo assistente gravada como fato do `user`) que passou numa suíte 100% verde. A raiz era um seam: `RememberOptions.attributedTo` (origem do request) vs. o palpite per-fato `attributed_to` do LLM, no caminho `infer:true`; cada feature foi unit-testada do seu lado do seam, a interação nunca; e nenhum teste end-to-end exercitava o consumidor real (hook Stop do Claude Code → `/v1/remember` → extração → atribuição gravada). Só apareceu no dogfood. Este milestone sistematiza achar essa classe de gap.

**Dependencies:** nenhuma — todos os M0–M25 já `[x]`. É uma auditoria transversal da suíte existente, não presa a uma feature; começa imediatamente.

**Definition of done:**
- [ ] Inventário de features cujo comportamento cruza caminhos (atribuição/estado através de `infer:true`/`infer:false`, tiers de escopo, hooks de captura) — o mapa de seams.
- [ ] Cada seam sem teste de interação ganha 1 teste (RED-first — prova que falha contra o comportamento pré-fix antes de contar).
- [ ] ≥ 1 teste de integração do consumidor real por hook de captura (payload do hook → `/v1/remember` → store real → assert da atribuição/escopo gravados), não só paridade de recall.
- [ ] Suíte completa verde + typecheck + lint.
- [ ] Relatório listando seams achados + fechados (artefato de auditoria).

**Riscos novos:**
- R1 (HIGH) Escopo explosivo: auditar "todos os testes" pode virar refactor infinito (a suíte é grande). Mitig: time-box + priorizar por criticidade (caminhos de write/auth/atribuição primeiro); não perseguir todo arquivo.
- R2 (HIGH) Recorrência do verde-enganoso: adicionar testes que passam mas NÃO exercitam o seam real (repetir o erro original). Mitig: todo teste que fecha gap DEVE ser RED-first — provar que falha contra o comportamento pré-fix antes de valer.

---

## M27 — [x] Qualidade da memória escrita: destilação de fato durável (paridade mem0)

**Objetivo:** trazer O QUE vira memória à qualidade do mem0. O dogfood da instância deployada (sessão `93959d08…`) mostrou o kit Claude Code gravando, como se fossem fatos duráveis: transcrição de 400 palavras da própria narração do assistant, perguntas do assistant ("Quer que eu prossiga…?") e voz conversacional de 1ª pessoa ("Minha recomendação:", "Se você quer minha leitura:"). O v0.51.0 acertou DE QUEM é a memória (atribuição); este milestone acerta O QUE/COMO. mem0 (`knowledge-base/references/mem0`) é a referência SOTA do comportamento de write — ESTUDADO, não embrulhado como backend (o item out-of-scope "Wrapping mem0 as a backend" segue válido; sobreposição de keyword confirmada como falso-positivo no grill).

**Dependencies:** M14 (paridade de recall do kit — onde a poluição entra no write) e M21 (eval das etapas LLM — mede objetivamente a qualidade da destilação). Ambos `[x]` → começa imediatamente.

**Definition of done:**
- [ ] Gate "durable fact?" no caminho `infer:true` (PADRÃO-LIGADO no kit): descarta interrogativas, turnos de diálogo e 1ª-pessoa-conversacional, e normaliza para 3ª pessoa. RED-first — um turno como "Quer que eu prossiga…?" NÃO é gravado; o caminho `infer:false` verbatim fica inalterado (provado por teste).
- [ ] Stop-hook do kit (`docs/claude-code-kit/hooks/theo-remember.mjs`) entrega fatos destilados, não narração de parágrafo; nenhum item gravado é transcript-dump multi-parágrafo (assert de forma/tamanho).
- [ ] Comando one-shot de limpeza re-destila OU esquece (soft-delete `t_invalid`, reversível) os transcript-dumps e fragmentos conversacionais já gravados; dry-run primeiro; auditável (emite eventos, Princípio 3).
- [ ] Dashboard expõe `attributed_to` (WHO) na tabela de memórias — core + REST (`/v1/dashboard/memory/list`) + gateway + UI (hoje o WHO do fix v0.51.0 é invisível na tela).
- [ ] Métrica objetiva de paridade via harness M21: a fração de itens gravados que são fato-único-3ª-pessoa (julgada pelo eval LLM) atinge paridade com o mem0 no MESMO transcript de entrada — medida, não afirmada. CHANGELOG atualizado + suíte verde.

**Riscos novos:**
- R1 (HIGH) Over-filtering (falso-negativo): o gate descarta fatos legítimos formulados de modo conversacional. Mitig: o harness M21 mede recall de um conjunto rotulado de fatos antes/depois; gate calibrado para manter recall ≥ limiar; limiar sobrescrevível por config (chute errado = mudança de config, não redeploy).
- R2 (HIGH) Paridade mem0 é subjetiva → o DoD nunca fecha. Mitig: definir a métrica concreta ANTES (razão de fato-único-3ª-pessoa julgada pelo eval), paridade = dentro de X% do mem0 no mesmo transcript de entrada.
- R3 (MED) Perda de dado na limpeza one-shot: esquecer memória legítima. Mitig: dry-run + soft-delete (`t_invalid`, reversível) nunca hard-delete + eventos de auditoria por item.

---

## M28 — [x] Cross-validation fixes: recall@1 do falante (#157) + identidade MCP↔dashboard

**Objetivo:** fechar os 2 gaps que o cross-validation ao vivo theo-memory vs mem0 (MCP oficial dos dois, mesmo dataset de 8 fatos + 5 queries, 2026-07-27) expôs, onde o mem0 ficou à frente. (1) **Recall@1 do falante (#157):** a query "profissão do **usuário**" trouxe o fato do café no top-1, porque o falante é normalizado para `user` e uma query PT com "usuário" casa lexicalmente (BM25/entity boost) melhor com fatos que contêm "usuário" do que com o fato do falante (`user`). Precisão@1 4/5 vs mem0 5/5 no mesmo set. (2) **Identidade MCP ≠ dashboard:** o MCP do theo-memory grava sob um `claude-code` fixo, então memórias escritas via MCP são invisíveis no dashboard do usuário autenticado. mem0 (`knowledge-base/references/mem0`) é a referência de paridade; o A/B é o guard de regressão.

**Dependencies:** M15 (entity boost — onde vive o boost lexical que causa a inversão do #157) e M8 (isolamento `(workspace,user)` / resolução de Principal que o fix de identidade MCP reusa). Ambos `[x]` → começa imediatamente.

**Definition of done:**
- [ ] Fix de recall (#157): a regressão A/B (8 fatos + query "profissão do usuário") retorna o fato da profissão no top-1; precisão@1 = 5/5 no set de regressão. RED-first (o comportamento atual falha o Q5@1). Speaker-alias consciente de idioma (`user`↔`usuário`↔`você`) OU expansão de query OU reweight do entity-boost quando o termo casado é o token de falante.
- [ ] Fix de identidade MCP: um write via MCP do theo-memory resolve o usuário a partir do credential/Principal (reusa M8) e aterrissa no scope daquele usuário (visível no dashboard), com **fallback** para `claude-code` quando não há usuário no credential (não-destrutivo). Teste de integração provando o write sob o usuário resolvido E o fallback.
- [ ] O teste de regressão A/B de recall é commitado como guard de paridade mem0 (as 5 queries; nenhuma das outras 4 regride).
- [ ] Suíte completa verde + typecheck + lint; CHANGELOG atualizado.

**Riscos novos:**
- R1 (HIGH) Speaker-alias over-matching: uma expansão `user`↔`usuário`↔`você` pode piorar a precisão de OUTRAS queries. Mitig: a regressão A/B (5 queries) mede precisão@1 antes/depois; o fix não pode regredir as outras 4.
- R2 (MED) Mudança de identidade MCP quebra consumidores fixados em `claude-code`. Mitig: resolved-user é default COM fallback `claude-code`; teste de integração cobre os dois caminhos.

---

## M29 — [ ] Write-side speaker attribution: fala do assistant não pode virar fato do `user` (#160)

**Objetivo:** corrigir o defeito dogfound (#160) em que a extração `infer:true` grava a fala em 1ª pessoa do ASSISTANT como fato do `user` (ex.: "Analisei X" → "user analisou X"), porque `packages/core/src/domain/extraction/prompt.ts:48-50` normaliza QUALQUER falante para a entidade literal `user`, ignorando o `attributedTo:'assistant'` que o kit envia. Comprovado em dois níveis contra o mem0 (`knowledge-base/references/mem0`, a referência de paridade): (a) **fonte** — `parse_messages` (utils.py:61) rotula as linhas por role e o `ADDITIVE_EXTRACTION_PROMPT` impõe "No Meta-Extraction" + `attributed_to` obrigatório + "Attribute correctly: use 'User' for user-stated facts, frame assistant content appropriately"; (b) **dado ao vivo** — no MESMO A/B desta sessão o mem0 gravou "**Assistant** evaluated…/concluded…" enquanto o theo-memory gravou "**user** analisou…/concluiu…". M27 corrigiu a qualidade do fato; M28 corrigiu o recall (#157); a atribuição por falante no write-path ficou aberta.

**Dependencies:** M27 (fact-gate + prompt discipline — onde o fix encaixa) e M28 (speaker-alias no recall — o par write/recall). Ambos `[x]` → começa imediatamente.

**Definition of done:**
- [ ] Fix de atribuição (#160), RED-first: quando `attributedTo:'assistant'`, o sujeito do fato/entidade é `assistant` (frame "Agent …"/"assistant …"), NUNCA `user`. O comportamento atual (grava "user <verbo>" para fala do assistant) falha o teste RED antes do fix.
- [ ] No-meta-extraction / no-echo-extraction (disciplina do mem0): não gravar descrições de ação ("user pediu/perguntou/compartilhou X", assistant repetindo o que o user disse) — extrair o CONTEÚDO durável. Estende o `fact-gate.ts` (M27), fonte única.
- [ ] `attributed_to` populado por fato (`user`|`assistant`) e verificável (via coluna, não só DTO — ver seam da atribuição).
- [ ] Caminho `infer:false` verbatim byte-idêntico (contrato ADR-0001 intacto).
- [ ] Benchmark A/B vs mem0: no mesmo transcript de sessão mista (user+assistant), a taxa de fatos com sujeito-por-atribuição-correto atinge paridade com o mem0 (medido pelo eval M21), rodado ≥ 3×. RED-first: o transcript atual produz "user <verbo>" para ações do assistant.
- [ ] Suíte completa verde + typecheck + lint; CHANGELOG atualizado.

**Riscos novos:**
- R1 (HIGH) Regressão do prompt: parametrizar a normalização do falante por `attributedTo` pode degradar a extração de fatos genuínos do user (que devem continuar `user`). Mitig: o benchmark A/B mede fatos-user E fatos-assistant; nenhum dos dois pode regredir vs a baseline pré-fix.
- R2 (MED) No-meta-extraction agressivo demais descarta fatos válidos embutidos numa ação ("pedi para lembrar que moro em SP" → o fato "mora em SP" deve sobreviver). Mitig: fixtures do fact-gate cobrem "ação com fato embutido" — extrai o conteúdo, descarta só a descrição-de-ação.

---

## State-of-the-art references

Conceptual comparison peers. `` / `` / `` are already cloned under
`knowledge-base/references/` (see `_catalog.md`). / are **not cloned** — this track
used a conceptual cross-check only; clone them via `/roadmap-feature` Step 5 SOTA delta if a
milestone needs line-level study.

| Peer | License | Why it's here | Supports milestone(s) |
|---|---|---|---|
|  | Apache-2.0 | Reference temporal context-graph engine — the source of the 3 deltas | M0, M1, M2 |
| | (managed) | Productized context-graph infra — validates the "graph as augmentation over a memory substrate" framing | M0, M2 |
| (cloned) | Apache-2.0 | Our architectural base (vector + LLM extraction + hybrid retrieval) | M0 |
| `akitaonrails/ai-memory` (not cloned) | MIT | Agent-driven memory placement — the agent picks scope on write, hooks auto-route ephemeral observations, session consolidation at session-end. Adapted (NOT copied) to the owner-corrected model: scopes are `(workspace,user)`=global and `(workspace,user,session)`=session — never a workspace-shared scope (cross-user leak forbidden). Mirrors the assistant's own memory (agent chooses durable-vs-ephemeral, per-user, spans sessions). | M8, M9, M10, M11 |

---

## Revision protocol

- **Marking progress:** flip the checkbox in the `## M<N>` header. `cycle-release` flips it on merge when a plan declares `milestone_id: M<N>`.
- **Adjusting a milestone's DoD:** edit in place, note the date in `CHANGELOG.md`.
- **Adding a milestone:** append `## M3 …` via `/roadmap-feature` (inserts before the `---` above `## State-of-the-art references`). Never renumber/reorder existing milestones.
- **Removing a milestone:** mark `~~## M<N> — [-] <name> (cancelled YYYY-MM-DD — reason)~~` rather than deleting.

---

## M16 — [x] Identidade de ponta a ponta é fail-closed (#121, #84, #102)

> Added 2026-07-24. Tracked: theo-memory#121, #84, #102. Trio de segurança de autenticação — os três falham na mesma direção: identidade ou tenancy resolvida de forma permissiva quando deveria fechar.

**Objective:** Garantir que a identidade (`user`) e o tenant (`workspace`) venham SEMPRE do Principal resolvido no servidor, nunca de entrada controlada pelo cliente e nunca de um default silencioso — fechando a impersonação cross-user do transport MCP, o fallback para o workspace default no caminho OIDC, e a divergência que faz uma key legítima ser rejeitada com 401.

**Definition of done:**

- [ ] `withBearerAuth` anexa o `principal.userId` ao request, espelhando o `attachWorkspace` existente; `scopeFromRequest` prefere o user do auth e só honra `X-Theo-User-Id` quando o Principal NÃO carrega user (#121).
- [ ] Teste de integração que reproduz o repro do #121 e FALHA sem o fix: key da alice + header `X-Theo-User-Id: live-bob` não pode escrever no escopo do bob.
- [ ] O caminho `--auth=both`/OIDC deixa de resolver para o workspace default quando o token não carrega tenancy — passa a falhar fechado com erro tipado (#84).
- [ ] Teste de caso negativo asseverando o erro tipado e a mensagem, não apenas "lança" (per `.claude/rules/testing.md` § 4.1).
- [ ] A key mintada pelo dashboard é aceita pela API do mesmo host — causa da divergência identificada e provada por teste, não por inspeção (#102).
- [ ] Nenhum dos três caminhos degrada em silêncio: toda recusa emite evento tipado observável (Princípio 3).

**Dependencies:** M8 (isolamento `(workspace, user)`, shipado), M14 (ADR-M14-1 — identidade sempre do Principal, shipado).

**Top risks:**

1. **Quebrar a topologia com gateway.** O gateway injeta o header auth-trusted hoje; se o fix passar a ignorá-lo sempre, a topologia Model B quebra. *Mitigação:* o header só é ignorado quando o Principal JÁ carrega user — exatamente o caso da exposição direta.
2. **#102 pode ser ambiental, não de código.** O issue descreve split-brain entre dois planos. *Mitigação:* o DoD exige provar a causa por teste antes de mudar código; se for ambiental, o desfecho honesto é documentar e fechar sem patch.

---

## M17 — [x] O CI prova o que diz provar (#104, #129, #116)

> Added 2026-07-24. Tracked: theo-memory#104, #129, #116.

**Objective:** Fazer o CI executar a suíte que hoje ele ignora, parar de rodar o mesmo trabalho duas vezes, e derrubar o tempo de esteira — nessa ordem de prioridade, porque cobertura invisível é pior que esteira lenta.

**Definition of done:**

- [ ] O CI executa a suíte de contrato (1342 testes) além da de integração — hoje só `test:integration` roda, e as falhas de contrato são invisíveis (#104).
- [ ] Evidência: um commit com falha deliberada de contrato é BARRADO pelo CI (prova de que o gate morde).
- [ ] `Integration` e `Security SAST` deixam de rodar em dobro por commit; o run remanescente é o do evento `pull_request`, que testa o merge commit (#129).
- [ ] Tempo de esteira `develop→deploy` medido antes e depois, com o número registrado (#116). Sem medida, não há entrega.
- [ ] Nenhuma suíte é removida ou enfraquecida para ganhar tempo.

**Dependencies:** nenhuma.

**Top risks:**

1. **Adicionar a suíte de contrato piora o #116.** As duas metas competem. *Mitigação:* o ganho do #129 (metade dos runs) compensa; a ordem do DoD deixa explícito que cobertura vence tempo se houver conflito.
2. **`cancel-in-progress` cancelando o run errado.** *Mitigação:* a chave normalizada preserva o run do `pull_request`, que é o mais informativo.

---

## M18 — [x] O impulso de entidades ranqueia sem eliminar (#125, #127)

> Added 2026-07-24. Tracked: theo-memory#125, #127. Ambos os desdobramentos do M15 tocam `scoring.ts` — tratados juntos para não medir duas vezes.

**Objective:** Corrigir as duas impropriedades do sinal de entidades que o `/review` do M15 expôs: a curva é decrescente em `numLinked` (casar mais entidades rende menos impulso) e, em threshold alto, ligar o impulso ELIMINA candidatos sem vínculo.

**Definition of done:**

- [ ] `entityBoost` passa a ser não-decrescente em `numLinked` — casar 3 entidades da query nunca rende menos que casar 1 (#125).
- [ ] Em threshold alto, ligar o impulso não remove candidato que o mesmo corte retornava sem ele (#127).
- [ ] **Benchmark obrigatório**, com o mesmo instrumento do M15 estendido: precision@k COM e SEM, e `recall_set_churn` medido na banda SENSÍVEL (não no threshold padrão, onde o efeito é aritmeticamente impossível). Sem ganho medido e sem churn zerado na banda sensível, a mudança não entra.
- [ ] O ADR D1 do plano do M15 é revisitado por ADR próprio, com o número que ele não tinha na mesa quando rejeitou as alternativas.
- [ ] Corpus do benchmark ganha tópicos com número VARIÁVEL de entidades casadas — hoje todos casam exatamente uma, então a diferença do #125 sequer aparece na métrica.

**Dependencies:** M15 (shipado em v0.44.0).

**Top risks:**

1. **Saturação do topo.** A forma numerador-only satura em 1.0 e perde discriminação entre os melhores. *Mitigação:* a forma de headroom evita isso; o benchmark decide entre elas por medida, não por gosto.
2. **Mudar `scoring.ts` afeta todo recall.** *Mitigação:* é o caminho mais crítico do produto; o gate é o benchmark com as duas métricas, e o `/review` com agente de domínio.

---

## M19 — [x] O caminho de recall volta a ser editável (#124)

> Added 2026-07-24. Tracked: theo-memory#124.

**Objective:** Decompor `packages/core/src/domain/retrieval/pipeline.ts` (732 linhas contra teto de 300) em estágios coesos, sem mudar comportamento — hoje o gate de qualidade bloqueia QUALQUER edição no caminho de leitura mais crítico do produto.

**Definition of done:**

- [ ] `pipeline.ts` abaixo do teto de 300 linhas do `check_quality.py`.
- [ ] Zero mudança de comportamento: a suíte inteira passa sem alteração em nenhuma asserção.
- [ ] Os blocos duplicados que o hook aponta (linhas 197, 354, 481, 589) extraídos.
- [ ] Fronteiras de extração seguem as já mapeadas no #124 (rerank, threshold, trace, expansion).
- [ ] Benchmark do M15 re-executado antes e depois, com os mesmos números — prova de que o refactor não mexeu no ranking.

**Dependencies:** M18 (tocar `scoring.ts` antes evita refatorar duas vezes o mesmo caminho).

**Top risks:**

1. **Bug sutil de ranking introduzido por refactor.** É exatamente o risco que fez este trabalho ser adiado no M15. *Mitigação:* comportamento congelado por benchmark antes/depois, além da suíte.

---

## M20 — [x] Dependências e runtime sem surpresa (#123, #118)

> Added 2026-07-24. Tracked: theo-memory#123, #118.

**Objective:** Zerar os advisories que tocam runtime e impedir que um binário obsoleto sirva silenciosamente em produção.

**Definition of done:**

- [ ] Os 4 advisories que tocam runtime (`hono` ×3, `@hono/node-server`) resolvidos por upgrade, com a suíte de integração do servidor REST verde (#123).
- [ ] Os 3 HIGH transitivos (`brace-expansion` ×2, `js-yaml`) resolvidos ou explicitamente allowlistados com sunset e justificativa (#123).
- [ ] `themory serve` recusa iniciar com `dist/` mais antigo que o fonte, com erro tipado e mensagem que diz o que fazer (#118).
- [ ] Teste de caso negativo asseverando o erro tipado, não apenas que falha.
- [ ] `pnpm audit` re-executado, com o antes e o depois registrados.

**Dependencies:** nenhuma.

**Top risks:**

1. **Upgrade de `hono` quebrar o servidor REST.** *Mitigação:* a suíte de integração do servidor é o gate; se quebrar, o desfecho é allowlist com sunset em vez de upgrade forçado.

---

## M21 — [x] Eval de qualidade das etapas LLM (extraction · reflect · distill · conflict)

> Added 2026-07-25. Tracked: (novo — sem issue ainda).

**Objective:** Dar às etapas de maior variância do sistema — as que chamam LLM (extração de fatos, reflect/consolidação, distill episódico→semântico, resolução de conflito) — um eval versionado e repetível que falha o CI quando um PR (mudança de prompt ou troca de modelo) regride a qualidade abaixo de um baseline. Hoje essa qualidade só é medida por fixtures one-off dentro de testes unitários; não há guard de regressão para a parte mais frágil do pipeline. **Escopo honesto (ADR-0020):** eval INTERNO de qualidade, NÃO um benchmark comparativo "faster-than" — não reintroduz o benchmark removido em v0.35.0 nem faz claim público comparativo (`public-copy.md § 4` intocado).

**Definition of done:**

- [ ] Datasets golden anotados à mão para cada etapa LLM em escopo (extraction, reflect, distill, conflict-resolution), com ≥ N casos por etapa incluindo casos negativos, versionados no repo (`eval/datasets/*.json`).
- [ ] Runner de eval que executa cada etapa contra seu golden e emite precision / recall / accuracy por etapa, determinístico o suficiente para gate (temperature=0).
- [ ] Baseline versionado no repo; regressão abaixo do baseline (com banda de tolerância, não igualdade exata) FALHA o gate; mudar o baseline exige justificativa no PR.
- [ ] Gate de CI condicional: roda quando a chave LLM (`OPENAI_API_KEY` / `OPENROUTER_API_KEY`) está presente no ambiente do CI; **SKIP honesto** (nunca verde fabricado) quando ausente. Segredos só via env do CI.
- [ ] README/doc de reprodução com o comando exato para rodar o eval localmente + antes/depois de uma execução registrados.

**Dependencies:** nenhuma (M13 é âncora semântica — o pipeline LLM que o eval observa já está shipado e estável; o eval é read-only sobre ele).

**Top risks:**

1. **Não-determinismo do LLM torna o eval flaky.** *Mitigação:* `temperature=0`, banda de tolerância no baseline em vez de igualdade exata, e ≥ 3 runs quando a métrica ficar perto do limite. Um eval flaky é um bug — corrigir ou remover a métrica instável.
2. **Custo/segredo no CI + baseline vira teatro.** *Mitigação:* gate estritamente condicional à presença da chave (SKIP honesto sem ela, jamais fabricar verde — Regra 3); secret apenas via env do CI, nunca commitado; e mexer no baseline exige justificativa explícita no PR para que uma regressão real não seja silenciada como "atualização de baseline".


---

## M22 — [x] Recall honra most-recent-wins em duplicatas ADD-only + disciplina de abstenção do harness (#141, #140)

> Added 2026-07-25. Tracked: theo-memory#141, #140. Blueprint: `.claude/knowledge-base/discoveries/blueprints/stale-recall-and-abstention-blueprint.md`.

**Objective:** Fechar as 2 fraquezas que a contra-prova mem0 (LongMemEval) revelou. **#141 (core):** quando duas memórias ADD-only descrevem o mesmo fato com valores diferentes e nenhuma foi superseded (reflect não rodou), o recall pode ranquear a antiga — o ranking não tem sinal de recência. Fix mínimo: `recencyCollapse` opt-in no seam pós-threshold do recall (colapsa near-duplicates mantendo a mais recente, drop auditável via recall-trace), sem tocar a fórmula de score (não regride entity-boost M18/#127), honrando ADD-only (ADR-0003). **#140 (harness + decline honesto):** o recall foi honesto; quem alucinou foi o *answerer* do harness. O sinal de cobertura já existe (`MemoryItemWithScore.score`) — campo core novo é YAGNI e cruza o override "memory layer, não agent runtime". Fix: coverage-gate helper determinístico no harness e2e-qa; parte core declinada com rationale.

**Definition of done:**

- [ ] `RecallOptions.recencyCollapse?` opt-in; default OFF ⇒ recall byte-idêntico (teste de não-regressão). No conjunto de mutual-exclusion (`RerankerConflict`) + cache-bypass.
- [ ] Fixture determinística **sem LLM** em `packages/eval/src/stages/knowledge-update/`: 2 memórias (valor antigo → novo) com `createdAt` monotônico via clock injetado; recall com `recencyCollapse` retorna a mais recente — **RED antes, GREEN depois** do fix; drop antigo aparece como `superseded_recency` no recall-trace.
- [ ] Coverage-gate helper no harness e2e-qa (`abstém quando recalled.length===0 || max(score) < τ`), função pura testada unitariamente sem chave; regra de abstenção do answerer reforçada.
- [ ] #140: parte core (campo `coverage` dedicado) **declinada explicitamente** com rationale (YAGNI + boundary) comentado no issue.
- [ ] Suíte completa verde; recall existente não-regride (recencyCollapse OFF).
- [ ] Benchmark/evidência determinística registrada em `docs/benchmarks/`.

**Dependencies:** M21 (`packages/eval` + e2e-qa harness) — [x].

**Top risks:**

1. **Regressão de precisão no recall.** *Mitigação:* `recencyCollapse` age SÓ em clusters near-duplicate após o combine (queries sem duplicata intocadas), opt-in, τ conservador (≥ 0.9); teste de não-regressão com a flag OFF prova recall byte-idêntico.
2. **Cache poisoning.** *Mitigação:* `recencyCollapse` entra na lista de cache-bypass (re-ordena o pool), como `scopes`/`diversify`/`rerank`.


---

## M23 — [x] Knowledge-update supersession que move o caso real (#144, follow-up de #141)

> **Delivered in v0.49.0** — the goal (move `6a1eabeb` from stale `27:12` to fresh `25:50`) is
> achieved. M23's own read-time approach (v0.48.2) was an honest negative; the working fix landed
> via M24 bounded consolidation + the #149 conservative-consolidation prompt. Measured with real
> gpt-4o-mini: `6a1eabeb` answers `25:50`, knowledge-update 2/2 (`docs/benchmarks/m24d-149-*.md`).

> Added 2026-07-25. Tracked: theo-memory#144. Blueprint: `.claude/knowledge-base/discoveries/blueprints/knowledge-update-supersession-blueprint.md`.

**Objective:** Fechar o gap real que a contra-prova mem0 revelou: `recencyCollapse` (read-time, cosine@0.9) **estruturalmente não pega** updates do mesmo fato com fraseado diferente ("personal best 27:12" vs "PB 25:50" → 0 entidades compartilhadas, cosseno 0.51). Provado empiricamente que o fix sugerido no #144 (entity-gate) é um false-fix + regride precisão. O fix robusto é **write/reflect-time supersession** (o que o mem0 faz), cuja máquina o TheMemory já tem ~90% (`LlmJudgedMergeConflictPolicy` + `persistConsolidations` seta `t_invalid` + recall filtra `t_invalid IS NULL`); os gaps são (a) não-wired no harness/consumo, (b) escala (`clusterCap`=20 abstém em conversas reais). O cluster de consolidação NÃO é cosine-gated → julga fraseados diferentes juntos.

**Definition of done:**

- [ ] Fixture determinística **keyless** com as DUAS frases REAIS + embeddings reais (LocalTransformer 384, determinístico) — não vetores stub near-idênticos (o erro do M22): (1) counter-proof read-time (recall+recencyCollapse ainda devolve o stale 27:12 — trava que read-time não resolve), (2) prova write/reflect com LLM STUBBADO (`reflect({conflictResolution})` seta `t_invalid` no antigo → recall devolve 25:50), (3) guarda de precisão negativa (par "Google role vs tenure" — mesma entidade, atributos diferentes — NÃO é superseded).
- [ ] Se a escala abstém (cluster>20 no caso real), bound `recallConsolidationCandidates` a um top-k semântico ao redor do fato (forma mem0), sem abstain silencioso.
- [ ] Harness e2e-qa chama `reflect({conflictResolution})` (remember-tudo → reflect → recall) — legítimo "medir o TheMemory bem usado".
- [ ] **Bench re-rodado (LLM real):** reportar HONESTAMENTE se `6a1eabeb` muda de desfecho (devolve 25:50) — mudança de desfecho no bench, não fixture verde. Se LLM/escala não moverem, reportar sem maquiar.
- [ ] Suíte completa verde; recall byte-idêntico quando reflect não roda.

**Dependencies:** M22 (recencyCollapse + e2e-qa harness) — [x].

**Top risks:**

1. **O LLM real pode não pegar a contradição no bench** (ou a escala abstém). *Mitigação:* a prova determinística (LLM stubbado, strings reais) é o gate primário do DoD; o bench é validação de caso-real reportada honestamente (mover ou não). Sem false-fix.
2. **Regressão de precisão ao supersedir demais.** *Mitigação:* guarda negativa (Google role vs tenure) no teste; a supersession é LLM-julgada (não string/cosine), e ADD-only preserva o antigo via `asOf`.

---

## Unresolved at inception

- M1 is intentionally gated on a demonstrated need (YAGNI) — resolve that gate before starting M1.
- Naming note: informal "M1/M2" labels in `CLAUDE.md` / memory refer to memory-gap *workstreams* (Item 21 sandbox, episodes), NOT these ROADMAP.md milestones. This file's M0/M1/M2 are the formal machine-tracked milestones.
