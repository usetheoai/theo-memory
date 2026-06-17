---
slug: integration-suite-stabilization
created_at: 2026-06-15
goal: Drive the integration test suite to 0 failures deterministically as a production-deploy CI gate.
---

# Plan: Integration Suite Stabilization

> **Version 1.0** — The integration suite (`tests/integration/**`, 96 files) reports 26 files / 50 tests failing against a real `ankane/pgvector:v0.5.1`, while the product itself passes (contract suite 930 green; every failing file passes in isolation). The failures cluster into three pre-existing buckets: (A) shared-database schema-state pollution between files, (B) assertion drift from the workspace reorg, (C) LLM-gated tests that 401 instead of skipping cleanly. This plan makes the suite a deterministic green gate by standardizing DB-touching tests onto per-file isolated databases cloned from a migrated template (FAANG-level isolation), triaging each reorg-drifted assertion as stale-vs-regression, and making LLM-gated tests skip cleanly without a key. Outcome: the suite is trustworthy enough to gate a production deploy.

## Goal

> "Enable the `@usetheo/memory` integration suite to run deterministically green so that it can gate a production deploy, measured by `THEOMEM_PG_URI=... pnpm vitest run --config vitest.integration.config.ts` returning 0 failed tests (LLM-gated tests skipping cleanly without a key)."

## Context

A dedicated session (2026-06-15) fixed a genuine production bug — the dim-change canary read the catalog on a separate pooled connection outside its `BEGIN/COMMIT`, so every parametric `runMigrations(pool, { embeddingDim })` false-failed (commit `98c60eb`; `dim-change.test.ts` 11/11 green; real-LLM 384-dim E2E green). Re-running the FULL integration suite afterward surfaced 26 failing files / 50 failing tests that are **pre-existing and unrelated to that fix** — the contract suite stays 930 green and every failing integration file passes when run in isolation.

The project owner (2026-06-15) confirmed two decisions that frame this plan: (1) embedding dimension is **multi-dim parametric, default 1536** — the client chooses the embedder (384 local / 1536 OpenAI / etc., HNSW ceiling 2000 on pgvector 0.5.1), so the dim-change path is production-critical (now fixed); (2) DB isolation for the failing tests should be **"the most FAANG-level"** approach — per-file isolated databases cloned from a migrated **template database** (`CREATE DATABASE … TEMPLATE`), which clones in milliseconds instead of re-running 15 migrations 96×.

This plan is the agreed path (`AskUserQuestion` 2026-06-15: "Plano dedicado via /to-plan") to a green, deterministic suite as a precondition for production deploy.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `vitest.integration.config.ts` | 52 | `f9d831e` (2026-06-15) | Integration runner config; `fileParallelism:false`; `globalSetup` hook; package aliases | `THEOMEM_PG_URI` skip-gate; `fileParallelism:false`; existing aliases keep resolving |
| `tests/integration/global-setup.ts` | 62 | (workspace reorg era) | Migrates the SHARED `themem` DB once (1536-dim) via raw SQL with "already exists" tolerance before any test | When `THEOMEM_PG_URI` unset, returns early (tests skip); applies all migration SQL idempotently |
| `tests/integration/_helpers/isolated-db.ts` (NEW) | 0 | — | (file to be created) — per-file isolated-DB helper cloning the migrated template | — |
| `tests/integration/distillation/forget-hard-survives-audit.test.ts` | — | `f354a57` (2026-06-15) | Bucket A — distillation audit-survival test on shared DB | Behavior assertions unchanged; only DB wiring isolates |
| `tests/integration/distillation/reflect-atomic-rollback.test.ts` | — | `f354a57` (2026-06-15) | Bucket A — reflect atomic rollback on shared DB | same |
| `tests/integration/distillation/reflect-empty-scope.test.ts` | — | `f354a57` (2026-06-15) | Bucket A — empty-scope reflect on shared DB | same |
| `tests/integration/distillation/reflect-with-policy.test.ts` | 132 | `f354a57` (2026-06-15) | Bucket A — `beforeAll` only opens a pool to `PG_URI`; assumes schema (`reflect-with-policy.test.ts:72-74`) | Behavior assertions unchanged |
| `tests/integration/distillation/skill-isolation.test.ts` | — | `f354a57` (2026-06-15) | Bucket A — skill scope isolation on shared DB | same |
| `tests/integration/distillation/the-goal-test.test.ts` | — | `f354a57` (2026-06-15) | Bucket A — distillation GOAL TEST (stub LLM) on shared DB | same |
| `tests/integration/examples/chat-with-memory-distillation.test.ts` | — | (examples era) | Bucket A — example distillation flow on shared DB | same |
| `tests/integration/examples/chat-with-memory-local-openrouter.test.ts` | — | (examples era) | Bucket A + C — needs 384-dim isolated DB AND LLM key | 384-dim isolation; LLM-gated skip without key |
| `tests/integration/schema-v0-4a-constraints.test.ts` | — | (v0.4a era) | Bucket A — schema constraint assertions on shared DB | constraint assertions unchanged |
| `tests/integration/migrations/dim-change.test.ts` | 429 | `f354a57` (2026-06-15) | REFERENCE per-file isolated-DB pattern (already green); template for the helper | unchanged — exemplar |
| `tests/integration/migrations/repair-partial-state.test.ts` | 154 | `f354a57` (2026-06-15) | REFERENCE per-file isolated-DB pattern (already green) | unchanged — exemplar |
| Bucket B files (13) — see § Coverage Matrix | — | reorg era | Assertions on README/docker/exports/paths drifted by the workspace reorg | TRIAGE each: update stale assertion OR fix real product regression |

> Exact LoC for the per-test files is captured at implementation time (`wc -l`); the rows above cite the load-bearing ones. The Bucket B files are enumerated in the Coverage Matrix and triaged individually in Phase 2.

### Current callers / dependents

- **Symbol:** `createIsolatedDb()` / `withIsolatedDb()` in `tests/integration/_helpers/isolated-db.ts` (NEW)
  - **Callers (production):** none — test-only helper.
  - **Callers (tests):** the ~9 Bucket A files (Phase 1) + any Bucket B file that triage shows needs DB isolation.
  - **External (public API consumed by other repos):** no.
- **Symbol:** `setup()` in `tests/integration/global-setup.ts`
  - **Callers:** vitest `globalSetup` hook (config-driven, not a code import).
  - **External:** no.
- **Symbol:** `runMigrations(pool, options?)` in `packages/core/src/infrastructure/db/migrations-runner.ts`
  - **Callers (production):** app boot, CLI `themory migrate`, `createLocalMemory` paths.
  - **Callers (tests):** `dim-change.test.ts`, `repair-partial-state.test.ts`, `journal-sync.test.ts`, others. The template-build in Phase 0 MAY call it.
  - **External:** yes — public export from `@usetheo/memory`. **This plan does NOT change its signature or behavior.**

### Domain glossary

- **Shared DB** — the single Postgres database named in `THEOMEM_PG_URI` (`themem`), migrated once by `global-setup.ts` and shared by every integration file that does not isolate.
- **Template database** — a Postgres database that has been migrated once; `CREATE DATABASE x TEMPLATE template_db` byte-clones it in milliseconds (no migration replay). Requires no active connections to the template during the clone.
- **Per-file isolated DB** — a uniquely-named database each test file creates (from the template) in `beforeAll` and drops in `afterAll`, eliminating cross-file state pollution.
- **Bucket A / B / C** — the three failure clusters: A = shared-DB schema-state pollution; B = reorg assertion drift; C = LLM-gated 401-instead-of-skip.
- **`atttypmod`** — pgvector stores `vector(N)`'s `N` directly in `pg_attribute.atttypmod` (identity decoder, verified for v0.5.1).

### Architecture boundaries affected

- **`rules/testing.md` § Pyramid + Determinism** — "No flaky tests"; "Integration tests that share state — each test resets the DB" (anti-pattern). This plan enforces that rule by replacing shared-DB reliance with per-file isolation. No `src/**` layering boundary (`rules/architecture.md` § core/local/cloud) is crossed — changes are test-infra + (only if triage finds a real regression) product fixes in their existing layer.

## Prior Art & Related Work

- **Reference (in-repo):** `tests/integration/migrations/dim-change.test.ts` + `tests/integration/migrations/repair-partial-state.test.ts` already implement the per-file isolated-DB pattern (`adminUri → /postgres`, `DROP/CREATE DATABASE TEST_DB`) and pass green. Phase 0's helper generalizes this exact pattern + adds template-clone.
- **Reference (Postgres):** `CREATE DATABASE … TEMPLATE` template-clone — confirmed working on the `themem_pgvector` container in this session (`CREATE DATABASE themem_tmpl_test TEMPLATE template0` succeeded). The standard FAANG approach for fast per-test DB isolation (vs migration replay per file).
- **Internal:** `tests/integration/global-setup.ts` already builds a fully-migrated DB once — Phase 0 redirects that work into a TEMPLATE DB instead of the shared DB.
- **Session diagnosis (this conversation):** parallel and `--no-file-parallelism` runs produced identical 50 failures → not a concurrency race (the config already sets `fileParallelism:false`); confirmed shared-DB schema-state pollution. Distillation dir passes 8/9 in isolation.
- No `*-patterns` skill matched `integration-suite-stabilization`; no blueprint exists for this topic — test-infra hardening, first-of-its-kind cycle in this repo.

## Objective

- [ ] A migrated **template database** is built once per suite run (Phase 0).
- [ ] A reusable `_helpers/isolated-db.ts` clones the template into a per-file DB and tears it down (Phase 0).
- [ ] All ~9 Bucket A files use per-file isolated DBs; `relation "consolidation_history" does not exist` errors are eliminated (Phase 1).
- [ ] Every Bucket B file is triaged: stale assertion updated OR real reorg regression fixed in the product, each with a one-line rationale (Phase 2).
- [ ] Bucket C LLM-gated files skip cleanly (no 401) when no LLM key is present (Phase 3).
- [ ] `pnpm vitest run --config vitest.integration.config.ts` returns 0 failures; contract suite 930 + typecheck + lint stay green (Phase 4).

## ADRs

### D1 — Per-file isolated DB cloned from a migrated template database

- **Decision:** DB-touching integration tests stop using the shared `themem` DB and instead create a per-file database cloned from a migrated template (`CREATE DATABASE <unique> TEMPLATE <template>`), dropped in `afterAll`. A shared `_helpers/isolated-db.ts` encapsulates the admin-connection clone/drop.
- **Rationale:** The shared DB is mutated destructively by at least one file (later tables dropped while the drizzle journal persists → `runMigrations` no-ops → dependents see `relation … does not exist`). Per-file isolation removes ALL cross-file coupling deterministically. Template-clone keeps it fast (ms-per-file vs 15-migration replay × 96). Honors `rules/testing.md` "each test resets the DB" + Determinism.
- **Alternatives considered:**
  - *Auto-migrate in each `beforeAll` against the shared DB* — rejected: still shares one DB, so a destructive op in file X still corrupts file Y within the same run; does not remove the coupling, only narrows the window.
  - *Per-file DB built by replaying migrations (no template)* — rejected: re-runs 15 migrations per file × ~dozens of files = slow; the template-clone is the FAANG-standard optimization (owner chose "most FAANG-level").
  - *Transaction-per-test with rollback* — rejected: DDL (ALTER/CREATE INDEX) and the dim-change path are not cleanly rollback-isolable across pooled connections; many tests need real committed schema.
- **Consequences:** Enables deterministic green; adds an admin-connection requirement (already used by the reference tests); the template must have no open connections during a clone (helper serializes clone calls; `fileParallelism:false` already holds).

### D1-a — AMENDMENT (2026-06-17): implementation shipped a hybrid, not pure per-file isolation

> Added during `/review integration-suite-stabilization` to disclose a real divergence (F-xval-1 / F-arch-1 / F-wire-1) per Inquebrável Rule 3. The plan stays the ground truth; this amendment records what was actually built and why.

- **What shipped vs D1:** D1 mandated EVERY DB-touching test create a unique-named per-file DB via `createIsolatedDb`, and explicitly *rejected* "reset the shared DB" as an alternative. The implementation instead shipped a **hybrid**:
  - **Primary mechanism** — `tests/integration/_helpers/reset-shared-db.ts`, wired via vitest `setupFiles`, DROP+CREATEs the shared `themem` DB **from the migrated template** (`CREATE DATABASE … TEMPLATE`) at the setup file's TOP LEVEL **before each test file's module body evaluates**. Every file therefore starts from an identical full-schema 1536-dim DB.
  - **Per-file isolation** — `createIsolatedDb` is used only by the heavy/state-sensitive files (`migrations/dim-change`, `migrations/repair-partial-state`, `forgetting/triadic-eviction`, and the helper's own test) where a dedicated clone is warranted.
- **Why the deviation is sound (not the rejected alternative):** D1 rejected "*auto-migrate in each `beforeAll` against the shared DB*" because a destructive op in file X would still corrupt file Y **within the same run**. The shipped design does NOT do that — it resets the shared DB to a clean **template clone BEFORE each file at top level** (ordering is load-bearing: a `beforeAll` reset would kill the file's own live connection). That closes the exact cross-file-pollution hole D1's rejected alternative left open, so D1's determinism intent is fully preserved. The trade chosen (KISS + YAGNI): keep `THEOMEM_PG_URI` stable so the ~90 existing files that read it at module scope need ZERO connection-string rewiring, while still byte-cloning the template (the FAANG-standard fast path the owner asked for).
- **Honest cost:** Coverage-Matrix rows 2-10 ("migrate the ~9 Bucket A files to `createIsolatedDb`") were satisfied by the `setupFiles` reset rather than by per-file `createIsolatedDb` — the GOAL (those files green + deterministic in the full suite) is met, but via a different mechanism than the row text describes. The user-facing CHANGELOG entry under `[0.3.0]` (immutable per Rule 6) describes the D1 design ("each test owns its database"); a correcting clarification is added under `[Unreleased]`.
- **Process disclosure (F-xval-6):** this slice was tagged **v0.3.0 before** `/review` ran, and the final 5-failure green fix (`10b6428`) landed **after** that tag — so the `v0.3.0` tag does NOT contain the deterministically-green suite. The cycle order was inverted (release preceded review). The green fixes ship in the next release cut (v0.3.1); no history is rewritten.

### D2 — Bucket B triage is per-file stale-vs-regression, never blind assertion edits

- **Decision:** Each Bucket B failure is classified as (i) **stale assertion** — the test encodes the pre-reorg layout and the product is correct → update the assertion to the new layout with a one-line rationale; or (ii) **real regression** — the reorg broke a product contract (README/Docker/exports/paths) → fix the product, not the test.
- **Rationale:** Blindly "greening" assertions can mask a real reorg regression (Inquebrável Rule 3). The test exists to catch drift; the triage decides which side drifted.
- **Alternatives considered:** *Update all Bucket B assertions to current output* — rejected: would hide genuine regressions; violates honesty discipline. *Delete the drifted tests* — rejected: loses the regression guard.
- **Consequences:** Phase 2 is slower (per-file judgment) but trustworthy; any product fix ships in the same commit as its test per `rules/testing.md`.

### D3 — LLM-gated tests skip cleanly without a key (no CI key requirement)

- **Decision:** Bucket C tests that hit a real LLM gate their `describe` on the presence of an LLM key (`describe.skipIf(KEY === '')`), mirroring the existing `THEOMEM_PG_URI` skip pattern, so a keyless CI run SKIPS them instead of 401-failing.
- **Rationale:** The suite must be green on a keyless CI by default; real-LLM coverage runs in a key-provided job. Matches the established `describe.skipIf` convention in this suite.
- **Alternatives considered:** *Require an LLM key in CI* — rejected: couples the default gate to a paid external credential + network; brittle. *Mock the LLM* — rejected here: these are explicitly real-provider E2E smokes; mocking changes their purpose (the distillation/extraction stub-LLM coverage already exists separately).
- **Consequences:** Keyless CI is green and deterministic; real-LLM E2E becomes an opt-in job (documented).

### D4 — No change to `runMigrations` public contract

- **Decision:** This plan does not alter `runMigrations`'s signature or runtime behavior; the dim-change fix (`98c60eb`) is already shipped. The template build reuses existing migration application logic.
- **Rationale:** Scope discipline (YAGNI) — the product migration path is correct; only test wiring changes.
- **Alternatives considered:** *Fold a `runMigrations` refactor into this plan* — rejected: out of scope; would widen blast radius.
- **Consequences:** Public API stable; plan stays test-infra-focused (plus any Bucket B product fix in its own layer).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Template-clone requires no open connections to the template DB during `CREATE DATABASE … TEMPLATE`; a leaked pool blocks the clone | Medium | Helper builds the template in `global-setup` and closes its pool before any test; clone is serialized (`fileParallelism:false` already holds); helper `end()`s admin pools in `finally` | Implementer |
| Bucket B triage mis-classifies a real regression as a stale assertion → ships a masked bug | High | D2 mandates per-file rationale; `/review` cross-validation re-checks each Bucket B change; never blind-edit | Implementer + `/review` |
| Per-file DB creation adds wall-clock to the suite | Low | Template-clone is ms-level; net change small vs current; suite already `fileParallelism:false` | Implementer |
| A Bucket A file ALSO needs a non-default dim (384) — must clone the right template OR migrate the isolated DB to 384 | Medium | Helper accepts an optional `embeddingDim` and runs `runMigrations(pool,{embeddingDim})` on the freshly-cloned DB when set (the now-fixed path) | Implementer |
| Some failures may be a 4th, unanticipated cause not in A/B/C | Medium | Phase 4 re-runs the FULL suite; any residual failure is triaged before declaring done; honest BLOCKED over false green | Implementer |

## Unresolved Questions

- Q1 — Which exact file drops the late tables on the shared DB today? (Not required to fix — per-file isolation removes the dependency regardless — but worth identifying in Phase 1 to confirm no product bug hides behind it.)
- Q2 — Do any Bucket B "DOC/REORG" failures actually belong to Bucket A (DB-schema) once isolation lands? (Phase 1 completion re-runs the suite; reclassify any that flip.)
- Q3 — Should the real-LLM opt-in job be added to CI in this plan or deferred? (Default: document the keyed invocation; CI wiring deferred unless the owner wants it in-scope.)

## Dependency Graph

```
Phase 0 (template DB + isolated-db helper)
   │
   ├──────────────▶ Phase 1 (Bucket A → isolated DB)
   │                      │
   │                      ▼
   ├──────────────▶ Phase 2 (Bucket B triage)   ── can start in parallel with Phase 1
   │                      │
   ├──────────────▶ Phase 3 (Bucket C skip-clean) ── independent; parallel
   │                      │
   ▼                      ▼
Phase 4 (Integration Validation — full suite 0 failures)  ◀── blocks on 1 + 2 + 3
```

Phase 0 is the blocker for Phase 1. Phases 1/2/3 are largely independent and may interleave. Phase 4 blocks on all.

---

## Phase 0: Isolation infrastructure

**Objective:** Provide a migrated template database + a reusable per-file isolated-DB helper.

### T0.1 — Build a migrated template DB + `_helpers/isolated-db.ts`

#### Objective
Create a migrated template database once per suite run and a helper that clones it into a uniquely-named per-file DB and tears it down.

#### Why this step (action + reasoning)

1. **What this step does** — extends `global-setup.ts` to build a fully-migrated template DB (`themem_template_<runid>`) and adds `tests/integration/_helpers/isolated-db.ts` exposing `createIsolatedDb({ embeddingDim? })` (clone template → optional `runMigrations({embeddingDim})` → return `{ pool, dropDb }`).
2. **Why it is necessary now** — every Bucket A fix (Phase 1) depends on this helper (D1). Building the template once and cloning per file is the owner-selected "most FAANG-level" isolation that keeps the suite fast while removing all cross-file pollution.

#### Evidence
- `tests/integration/global-setup.ts:21-60` already migrates a DB by applying migration SQL idempotently — reuse this to build the template instead of the shared DB.
- `tests/integration/migrations/repair-partial-state.test.ts:45-60` shows the admin-connection `DROP/CREATE DATABASE` pattern to generalize.
- Template-clone confirmed: `CREATE DATABASE … TEMPLATE` succeeded on the container this session.

#### Files to edit
```
tests/integration/global-setup.ts — build a migrated template DB (themem_template_<runid>); expose its name via env for the helper; keep shared-DB migration for legacy not-yet-migrated files OR drop once Phase 1 lands
tests/integration/_helpers/isolated-db.ts (NEW) — createIsolatedDb({ embeddingDim? }): clone template → optional runMigrations(pool,{embeddingDim}) → { pool, dropDb }; admin-pool clone/drop with finally-cleanup
tests/integration/_helpers/isolated-db.test.ts (NEW) — RED test: createIsolatedDb() returns a pool whose DB has consolidation_history + reflection_counters + memories + entities; dropDb() removes it
```

#### Deep file dependency analysis
- `global-setup.ts` today migrates the shared DB; this task makes it ALSO (or instead) produce a template. Downstream: the helper reads the template name. No `src/**` dependency.
- `isolated-db.ts` (NEW) depends on `pg` + `runMigrations` from `@usetheo/memory` (for the optional 384-dim path). Callers: Phase 1 files.

#### Deep Dives
- **Template name:** unique per run (e.g., `themem_template_<pid>` or a fixed `themem_template` rebuilt in setup) to avoid collisions; `DROP DATABASE IF EXISTS` then build.
- **Clone connections:** `CREATE DATABASE x TEMPLATE t` fails if `t` has open connections — `global-setup` MUST `pool.end()` the template builder before tests start; the helper's admin pool connects to `/postgres`, not the template.
- **Invariant:** a cloned DB has the FULL schema (all 15 migrations) — the canary tables `consolidation_history`, `reflection_counters` exist (cite `rules/testing.md` "each test resets the DB").
- **384-dim:** when `embeddingDim` passed, helper runs `runMigrations(pool,{embeddingDim})` on the clone (now-fixed path, `98c60eb`).

#### Pseudo-code / Signatures
```pseudocode
// _helpers/isolated-db.ts
async function createIsolatedDb(opts?: { embeddingDim?: number }): Promise<{ pool: Pool; dropDb: () => Promise<void> }>
  name = `themem_it_${unique()}`
  admin = pool(adminUri)                 // connect to /postgres
  try: await admin.query(`CREATE DATABASE ${name} TEMPLATE ${templateName()}`)
  finally: await admin.end()
  pool = new Pool(uriFor(name))
  if opts?.embeddingDim: await runMigrations(pool, { embeddingDim: opts.embeddingDim })
  return { pool, dropDb: async () => { await pool.end(); dropDatabase(name) } }
```

#### Tasks
1. Add template-build to `global-setup.ts`; close the builder pool before returning.
2. Create `_helpers/isolated-db.ts` with `createIsolatedDb` + `dropDb`.
3. Write the RED helper test asserting the cloned schema completeness.

#### TDD
```
RED:     isolated-db creates a DB whose schema has consolidation_history + reflection_counters + memories + entities — fails before the helper exists
RED:     createIsolatedDb({ embeddingDim: 384 }) yields memories.embedding atttypmod = 384
GREEN:   Implement global-setup template build + the helper
REFACTOR: Extract admin-uri derivation shared with the reference tests if duplication appears
VERIFY:  THEOMEM_PG_URI=... pnpm vitest run tests/integration/_helpers/isolated-db.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — `fileParallelism:false` already holds and the helper serializes clone/drop, so there is no in-suite race surface.

#### Acceptance Criteria
- [ ] `pnpm vitest run tests/integration/_helpers/isolated-db.test.ts --config vitest.integration.config.ts` exits 0, asserting the cloned DB contains `consolidation_history`, `reflection_counters`, `memories`, `entities` (queried via `information_schema.tables`).
- [ ] The same test asserts `createIsolatedDb({ embeddingDim: 384 })` yields `memories.embedding` `atttypmod` equal to 384 (queried via `pg_attribute`).
- [ ] The same test asserts that after `dropDb()`, zero databases matching `themem_it_%` remain (counted via `pg_database`).
- [ ] `pnpm run lint` reports 0 warnings and `wc -l` shows each changed file ≤ 500 lines.

#### DoD
- [ ] `pnpm vitest run tests/integration/_helpers/isolated-db.test.ts --config vitest.integration.config.ts` exits 0.
- [ ] `pnpm run lint` reports 0 warnings and `pnpm run typecheck` reports 0 errors.

---

## Phase 1: Bucket A — migrate shared-DB tests to per-file isolation

**Objective:** Eliminate `relation … does not exist` by isolating each Bucket A file.

### T1.1 — Migrate the ~9 Bucket A files to `createIsolatedDb`

#### Objective
Replace each Bucket A file's `new pg.Pool({ connectionString: PG_URI })` (shared DB) with `createIsolatedDb()` in `beforeAll`, dropping in `afterAll`. Behavior assertions stay identical.

#### Why this step (action + reasoning)

1. **What this step does** — rewires the DB acquisition of the 9 Bucket A files to the Phase 0 helper; the 384-dim example passes `{ embeddingDim: 384 }`.
2. **Why it is necessary now** — these files fail ONLY because the shared DB loses late tables mid-run (D1). Isolation makes them deterministic without touching their behavior — they already pass in isolation (distillation dir 8/9 green).

#### Evidence
- Full-suite run: 15× `relation "consolidation_history" does not exist` + 1× `reflection_counters`.
- `reflect-with-policy.test.ts:72-74` opens a bare pool on `PG_URI` with no migration.
- Distillation dir in isolation: 6 files / 8 tests green (1 skip = LLM-gated).

#### Files to edit
```
tests/integration/distillation/forget-hard-survives-audit.test.ts — beforeAll → createIsolatedDb()
tests/integration/distillation/reflect-atomic-rollback.test.ts — same
tests/integration/distillation/reflect-empty-scope.test.ts — same
tests/integration/distillation/reflect-with-policy.test.ts — same
tests/integration/distillation/skill-isolation.test.ts — same
tests/integration/distillation/the-goal-test.test.ts — same
tests/integration/examples/chat-with-memory-distillation.test.ts — same
tests/integration/examples/chat-with-memory-local-openrouter.test.ts — createIsolatedDb({ embeddingDim: 384 }) (also Bucket C skip in Phase 3)
tests/integration/schema-v0-4a-constraints.test.ts — same (isolated DB for the constraint assertions)
```

#### Deep file dependency analysis
- Each file today opens a pool on `PG_URI` and assumes the global-setup schema. After: each owns its DB via the helper. Downstream: none (test-only). The example file additionally needs 384-dim (helper option).

#### Deep Dives
- Keep each file's `reset()`/`beforeEach` truncation logic if present, but it now operates on the isolated DB (cheap; or drop+reclone per file is sufficient since each file is its own DB).
- Invariant: the behavior assertions (counts, soft-delete, provenance, audit rows) are UNCHANGED — only the DB handle changes.
- The example file's 384-dim path exercises the now-fixed dim-change (regression linkage to `98c60eb`).

#### Tasks
1. For each file: import the helper; replace pool acquisition in `beforeAll`; call `dropDb()` in `afterAll`.
2. Run each file in isolation → confirm green.
3. Run the distillation dir + examples + schema file together → confirm green.

#### TDD
```
RED:     full-suite run shows these 9 files failing with relation-does-not-exist (current state)
GREEN:   rewire each to createIsolatedDb; assertions unchanged → green
REFACTOR: none expected (mechanical rewire)
VERIFY:  THEOMEM_PG_URI=... pnpm vitest run tests/integration/distillation tests/integration/examples tests/integration/schema-v0-4a-constraints.test.ts --config vitest.integration.config.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm vitest run tests/integration/distillation tests/integration/examples tests/integration/schema-v0-4a-constraints.test.ts --config vitest.integration.config.ts` exits 0 (the 9 files green together).
- [ ] `grep -c 'does not exist'` over the full-suite output reports 0 (zero `relation … does not exist`).
- [ ] `git diff` of each file shows DB-handle rewiring only — no `expect(...)` assertion line deleted or weakened.
- [ ] `pnpm run lint` reports 0 warnings and `wc -l` shows each changed file ≤ 500 lines.

#### DoD
- [ ] `pnpm vitest run --config vitest.integration.config.ts` shows these 9 files passing in full-suite context.
- [ ] `pnpm run typecheck` reports 0 errors and `pnpm run lint` reports 0 warnings.

---

## Phase 2: Bucket B — triage reorg-drifted assertions

**Objective:** Resolve each Bucket B failure as stale-assertion (update) or real-regression (fix product), per D2.

### T2.1 — Triage + resolve the 13 Bucket B files

#### Objective
For each Bucket B file, determine whether the failing assertion encodes the pre-reorg layout (stale → update) or catches a real reorg regression (fix the product), with a one-line rationale per file.

#### Why this step (action + reasoning)

1. **What this step does** — opens each Bucket B failure, compares the asserted expectation against the current (post-reorg) product reality, and resolves it on the correct side (test vs product).
2. **Why it is necessary now** — these tests guard real contracts (README MCP section, Docker compose image, root exports, pack manifest, CLI). The reorg (npm→pnpm, `packages/{core,api,cli,mcp}`, agent-core leaf) shifted layout; the triage prevents masking a real regression (D2, Inquebrável Rule 3).

#### Evidence
- Error signatures: `toMatch` on README/`docker-compose`/`Dockerfile`/exports; `expected '<div align="center">…' to`; `expected [ '0011','0013','0014' ] to`; `ENOENT`.
- Reorg commits: `6dd7612` (pnpm), `29c3cdb` (packages/api), extract-cli (PR #41), `1827fbe` (packages/mcp), `f9d831e` (agent-core leaf).

#### Files to edit
```
tests/integration/p0-audit/baseline.test.ts — triage
tests/integration/p0-audit/exports-root.test.ts — triage (root barrel export set vs reorg)
tests/integration/p0-audit/matrix.test.ts — triage
tests/integration/p0-audit/readme-mcp-section.test.ts — triage (README MCP / .mcp.json.example)
tests/integration/p0-audit/run-server-stub-removal.test.ts — triage
tests/integration/p0-audit-fixes/post-install-bin.test.ts — triage (bin/post-install vs D2-a no-npm-bin)
tests/integration/docker-compose-prod.test.ts — triage (compose image tag/layout)
tests/integration/dockerfile-entrypoint.test.ts — triage (entrypoint vs new dist layout)
tests/integration/subpath-isolation.test.ts — triage (bundle isolation vs new subpaths)
tests/integration/schema-snapshot-parity.test.ts — triage (migration snapshot list)
tests/integration/cli-consolidated.test.ts — triage (themory CLI surface)
tests/integration/cli/verbs-cli-fixes.test.ts — triage (CLI verbs)
tests/integration/agent-tools/the-goal.test.ts — triage (may reclassify to Bucket A after Phase 1)
tests/integration/reflection/threshold-policy.test.ts — triage (may reclassify to Bucket A)
tests/integration/dogfood/claude-code-bridge-roundtrip.test.ts — triage
tests/integration/migrations/journal-sync.test.ts — triage (may be Bucket A-adjacent)
```

#### Deep file dependency analysis
- Each file asserts a product artifact (README/Docker/exports/migrations list/CLI). Updating an assertion touches only the test; fixing a regression touches the product file in its existing layer (e.g., README.md, docker-compose.prod.yaml, a barrel) + ships with the test in one commit.
- `agent-tools/the-goal`, `reflection/threshold-policy`, `journal-sync` may turn out to be Bucket A (DB-schema) once isolation lands — re-run after Phase 1 and reclassify (Q2).

#### Deep Dives
- **Decision procedure per file:** (1) read the assertion; (2) compute the current product reality (read the README/compose/exports); (3) if the product is CORRECT for the new layout → update the assertion (rationale: "reorg moved X to Y"); (4) if the product is WRONG (reorg dropped/broke a real contract) → fix the product (rationale: "reorg regression: Z no longer documented/shipped").
- Invariant: never weaken an assertion to pass; either it matches a correct product or the product is fixed.

#### Tasks
1. Re-run the suite AFTER Phase 1 to drop any reclassified-to-A files.
2. For each remaining Bucket B file: apply the decision procedure; record the one-line rationale in the commit body.
3. Group commits by sub-type (p0-audit / docker / cli / schema) for reviewability.

#### TDD
```
RED:     each Bucket B file currently fails its assertion
GREEN:   resolve on the correct side (update stale assertion OR fix product); test passes for the RIGHT reason
REFACTOR: none expected
VERIFY:  THEOMEM_PG_URI=... pnpm vitest run <each bucket-B file> --config vitest.integration.config.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm vitest run <each Bucket B file> --config vitest.integration.config.ts` exits 0 for every Bucket B file.
- [ ] Each Bucket B commit body contains a one-line `stale-assertion` OR `reorg-regression` rationale (grep the commit log for the tag).
- [ ] `git diff` shows that any file resolved as `reorg-regression` changed the PRODUCT file (README/compose/barrel), not only the test.
- [ ] `pnpm run lint` reports 0 warnings and `wc -l` shows each changed file ≤ 500 lines.

#### DoD
- [ ] `pnpm vitest run --config vitest.integration.config.ts` shows all Bucket B files passing.
- [ ] `pnpm run typecheck` reports 0 errors and `pnpm run lint` reports 0 warnings.

---

## Phase 3: Bucket C — LLM-gated tests skip cleanly

**Objective:** Keyless CI run skips LLM-gated tests instead of 401-failing.

### T3.1 — Gate LLM-dependent describes on key presence

#### Objective
Wrap each real-LLM test's `describe` in `skipIf(LLM_KEY === '')` so a keyless run skips them; a keyed run still exercises them.

#### Why this step (action + reasoning)

1. **What this step does** — adds/repairs the `describe.skipIf` gate keyed on `OPENROUTER_KEY`/`OPENAI_API_KEY` for the Bucket C files so they skip without a key.
2. **Why it is necessary now** — the default CI gate must be green without paid credentials (D3); today they 401 and fail. Mirrors the existing `THEOMEM_PG_URI` skip convention.

#### Evidence
- `adapters-or-local-e2e-smoke.test.ts:44` already gates on `OPENROUTER_KEY === ''` (correct exemplar).
- Bucket C failures: `401 Missing Authentication header` from `OpenAILLM.generateResponse`.

#### Files to edit
```
tests/integration/examples/chat-with-memory-local-openrouter.test.ts — add/repair describe.skipIf(LLM_KEY === '')
(any other Bucket C file surfaced after Phase 1/2 reclassification) — same gate
```

#### Deep file dependency analysis
- Each file’s top-level reads the key env + gates the `describe`. No product change. Downstream: none.

#### Deep Dives
- Use the SAME key resolution the suite already uses (`OPENROUTER_KEY ?? OPENROUTER_API_KEY ?? OPENAI_API_KEY`); skip when empty.
- Invariant: with a key, the test still runs and must pass (verified in the keyed Phase 4 pass).

#### Tasks
1. Add the skip gate to each Bucket C file.
2. Confirm keyless run skips (not fails); keyed run passes.

#### TDD
```
RED:     keyless full-suite run shows Bucket C files FAILING with 401
GREEN:   add describe.skipIf(LLM_KEY==='') → keyless run SKIPS them
REFACTOR: none expected
VERIFY:  (keyless) THEOMEM_PG_URI=... pnpm vitest run <bucket-C file> --config vitest.integration.config.ts  → skipped
         (keyed)   + OPENROUTER_KEY=… → passes
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] Keyless `pnpm vitest run <Bucket C file> --config vitest.integration.config.ts` reports the file's tests as `skipped` (0 failed, 0 `401` strings in output).
- [ ] Keyed (with `OPENROUTER_KEY` set) `pnpm vitest run <Bucket C file>` exits 0 (tests run and pass).
- [ ] `pnpm run lint` reports 0 warnings on changed files.

#### DoD
- [ ] Keyless `pnpm vitest run --config vitest.integration.config.ts` reports 0 failures attributable to Bucket C.
- [ ] `pnpm run typecheck` reports 0 errors and `pnpm run lint` reports 0 warnings.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Template DB + isolation helper exists | T0.1 | `global-setup` builds template; `_helpers/isolated-db.ts` clones per file |
| 2 | Bucket A: distillation/forget-hard-survives-audit green | T1.1 | isolated DB |
| 3 | Bucket A: distillation/reflect-atomic-rollback green | T1.1 | isolated DB |
| 4 | Bucket A: distillation/reflect-empty-scope green | T1.1 | isolated DB |
| 5 | Bucket A: distillation/reflect-with-policy green | T1.1 | isolated DB |
| 6 | Bucket A: distillation/skill-isolation green | T1.1 | isolated DB |
| 7 | Bucket A: distillation/the-goal-test green | T1.1 | isolated DB |
| 8 | Bucket A: examples/chat-with-memory-distillation green | T1.1 | isolated DB |
| 9 | Bucket A: examples/chat-with-memory-local-openrouter green | T1.1 + T3.1 | isolated 384-dim DB + LLM skip gate |
| 10 | Bucket A: schema-v0-4a-constraints green | T1.1 | isolated DB |
| 11 | Bucket B: p0-audit/{baseline,exports-root,matrix,readme-mcp-section,run-server-stub-removal} resolved | T2.1 | triage stale-vs-regression |
| 12 | Bucket B: p0-audit-fixes/post-install-bin resolved | T2.1 | triage |
| 13 | Bucket B: docker-compose-prod + dockerfile-entrypoint resolved | T2.1 | triage |
| 14 | Bucket B: subpath-isolation + schema-snapshot-parity resolved | T2.1 | triage |
| 15 | Bucket B: cli-consolidated + cli/verbs-cli-fixes resolved | T2.1 | triage |
| 16 | Bucket B: agent-tools/the-goal + reflection/threshold-policy + dogfood/claude-code-bridge-roundtrip + migrations/journal-sync resolved (reclassify to A if isolation fixes them) | T2.1 (+ T1.1 if reclassified) | triage / isolation |
| 17 | Bucket C: LLM-gated tests skip cleanly without a key | T3.1 | describe.skipIf |
| 18 | Full suite returns 0 failures deterministically | T1.1 + T2.1 + T3.1 | union of the three bucket fixes yields 0 failures; verified in the Integration Validation phase |

**Coverage: 18/18 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] `THEOMEM_PG_URI=... pnpm vitest run --config vitest.integration.config.ts` → 0 failed (keyless: Bucket C skipped)
- [ ] Contract suite green — `pnpm vitest run --config vitest.contract.config.ts` (930)
- [ ] Zero type errors — `pnpm run typecheck`
- [ ] Zero lint warnings — `pnpm run lint`
- [ ] File-size budget respected (per `rules/architecture.md` / 500-LoC guideline)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compatibility preserved — no `src/**` public API change (D4); any Bucket B product fix is layout/doc-only or in its existing layer
- [ ] Every Bucket B resolution carries a one-line stale-vs-regression rationale (D2)
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merged

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:themem` (DB, admin) | template has open connections at clone time | a leaked pool not `end()`ed before `CREATE DATABASE … TEMPLATE` | helper builds template in `global-setup` and closes the builder pool first; clone serialized; on failure, loud error (no silent shared-DB fallback) |
| `postgres` isolated DB | `DROP DATABASE` blocked by lingering connection in `afterAll` | a test leaves a pool open | helper `pool.end()` BEFORE `DROP DATABASE` in `dropDb()`; `finally` cleanup |
| OpenRouter/OpenAI (HTTP, Bucket C) | 401 missing key on keyless CI | run without an LLM key | `describe.skipIf` SKIPS (no 401 failure); keyed job runs green |

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 0–3. The plan is NOT done until the full suite is deterministically green.

### Execution

```
# keyless default gate
THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem pnpm vitest run --config vitest.integration.config.ts
# contract + static gates
pnpm vitest run --config vitest.contract.config.ts
pnpm run typecheck
pnpm run lint
# keyed real-LLM pass (opt-in)
THEOMEM_PG_URI=... OPENROUTER_KEY=… OPENAI_API_KEY=… OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_CHAT_MODEL=openai/gpt-4o-mini \
  pnpm vitest run --config vitest.integration.config.ts
```

### Acceptance Criteria

- [ ] Keyless integration suite: 0 failed (Bucket C skipped)
- [ ] Keyed integration suite: 0 failed (Bucket C green)
- [ ] Contract 930 green; typecheck + lint clean
- [ ] Deterministic: two consecutive keyless runs produce identical 0-failure results
- [ ] No assertion weakened merely to pass; every Bucket B change has a rationale

### If Validation Fails

1. Classify each residual failure: A/B/C bucket OR a new 4th cause (Q3-style).
2. Fix plan-caused/in-scope failures; isolate any genuinely new product bug into its own follow-up with an honest BLOCKED note (do not green it blindly).
3. Re-run the chain to confirm.
4. Pre-existing out-of-scope issues are logged in the PR description, not silently greened.
