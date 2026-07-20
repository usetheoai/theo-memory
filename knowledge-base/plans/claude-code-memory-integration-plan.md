---
slug: claude-code-memory-integration
milestone_id: M6
created_at: 2026-07-20
goal: >
  Ship a POST /v1/remember/batch endpoint + a secret-scrubbed idempotent Claude-Code-memory
  migration tool + a hooks-first global Claude Code kit, measured by an integration test where a
  batch of N Claude-Code memory nodes imports once, round-trips its provenance on recall, dedups on
  re-run, and a fact written in one Claude Code session is auto-recalled in a fresh session.
---

# Plan — M6 Global Claude Code ⇄ theo-memory integration + migration

## Goal

Ship `POST /v1/remember/batch` + a fail-closed-scrubbed, idempotent Claude-Code-memory migration
tool + a hooks-first global Claude Code kit, **measured by** the integration test in the Final Phase
(batch imports N nodes once, provenance round-trips on recall, re-run dedups, and a session-to-session
auto-recall proof round-trips against the deployed theo-memory REST).

## Context

Grounded entirely in the deep-research blueprint
`knowledge-base/discoveries/blueprints/claude-code-theo-memory-integration-blueprint.md`
(SHIPPABLE_WITH_CAVEATS, 3 cited frames) and the grill
`knowledge-base/grills/claude-code-memory-integration-feature-grill.md`. Decisions resolved:
- **Hooks-first hybrid** (blueprint ADR-1) — hooks are the deterministic auto-capture spine; MCP is
  the explicit complement. The model does NOT reliably call MCP `remember`/`recall`.
- **Migrate via `infer:false` raw-store** (blueprint ADR-2) — the facts are already atomic; the core
  `options.ts:14-20` documents `infer:false` as "Useful for migration / batch import".
- **Batch endpoint is the enabling server-side piece** (blueprint ADR-3) — it is the only server GAP.
- **Auth via `theo_live_*`** ForwardAuth Model B (blueprint ADR-4); prod edge host is owner-gated
  (`app-dev.usetheo.dev` is the SPA) — the kit endpoint is a single config knob, so build +
  validation run against the deployed REST `<DEV_HOST>:8080` (reachable + proven this session).

## Baseline Context

### Files that will be touched

| File | LoC | sha | Role today | Change |
|---|---|---|---|---|
| `packages/api/src/server/app.ts` | 427 | fc0dc92 | composition root — mounts every route + middleware; **over the 300-line check_quality budget** | REFACTOR: extract route registration into modules (< 300) THEN add the batch route (+ the deferred M5 `/v1/version` + `/v1/healthz{,/ready}` aliases the refactor unblocks) |
| `packages/api/src/server/schemas.ts` | 160 | 262a6a5 | zod request bodies; `RememberBody` = `{ScopeFields, text, infer?, attributedTo?, metadata?, category?}.strict().superRefine(SingleScopeRefine)` | ADD `BatchRememberBody` (bounded array of the per-item shape) |
| `packages/api/src/server/handlers/remember.ts` | 46 | 91ea261 | `POST /v1/remember` handler → `scoped.remember(text, {infer, attributedTo, metadata, category})` | ADD a sibling `batchRememberHandler` (loop per item, aggregate) |
| `packages/api/src/server/middleware/rate-limit.ts` | 128 | 1e99ea7 | in-memory sliding-window; `DEFAULT_WRITES=30`/60s per-bearer-token | NO CHANGE — a batch is ONE request (N facts) so it consumes 1 write-slot, not N; the 30/min limit is not a batch bottleneck (see ADR-3-note) |
| `packages/core/src/domain/options.ts` | 322 | 2daf36a | `RememberOptions` incl. `infer` (`infer:false` = verbatim store) | NO CHANGE — reused as-is |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | 603 | 0558ee6 | `scoped.remember` → composite UPSERT idempotency (`confirmation_count`, `rejectedAsDuplicate`) | NO CHANGE — reused per item |
| `scripts/migrate-claude-code-memory.mjs` | (NEW) | — | — | NEW migration tool (parse + scrub + dry-run + batch-import) |
| `~/.claude/hooks/theo-recall.sh` / `theo-remember.sh` / `theo-precompact.sh` | (NEW) | — | — | NEW global kit hooks (OUTSIDE the repo) |

### Current callers / dependents

- `POST /v1/remember` handler: mounted `app.ts` (route table); called by the REST client + the M5
  deploy smoke. The batch handler is additive — no caller of `remember.ts` changes.
- `scoped.remember`: called by `remember.ts` + `recall`/`reflect` paths + the migration tool (new).
  Behavior unchanged; the batch handler is a new caller using the existing per-item contract.
- `createApp`/`createServer` (`app.ts`): called by `run-server.ts` + every `packages/api/src/server/__tests__/*.test.ts`. The route-registration refactor MUST keep all existing route tests green (behavior-preserving).

### Glossary

- **`infer:false` (raw-store)** — persist the text verbatim, skipping LLM fact-extraction; for
  already-atomic facts (a migration corpus).
- **Composite UPSERT idempotency** — `ON CONFLICT (workspace_id, hash, user_id, session_id, agent_id)`
  bumps `confirmation_count` + returns `rejectedAsDuplicate=true`; re-import never double-inserts.
- **Memory node** — one `~/.claude/projects/<slug>/memory/<slug>.md` file (frontmatter + body).
- **Fail-closed scrub** — a node that cannot be safely scrubbed of secrets is SKIPPED, not imported.
- **`additionalContext`** — the `hookSpecificOutput` field a SessionStart/UserPromptSubmit hook uses
  to inject text into Claude Code's context (deterministic auto-recall).

### Architecture boundaries (`rules/architecture.md`)

- The batch handler lives in `packages/api/src/server` (interface layer); it calls the domain
  `scoped.remember` — no new domain type, no `pg` import in `src/server` (DIP preserved).
- The migration tool is a repo `scripts/` node utility (talks HTTP to the REST) — not `src`.
- The hooks are a `~/.claude` companion kit — NOT theo-memory `src` (placement decision).

## Prior Art & Related Work

- Blueprint `claude-code-theo-memory-integration` (this repo) — the full synthesis + ADRs + citations.
- OSS: `claude-mem` (hooks-architecture — SessionStart inject + Stop capture), `the reference project` (Zilliz —
  SHA-256 skip idempotency), REDACTED v3 (raw-import + hash dedup). Cited in the blueprint.
- In-repo pattern reuse: the S2/M4 `recall-trace` REST handler triad (schema + handler + mount) and
  the M5 `server-lifecycle.ts` SRP extraction are the templates for the batch route + the app.ts refactor.

## ADRs

- **ADR-1 — Batch = one HTTP request carrying an array (not N requests).** Alternatives rejected:
  (a) client-side throttle of per-fact `POST /v1/remember` at 30/min — hours-long for thousands,
  fragile per-process limiter; (b) raise `THEMORY_RATE_LIMIT_WRITES` — weakens a real DoS control.
  Chosen: one array request → one write-slot. Rationale: KISS + the limiter is per-request
  (`rate-limit.ts`), so a bounded-size array is inherently within budget (parsimony rung 5).
  **ADR-3-note:** therefore NO rate-limit change is needed — a smaller, honest scope than the
  blueprint's "batch-aware rate-limit" guess.
- **ADR-2 — Refactor `app.ts` route registration into modules BEFORE adding the batch route.**
  Alternatives rejected: (a) add the route to the 427-line file — blocked by the check_quality
  300-line gate + it is a genuine SRP smell; (b) suppress the gate — forbidden (no allowlist bypass).
  Chosen: extract behavior-preserving `register-*-routes.ts` helpers (mirrors the M5
  `server-lifecycle.ts` precedent) — this ALSO unblocks the deferred M5 `/v1/version` + `/v1/healthz`
  aliases (SRP per `architecture.md § 3`).
- **ADR-3 — Migrate via `infer:false` verbatim store, not LLM re-extraction.** Rejected: re-extract
  (cost + non-determinism + the facts are already atomic). Chosen: verbatim + server composite-UPSERT
  dedup. Evidence: `options.ts:14-20`, blueprint ADR-2.
- **ADR-4 — Mandatory fail-closed secret/PII scrub in the migration.** Rejected: import-then-redact
  (the secret already left the machine). Chosen: scrub BEFORE any HTTP write; un-scrubbable node
  skipped. Rationale: `error-handling.md` (fail-fast at the boundary) + OWASP memory-poisoning
  (blueprint Corner 4). NEVER sacrificed by parsimony (`parsimony-ladder.md § Never on the chopping block`).
- **ADR-5 — Hooks are the deterministic spine; MCP is the explicit complement.** Rejected: MCP-only
  (model forgets to call). Evidence: blueprint ADR-1 (unanimous SOTA).

## Dependency Graph

```
Phase 1 (server: app.ts refactor → batch schema → batch handler+mount) ── gates ──> Phase 2 (migration tool, needs the batch endpoint)
Phase 1 ────────────────────────────────────────────────────────────── gates ──> Phase 3 (kit hooks, need the deployed batch endpoint for import; recall/remember use existing verbs)
Phase 1 + 2 + 3 ─────────────────────────────────────────────────────── gates ──> Final Phase (integration validation + live proof + benchmark)
```
Phase 2 and Phase 3 can parallelize once Phase 1 lands + deploys.

## Phase 1 — Server-side batch endpoint (theo-memory repo; gates the milestone)

### T1.1 — Refactor app.ts route registration into modules (behavior-preserving) + add the deferred M5 probe aliases

#### Why this step
app.ts is 427 LoC — over the check_quality 300-line budget, so ANY route addition is blocked
(this is the exact gate that deferred the M5 `/v1/version` aliases). Extracting route registration
into `register-*-routes.ts` helpers (the M5 `server-lifecycle.ts` SRP precedent) brings it under
budget AND is a genuine SRP win. Reasoning: the composition root should compose, not inline every
route; extraction is behavior-preserving (all existing `__tests__` stay green) and unblocks both the
batch route (T1.3) and the deferred M5 `/v1/version` + `/v1/healthz{,/ready}` aliases.

#### Files to edit
- `packages/api/src/server/app.ts` (extract route blocks; add the 3 probe aliases + `/v1/version`)
- `packages/api/src/server/routes/register-probe-routes.ts` (NEW — health/healthz/version, auth-exempt)
- `packages/api/src/server/routes/register-scoped-routes.ts` (NEW — the post-bearer `/v1/scopes/*` + verb routes)
- `packages/api/src/server/handlers/version.ts` (NEW — the deferred M5 version handler)
- `packages/api/src/server/__tests__/version.test.ts` (NEW — from M5)

#### Deep file dependency analysis
`createApp` is called by `run-server.ts` + 15 `__tests__/*.test.ts` files. The refactor MUST preserve
the exact middleware ORDER (auth-exempt routes before `bearerAuth`; per-verb `requireScopeOnPrincipal`
after). The extracted helpers take `(app, deps)` and are called at the same points the inline blocks
were — no ordering change.

#### TDD
- RED: `version.test.ts` — `GET /v1/version` → `{name,version,git_sha,built_at,node}` from env;
  `/v1/healthz` → 200; `/v1/healthz/ready` → 200/503 (mirrors the existing health tests).
- GREEN: extract the route blocks into the two `register-*` modules; add the aliases + version route;
  app.ts < 300 LoC.
- REFACTOR: confirm every existing `packages/api/src/server/__tests__/*.test.ts` stays green.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- `wc -l packages/api/src/server/app.ts` < 300.
- `npx vitest run --config vitest.contract.config.ts packages/api` all green (no behavior change).
- `version.test.ts` green; `/v1/healthz` + `/v1/healthz/ready` + `/v1/version` mounted auth-exempt.

#### DoD
- `npm run typecheck` 0 · `npm run lint` 0 · app.ts < 300 · full api suite green.

### T1.2 — BatchRememberBody schema

#### Why this step
The batch endpoint needs a validated array body. Reusing `RememberBody`'s per-item shape keeps one
source of truth (DRY); a bounded array size caps the request (DoS + the Postgres 65 535 bind-param
limit downstream). Reasoning: validate at the boundary (`error-handling.md`) — reject empty arrays,
oversized arrays, and per-item scope violations before any DB work.

#### Files to edit
- `packages/api/src/server/schemas.ts` (ADD `BatchRememberBody = z.object({ items: z.array(RememberItem).min(1).max(MAX_BATCH) }).strict()`; `RememberItem` = the RememberBody inner shape)
- `packages/api/src/server/__tests__/handlers.test.ts` (batch-schema cases)

#### Deep file dependency analysis
`RememberBody` is `.strict().superRefine(SingleScopeRefine)`. Extract the inner object as
`RememberItem` so both the single + batch bodies share it. `SingleScopeRefine` applies per item.

#### TDD
- RED: valid batch (2 items) parses; empty `items:[]` rejected; `> MAX_BATCH` rejected; an item with
  two scope tiers rejected (per-item SingleScopeRefine); a non-array `items` rejected.
- GREEN: add `BatchRememberBody` + `RememberItem` + `MAX_BATCH` const.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- Schema unit tests green; `RememberItem` shared with `RememberBody` (no duplicate field list).

#### DoD
- typecheck 0 · lint 0 · schema tests green.

### T1.3 — POST /v1/remember/batch handler + mount

#### Why this step
The handler is the milestone-gating deliverable: loops `scoped.remember` per item (reusing the exact
per-item semantics — `infer:false` verbatim, composite-UPSERT idempotency), aggregates results, and
mounts `memory:write`-scoped. Reasoning: all per-item behavior already exists at the core layer
(blueprint: "only the batched HTTP surface is missing"), so the handler is a thin, tested loop.

#### Files to edit
- `packages/api/src/server/handlers/remember.ts` (ADD `batchRememberHandler`)
- `packages/api/src/server/routes/register-scoped-routes.ts` (mount `POST /v1/remember/batch`, `requireScopeOnPrincipal('memory:write')`)
- `tests/integration/batch-remember/batch.test.ts` (NEW — integration vs real pgvector)

#### Deep file dependency analysis
Mount AFTER `bearerAuth` + with `requireScopeOnPrincipal('memory:write')` (same as `POST /v1/remember`,
`app.ts` scope map). The handler resolves the Principal's workspace (never the body). Returns
`{ items: [...], imported: n, deduped: m }` (201). Rate-limit: reuses the existing write-limiter
(1 request = 1 slot) — no change (ADR-1).

#### TDD
- RED (integration, real `ankane/pgvector:v0.5.1`): a batch of N facts (`infer:false`,
  `metadata:{source:'claude-code', project, file}`) → 201; `imported=N`; a subsequent `recall`
  returns them with `metadata.source` round-tripped; a RE-RUN of the same batch → `deduped=N`,
  `rejectedAsDuplicate`, `confirmation_count` bumped, row count unchanged (idempotent).
- RED (negative): a `member`-scope key WITHOUT `memory:write` → 403; oversized batch → 422.
- GREEN: implement the loop + mount.

#### Concurrency tests
(none — single-threaded per request; the per-item UPSERT idempotency is the existing atomic-counter
invariant, already proven by the recall-trace/scoped-memory suites)

#### Failure scenarios (external I/O — pgvector)
- A mid-batch DB error: the handler wraps per-item in try/catch, returns a per-item error status in
  the aggregate (partial success reported honestly), never a silent 500. Test: inject a failing item
  (oversized text past a column limit) → the response reports that item failed + the rest imported.

#### Acceptance criteria
- Integration test green vs real pgvector; idempotent re-run; provenance round-trips; 403 on missing scope.

#### DoD
- `THEOMEM_PG_URI=... npx vitest run tests/integration/batch-remember/batch.test.ts` green;
  typecheck 0 · lint 0 · `/code-quality` no FAIL_HARD.

## Phase 2 — Migration tool (repo `scripts/`)

### T2.1 — Parse + scrub + dry-run + batch-import migration tool

#### Why this step
The tool turns 488 Claude Code memory files into idempotent, provenance-tagged, secret-scrubbed
theo-memory rows. Reasoning: parse BOTH frontmatter variants (nested `metadata.type` + flat `type`)
+ preserve `[[wikilinks]]`; the scrub is fail-closed (a node with an un-redactable secret is skipped,
logged, never sent); dry-run is the default (emit a review report; `--commit` to persist); import via
the T1.3 batch endpoint with `infer:false` + provenance metadata.

#### Files to edit
- `scripts/migrate-claude-code-memory.mjs` (NEW — parse/scrub/dry-run/import)
- `scripts/__tests__/migrate-claude-code-memory.test.ts` (NEW — unit: parser + scrub + dry-run)
- `tests/integration/migration/claude-code-import.test.ts` (NEW — integration vs the deployed/real REST)

#### Deep file dependency analysis
No src dependency — a standalone node script using stdlib (`fs`, `path`) + a YAML frontmatter parse
(reuse an already-installed dep if present, else a minimal regex parser — parsimony rung 4). Talks
HTTP (`fetch`) to the batch endpoint. Secret patterns: a deny-list (API keys `sk-`, `theo_live_`,
AWS `AKIA`, JWTs, `Bearer`, high-entropy 32+ hex/base64) — the ruleset is the security core.

#### TDD
- RED (unit): a fixture dir with (a) a nested-`metadata.type` node, (b) a flat-`type` node, (c) a node
  containing a PLANTED `sk-...` secret, (d) a node with `[[wikilink]]`. Assert: (a)+(b) parse to the
  right tier/tag; (c) the secret is REDACTED (never in the output payload) — and if the node is
  "all secret" it is SKIPPED (fail-closed) + logged; (d) the wikilink is captured as an edge/provenance.
- RED (dry-run): default run WRITES NOTHING (no HTTP) — emits a report (would-import count,
  scrubbed count, skipped count). `--commit` required to persist.
- RED (integration): `--commit` against the real REST imports the fixture batch; a RE-RUN dedups
  (idempotent, `confirmation_count`).
- GREEN: implement.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios (external I/O — the REST endpoint)
- The endpoint unreachable / 401 / 429 → the tool fails LOUD with a clear message + exit non-zero,
  does NOT partially-claim success. Test: point at a dead URL → non-zero exit + "unreachable" message.

#### Acceptance criteria
- Planted-secret fixture: secret NEVER appears in any HTTP payload (asserted); un-scrubbable node skipped.
- Dry-run default writes nothing; `--commit` imports; re-run dedups.

#### DoD
- Unit + integration tests green; `/code-quality` no FAIL_HARD; the tool has `--help` + `--dry-run`(default)/`--commit`.

## Phase 3 — Global Claude Code kit (`~/.claude`, companion)

### T3.1 — SessionStart recall + Stop remember + PreCompact hooks + MCP registration

#### Why this step
The deterministic auto-memory spine (blueprint ADR-5). SessionStart posts to `/v1/recall`
(project-namespaced) and injects top-K via `hookSpecificOutput.additionalContext`; Stop posts the
turn text to `/v1/remember` (`async`, server extracts). Reasoning: hooks fire regardless of the model
(unlike MCP tools). MERGE into `~/.claude/settings.json` (it already has 3 hooks — never clobber).

#### Files to edit
- `~/.claude/hooks/theo-recall.sh` (NEW — SessionStart: curl /v1/recall → additionalContext JSON)
- `~/.claude/hooks/theo-remember.sh` (NEW — Stop: curl /v1/remember, async)
- `~/.claude/hooks/theo-precompact.sh` (NEW — PreCompact flush)
- `~/.claude/settings.json` (MERGE the 3 hook registrations — preserve existing)
- `~/.claude/theo-memory.env` (NEW — the endpoint + `theo_live_*` token; chmod 600, gitignored)
- (docs) `docs/claude-code-kit.md` in the repo (setup + the endpoint config knob)

#### Deep file dependency analysis
The hooks read the endpoint + token from `~/.claude/theo-memory.env` (single config knob — swaps
local-dev ↔ deployed ↔ prod-gateway when the owner resolves the edge host). Endpoint for build/proof:
the deployed REST `http://<DEV_HOST>:8080`. `settings.json` merge: read existing JSON, add the
hook entries under the existing `hooks` map, write back — a Python/jq merge that asserts the prior 3
hooks survive.

#### TDD
- RED: a merge-script unit test — given a settings.json with 3 existing hooks, the merge adds the 3
  theo hooks AND the 3 originals are still present (no clobber).
- RED: `theo-recall.sh` given a mock `/v1/recall` response emits valid `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}` on stdout, exit 0.
- GREEN: implement the hooks + merge.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios (external I/O — the REST)
- Endpoint down at SessionStart → the recall hook emits NOTHING (empty additionalContext) + exit 0
  (NEVER blocks the session; a memory outage must not break Claude Code). Test: dead URL → exit 0, no crash.

#### Acceptance criteria
- Merge preserves the existing 3 hooks; recall hook emits valid injection JSON; remember hook is async;
  memory-outage never blocks a session (exit 0).

#### DoD
- Hook scripts executable + shellcheck-clean; merge test green; the endpoint is a single config knob.

## Failure scenarios (consolidated — external I/O = pgvector + the REST endpoint)

- **pgvector mid-batch error** (T1.3) — per-item try/catch, honest partial-success aggregate, no silent 500.
- **REST unreachable / 401 / 429 in the migration** (T2.1) — fail loud, non-zero exit, no false success.
- **REST down at SessionStart** (T3.1) — recall hook exits 0 with no injection; a memory outage never
  blocks a Claude Code session.

## Coverage Matrix

| M6 DoD (roadmap) | Task(s) |
|---|---|
| `POST /v1/remember/batch` (array, infer:false, provenance, batch-aware limit) + integration test (idempotent, provenance round-trips) | T1.1 (unblock) · T1.2 (schema) · T1.3 (handler + integration) |
| Migration tool (both frontmatter variants + wikilinks; fail-closed scrub; dry-run+review; batch import; planted-secret test) | T2.1 |
| Global kit (SessionStart recall + Stop remember + PreCompact; merge settings.json; MCP --scope user; project-namespaced) | T3.1 |
| Live proof (fact written in one session auto-recalled in a fresh session) | Final Phase |
| Auth documented + kit points at resolved edge (config knob) | T3.1 (env knob) + docs |

## Drawbacks & Risks

1. **Production edge host unconfirmed (HIGH, owner).** `app-dev.usetheo.dev` is the SPA. Mitigation:
   build + validate against the deployed REST `<DEV_HOST>:8080`; the kit endpoint is a single
   config knob; the prod-gateway host is an owner followup, NOT a build blocker.
2. **Secret/PII leakage in the migration (HIGH, me).** Mitigation: fail-closed scrub BEFORE any HTTP
   write; planted-secret test proves it; dry-run review before commit.
3. **app.ts refactor regressing route ordering (MEDIUM, me).** Mitigation: behavior-preserving
   extraction; all 15 existing `__tests__` must stay green (the acceptance gate).
4. **Auto-remember noise/cost (MEDIUM, me).** Mitigation: server-side extraction + confirmation_count
   dedup + a salience threshold in the Stop hook.

## Unresolved Questions

1. Production gateway edge host/path for `/v1/memory/*` (owner/team) — build does not depend on it.
2. Project-namespacing granularity in theo-memory's user/session/agent tiers — the kit uses
   `metadata:{project}` + a recall filter (decided); a dedicated scope id is a possible future refinement.

## Global DoD

- `npm run typecheck` 0 errors · `npm run lint` 0 warnings.
- `app.ts` < 300 LoC (check_quality) · every changed file within the 500-LoC budget (`architecture.md`).
- Phase-1 integration (batch) + Phase-2 (migration, planted-secret) + Phase-3 (merge) tests green.
- `/code-quality` verdict ∉ {FAIL_HARD, INVALID}.
- CHANGELOG `[Unreleased]` updated.

## Final Phase — Integration Validation + live proof + benchmark

- **Integration chain:** `npm run typecheck` + `npm run lint` + the batch integration + the migration
  integration (against the deployed REST) + the settings-merge test — all green.
- **Live proof (the milestone metric):** run the migration (`--commit`) of a small real subset →
  a fact is stored; then a SessionStart recall hook against the same project injects it — proven by a
  scripted round-trip (remember via batch → recall via the hook path → the fact appears).
- **Benchmark (owner directive — DEVE TER DADOS E VALIDAÇÕES EM BENCHMARK):** measure batch-import
  throughput (facts/sec for a batch of N, ≥3 runs mean±stddev) vs the per-fact `POST /v1/remember`
  baseline (proving the batch endpoint's necessity), recorded in `docs/benchmarks/m6-batch-import.md`
  with the reproduction command.
