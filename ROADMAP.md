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

- **Graph-DB backend (Apache AGE / a graph database)** — *why excluded:* Item 14, declined 2026-06-22. 1–2 hop needs only Postgres JOINs; poly-store complexity is unjustified.
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
2. **`import` namespace invites scope creep (MEDIUM)** — openmemory/REDACTED/... importers. Mitigate: ship ONLY `import claude-code`; document the namespace as future-extensible; add other sources only on real demand.

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
- [ ] Memórias verbatim/importadas ganham grafo (blueprint D2 — gap deixado pela Phase A D1, que removeu a extração inline do `infer:false` por paridade REDACTED).
- [ ] Dashboard Entities Fase 2 desbloqueada: coluna TYPE + filtro por type (theo-cloud#253 deferral).

**Dependencies:** M12

> Skill-default: most recent `[x]` milestone at amendment time (todos M0–M12 já [x] → M13 elegível imediatamente).

**Top risks (new — pre-existing risks documented elsewhere in roadmap):**

1. Custo/latência LLM do backfill (~730 memórias + ~840 entidades) — mitigação: batching bounded, dry-run com estimativa de custo, idempotência (re-rodar nunca duplica).
2. Substituição destrutiva do grafo atual (perda de provenance/edges válidas) — mitigação: supersede/soft-delete (nunca hard-delete em massa) + verificação fail-closed de filtros em operações em massa (lição do incidente theo-cloud#252).

**Why now (from grill Q1):**

A análise da tela Entities (2026-07-23) MEDIU o ruído que a extração heurística deixou: 80 entidades ALL-CAPS (LOW/MEDIUM/HIGH/BLOCKER/UI/API…), 53 nomes ≤3 chars, fragmentos truncados como entidades, e types persistidos que são rótulos do MECANISMO de extração (PROPER 734 / COMPOUND 89 / QUOTED 16) — o ruído domina o ranking do dashboard e bloqueia a coluna TYPE. A Phase A (D1+D6, shipped) estancou a fonte; o M13 limpa o estoque e completa a tipagem semântica. Tracked: theo-memory#111.

---

## M14 — [ ] Paridade de recall do kit Claude Code (leitura contínua + autoria), preservando `(workspace, user, session-opcional)`

> Added 2026-07-24 by `/roadmap-feature` (slug: `claude-code-kit-recall-parity`). See CHANGELOG `[Unreleased] § Added`.

**Objective:** Fechar o gap de LEITURA do agente em DUAS superfícies — os lifecycle hooks do kit (`docs/claude-code-kit/`) E as tools MCP. Hoje o kit registra 4 hooks e 3 são ESCRITA — medição live: 1.804 escritas/24h mas **79% das 2.520 memórias vivas nunca foram lidas** (`last_accessed_at IS NULL`). O único hook de leitura busca pelo NOME DO PROJETO (constante), uma vez por sessão, `topK:5`. No MCP, o agente escreve entidades (M13) mas não tem `list_entities` para recuperá-las. Este milestone entrega a experiência de recall contínuo + separação de autoria do plugin de memória de referência para o Claude Code — mas adaptada ao modelo multi-tenant, NUNCA copiada de um plugin single-tenant.

**Definition of done:**

- [ ] Hook `UserPromptSubmit` faz recall pelo **PROMPT** do usuário (não pelo nome do projeto), scoped a `(workspace, user, session-opcional)`; pula prompts curtos por limiar.
- [ ] `attributed_to` (v1.1) separa autoria por ORIGEM DE HOOK: user-prompt → `user`; resumos de sessão/compactação → `assistant` — nunca inferido. Impede que sugestões do assistente virem "preferência do usuário".
- [ ] `PreToolUse`/`PostToolUse` trazem memórias contextuais (por arquivo aberto / por erro de comando), no mesmo escopo.
- [ ] Wizard `/onboard` idempotente (detecta `CLAUDE.md`/`AGENTS.md`) + guarda `PreToolUse` anti-escrita em `MEMORY.md` + distribuição via marketplace de plugin.
- [ ] **Paridade de superfície MCP:** o server expõe `list_entities` (reusa o handler REST `/entities`) e `get_memory` por ID (reusa `MemoryStore.get(memoryId)`, já shipado) — cada um herdando o Principal `(workspace, user)` da credencial/AsyncLocalStorage, JAMAIS aceitando `user_id` do argumento da tool. `update_memory` fica FORA por contrato (ADR-0003, ADD-only: mutação = `forget`+`remember`). `delete_entities` fica FORA deste milestone: exige primitivo de forget-de-entidade que o core NÃO tem (só `supersedeEntity`, que re-tipa) e toca a classe de bug do cascade-delete (theo-cloud#252) — tratar em milestone próprio com guarda fail-closed de filtro, não por paridade de superfície.
- [ ] **Teste de isolamento cross-tenant E cross-user PASSA** (como o M8 fez): o recall/autoria/`list_entities`/`get_memory` de um `(workspace A, user X)` jamais retorna dado de `(workspace B)` nem de `(workspace A, user Y)`.

**Dependencies:** M8, M10, M12

> M8 = invariante de isolamento `(workspace,user)`; M10 = scope-aware recall (global ∪ session) que é o motor do recall por prompt; M12 = o kit + skill que este milestone estende. Todos `[x]` → M14 elegível imediatamente.

**Top risks (new — pre-existing risks documented elsewhere in roadmap):**

1. **Vazamento cross-tenant/cross-user** — um recall por prompt que aceite `user_id` do body (como o plugin single-tenant de referência faz) vazaria memória entre tenants/end-users, destruindo a tese do produto. *Mitigação:* `workspace` da credencial + `user` do Principal + `session` opcional do payload, jamais do body; teste de isolamento no DoD (bullet 5).
2. **Latência por prompt** — 1 recall por mensagem adiciona latência ao turno. *Mitigação:* pular prompts curtos por limiar + timeout não-bloqueante (o kit já escreve destacado via `theo-lib postDetached`).

**Why now (from grill Q1):**

O owner enviou a doc do plugin de memória de referência do Claude Code e pediu **a mesma experiência**, no nosso modelo `(workspace, user, session-opcional)`. O diagnóstico live justifica a urgência: o sistema ESCREVE muito e LÊ quase nada — 79% do acervo jamais consultado. Já shipamos a fundação de tenancy/routing (M8–M11) e a migração/kit (M12); o que falta é o agente REALMENTE recuperar a memória do end-user durante o trabalho. Escopo escolhido pelo owner: paridade TOTAL. Interop de SUPERFÍCIE (hooks/tool-shape), NÃO data-adapter de vendor — o cut de 2026-05-21 continua valendo (mesmo raciocínio de M12 e do OpenMemory-compat).

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

## Unresolved at inception

- M1 is intentionally gated on a demonstrated need (YAGNI) — resolve that gate before starting M1.
- Naming note: informal "M1/M2" labels in `CLAUDE.md` / memory refer to memory-gap *workstreams* (Item 21 sandbox, episodes), NOT these ROADMAP.md milestones. This file's M0/M1/M2 are the formal machine-tracked milestones.
