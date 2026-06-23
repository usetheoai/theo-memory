---
slug: skills-dashboard-followups-roadmap
created_at: 2026-06-23
owner: project-owner
source: /review of skills-cross-repo-flat-list (theo-memory v0.21.0) + skills-cross-repo-flat-list-gateway (theo-cloud v0.8.0)
status: active
repos: [theo-memory, theo-cloud]
---

# Roadmap — skills cross-repo + dashboard follow-ups

Tracking artifact for the 3 honest follow-ups surfaced (Inquebrável Rule 3) during the
`skills-cross-repo-flat-list` cycle (themory `v0.21.0`) and its gateway companion
`skills-cross-repo-flat-list-gateway` (theo-cloud `v0.8.0`). None blocked those releases;
all are additive / out-of-scope-then. Each item below carries its repo, type, priority,
SMART goal, and acceptance bar.

Each milestone runs the full cycle when picked up: `/to-plan → /edge-case-plan →
/deps-audit → /plan-confidence → /implement → /code-quality → /review → /release`
(M1 may skip `/discover` — the diagnosis is already done here).

Priority legend: **P1** = do soon (correctness/perf/CI health) · **P2** = nice-to-have / when-touched.

| # | Milestone | Repo | Type | Priority | Status |
|---|---|---|---|---|---|
| M1 | Dashboard logs/SSE suite — 16 pre-existing failures | theo-cloud | CI health / bug | **P1** | [x] RELEASED v0.8.1 |
| M2 | SEC-1 — `agent_id text_pattern_ops` index for the cross-repo prefix LIKE | theo-memory | perf / scalability | **P1** | [x] RELEASED |
| M3 | SDK-surface symmetry — cross-repo flat list on `/v1/memory/*` (programmatic) | theo-cloud (+ themory contract) | API completeness | **P2** | [ ] |
| M4 | Large-table index builds: `CREATE INDEX CONCURRENTLY` runbook (out-of-tx) before GA | theo-memory | ops / migrations | **P2** | [ ] |

---

## M1 — Dashboard logs/SSE suite: 16 pre-existing failures — [x] RELEASED v0.8.1 (2026-06-23)

**Repo:** theo-cloud (`dashboard/`)
**Type:** CI health / latent bug · **Priority:** P1

**Why:** `npm run test` in `dashboard/` is NOT globally green — **16 failures across 6 files**
(`src/hooks/use-log-stream.test.tsx`, `src/pages/runtime-logs.test.tsx`,
`src/components/logs/log-viewer.test.tsx`, `src/components/logs/time-range-picker.test.tsx`,
`src/lib/mocks/handlers.test.ts`, a `pages.smoke` file). Confirmed during the
skills-cross-repo `/review` (3 agents): (a) NONE import skills, (b) NONE were touched by
the skills feature commits, (c) they fail at the parent commit `678a977` — i.e. genuinely
PRE-EXISTING, in the logs/SSE/time-range area. They are a standing red-suite debt: a red
`npm run test` erodes the signal of every future PR (you can't tell new breakage from old).

**Scope:** the logs/SSE/time-range/runtime-logs/mocks/smoke test files + whatever source
they exercise. Determine per-suite whether each failure is (i) a real product regression,
(ii) a stale/over-tight test (timing assertions — several durations were 1-4s, suggesting
fake-timer / async-flush brittleness), or (iii) an MSW/mock-handler drift. Fix or correct
each; do NOT mass-`@skip` (that hides debt — Inquebrável Rule 7).

**Goal (SMART):** "`cd dashboard && npm run test` exits 0 (every suite green) on `develop`,
with each of the 16 fixed failures traced to a root cause (regression vs stale-test vs
mock-drift) in the plan, and zero new `@skip`."

**Acceptance:**
- `dashboard/npm run test` GREEN (0 failed) on a clean `develop`.
- Each previously-failing suite has a one-line root-cause note in the plan.
- No test disabled/skipped to reach green; flaky-timing tests made deterministic (fake timers / explicit awaits).
- `eslint .` clean for any touched file.

**Notes:** independent of the memory layer; pure theo-cloud dashboard work. Good candidate
for `/loop-code-review` or a focused `/to-plan` once the root causes are triaged.

---

## M2 — SEC-1: index the cross-repo prefix LIKE — [x] RELEASED (slug: skills-subject-prefix-index)

> SHIPPED 2026-06-23. Migration `0021_shallow_fenris` adds the partial composite index
> `idx_memories_skill_subject_prefix (workspace_id, agent_id text_pattern_ops) WHERE kind='skill'
> AND t_invalid IS NULL`. `/review` (5 agents) READY_TO_MERGE: 0 BLOCKER / 0 HIGH / 1 MEDIUM
> (CONCURRENTLY — pre-existing project-wide, deferred to M4) / 4 LOW. GOAL test proves a Bitmap
> Index Scan with an `Index Cond` range (`~>=~`/`~<~`) on the new index, never a Seq Scan.
> Spun off **M4** (CONCURRENTLY runbook) from the MEDIUM finding.

### Original spec — [x]

**Repo:** theo-memory (`packages/core` + a new migration)
**Type:** performance / multi-tenant scalability · **Priority:** P1

**Why:** the `/review` domain+security agent (SEC-1, MEDIUM) found that
`PgvectorStore.listSkillsBySubject` runs `agent_id LIKE '{subject}:%'`, which CANNOT use the
default `text_ops` btree under the `en_US.utf8` collation → a **Seq Scan + Sort over the
`workspace_id='default'` partition** (which, under the gateway master-key model, holds ALL
customers' skills) on every cross-repo list request; deep `offset` compounds it. This is a
PERF/DOS concern, NOT a tenant-isolation bug (isolation is correct + tested). Accepted as a
fast-follow at release (dev scale is tiny); it must be closed before the cross-repo skills
list is on a hot path at scale. Tracked in the plan Drawbacks #4.

**Scope:** a non-destructive migration adding a `(workspace_id, agent_id text_pattern_ops)`
index (left-anchored prefix range-scannable for `LIKE 'x%'`); optionally a partial index
`WHERE kind='skill'` to keep it small. NO code change to the query (the planner picks the
index once it exists) beyond an `EXPLAIN`-asserting test. Consider an absolute `offset`
ceiling as defense-in-depth.

**Goal (SMART):** "Add a `(workspace_id, agent_id text_pattern_ops)` index so
`listSkillsBySubject`'s prefix LIKE is index-scannable, measured by an integration test that
`EXPLAIN`s the cross-repo query and asserts an Index/Bitmap scan on the new index (NOT a Seq
Scan) against real `ankane/pgvector:v0.5.1`."

**Acceptance:**
- New migration ships (idempotent `CREATE INDEX IF NOT EXISTS`); `runMigrations` applies it; pack manifest includes the `.sql`.
- Integration test: `EXPLAIN` of the cross-repo prefix query shows the new index used (no full Seq Scan of `memories`).
- `listSkillsBySubject` behavior byte-unchanged (same results, same tests green); no public-API change.
- THE GOAL of `skills-cross-repo-flat-list` still passes.

**Notes:** `text_pattern_ops` supports `LIKE 'prefix%'` but NOT `ILIKE`; the `q` filter
(ILIKE) stays a residual filter — acceptable (the prefix is the selective clause). Honest
caveat: pgvector 0.8.0 iterative scans would also help the ANN path but are out of scope
(runtime pinned to 0.5.1).

---

## M3 — SDK-surface symmetry: cross-repo flat list on `/v1/memory/*` — [ ]

**Repo:** theo-cloud (gateway SDK surface) + themory contract (already shipped)
**Type:** API completeness · **Priority:** P2

**Why:** the `/review` architecture + security agents (F7 / F-2, LOW/INFO) noted the
cross-repo flat list is exposed ONLY on the dashboard BFF (`/v1/dashboard/memory/skills/all`,
JWT/session) — NOT on the programmatic SDK surface (`/v1/memory/*`, Bearer +
`RequireScope("memory:read")`), even though the per-repo `ListSkills` is on BOTH. This is
in-scope-by-plan (the plan scoped only the dashboard consumer) but leaves an asymmetry: an
SDK-key consumer cannot list-all cross-repo skills programmatically. The themory provider
endpoint (`GET /v1/scopes/skill/:subject/all`) already exists (v0.21.0), so this is a thin
gateway addition.

**Scope:** add `GET /v1/memory/skills/all` to the SDK route block (the `/v1/memory` group,
behind Bearer + `RequireScope("memory:read")`) delegating to the SAME
`MemoryHandler.ListSkillsAll` (already generic — no handler change). The bare-subject + 502
+ pagination behavior is reused. NO themory change. Confirm scope-check parity with the
per-repo SDK `ListSkills`.

**Goal (SMART):** "Expose `GET /v1/memory/skills/all` on the programmatic SDK surface
(Bearer + `memory:read`) delegating to the existing `MemoryHandler.ListSkillsAll`, measured
by a Go handler test that the SDK route is gated by `RequireScope('memory:read')` and returns
the bare-subject cross-repo flat list."

**Acceptance:**
- `GET /v1/memory/skills/all` mounted in the SDK route block with `RequireScope("memory:read")`.
- Go test: scope-gated (403 without `memory:read`), bare-subject passthrough, 502 on upstream error.
- BFF route + handler UNCHANGED; no themory change; per-repo `/v1/memory/skills` UNCHANGED.
- CHANGELOG `Added`.

**Notes:** lowest priority — purely closes a programmatic-vs-dashboard asymmetry; no user-facing
dashboard impact (the dashboard already works via the BFF).

---

## M4 — Large-table index builds via `CREATE INDEX CONCURRENTLY` runbook — [ ]

**Repo:** theo-memory (migration strategy) · **Type:** ops / migrations · **Priority:** P2

**Why:** surfaced by the M2 `/review` (F-dom-db-4, MEDIUM). Every partial-index migration in the
repo (`0005`, `0008`, `0009`, now `0021`) uses a plain in-transaction `CREATE INDEX`, which takes a
SHARE lock on `memories` and blocks concurrent writes for the build duration. At pre-release / CI
scale this is trivial; on a large write-hot production `memories` table (post-TheoCloud GA) it is a
deploy-time write stall. `CREATE INDEX CONCURRENTLY` avoids the write lock but CANNOT run inside a
transaction — and Drizzle `migrate()` runs every migration in a tx — so it is NOT a drop-in swap.

**Scope:** decide + document a runbook for large-table index builds that run CONCURRENTLY OUT of the
Drizzle migration tx (e.g. a separate ops-applied step, or a Drizzle "no-transaction" migration mode
if supported), WITHOUT breaking the single-source-of-truth migration discipline. Project-wide (not
0021-specific). The existing `IF NOT EXISTS` on these indexes keeps a later CONCURRENTLY re-creation
path non-conflicting.

**Goal (SMART):** "Document (and, if a mechanism exists, implement) a CONCURRENTLY path for
large-table index migrations so a production index build does not block writes, decided before any
production `memories` table exceeds a write-hot threshold; tracked as a runbook in `architecture.md`."

**Acceptance:** a runbook section exists; the decision (out-of-band step vs no-tx migration mode) is
recorded with rationale; no regression to the in-tx discipline for small migrations.

**Notes:** NOT a blocker for any current feature — it is a GA-readiness ops concern. Do NOT
special-case a single migration to CONCURRENTLY (diverges from precedent for no benefit).

---

## Out of this roadmap (tracked elsewhere)

- **Memory-gaps M1/M2** (procedural exec + sandbox; first-class episodes) — `.claude/knowledge-base/roadmaps/memory-gaps-roadmap.md`.
- **3 exposed credentials rotation** (1 OpenAI `sk-proj-…`, 2 `theo_live_…`) — operational security task, not a code milestone; rotate before any production deploy.

## Log

| Date | Change |
|---|---|
| 2026-06-23 | Roadmap created from the skills-cross-repo `/review` follow-ups (themory v0.21.0 + theo-cloud v0.8.0). |
| 2026-06-23 | M1 SHIPPED — theo-cloud v0.8.1 (dashboard-logs-sse-suite-repair); suite globally green, J-19 regressions restored. M2 + M3 remain. |
| 2026-06-23 | M2 READY_TO_MERGE — theo-memory `skills-subject-prefix-index` (migration 0021, `text_pattern_ops` index). /review 5 agents: 0 BLOCKER/0 HIGH/1 MEDIUM/4 LOW. Spun off M4 (CONCURRENTLY runbook) from the MEDIUM. M3 remains. |
