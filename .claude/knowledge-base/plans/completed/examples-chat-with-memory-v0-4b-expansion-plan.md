# Plan: examples/chat-with-memory v0.4b expansion — exercise eviction + soft-delete + e2e validate + dogfood evidence

> **Version 1.2** (2026-05-31) — Absorbs `/deps-audit` findings at `.claude/knowledge-base/audits/examples-chat-with-memory-v0-4b-expansion-deps-audit-2026-05-31.md`: (a) corrects `## Dependencies` drift (`next ^14.x` → `next ^15.5.18`); (b) documents 1 MODERATE postcss CVE GHSA-qx2v-qp2m-jg93 allowlisted with sunset 2026-08-29 (per `.claude/rules/deps-audit-allowlist.txt`).
>
> **Version 1.1** (2026-05-31) — Absorbs MUST FIX EC-1 from `/edge-case-plan` review at `.claude/knowledge-base/reviews/examples-chat-with-memory-v0-4b-expansion-edge-cases-2026-05-31.md` (T1.3 `userId` source specified as prop from `MemorySidebar`).
>
> **Version 1.0** (2026-05-31) — Closes the 3-gap surfaced post-PR-#24 honest review: (1) demo doesn't exercise the v0.4b `createLocalMemory({ eviction })` factory wiring that T4.1 shipped + that closed F-dom-2 CRITICAL via barrel exports; (2) `/api/memory/forget` + `/api/skills/forget` haven't been updated to reflect the `T7.1` PUBLIC API BREAKING soft-delete contract; (3) `/test-chat-with-memory` baseline was captured 2026-05-30 BEFORE the v0.4b-fixes-cycle landed + `.claude/knowledge-base/dogfood/evidence/` directory is empty.

## Goal

Validate that `examples/chat-with-memory` survives the v0.4b BREAKING contract change AND exercises the new eviction-via-factory surface end-to-end, measured by `/test-chat-with-memory` returning **READY 33/33** (30 existing scenarios + 3 new Eviction-tab scenarios in Group H) against the current `develop` tip after PR #24 merge.

The action verb is **validate**; the named observable metric is the `/test-chat-with-memory` re-run verdict (target: `READY 33/33`).

## Context

### What exists today

- `examples/chat-with-memory/` is a Next.js 14 demo with 4 tabs (User / Session / Skills / History), 2 forget endpoints (`/api/memory/forget` + `/api/skills/forget`), and a `lib/memory.ts` singleton that wires `createMemory({ vectorStore, embedder, llm, reflectionPolicy })` against PgvectorStore (when `THEOMEM_PG_URI` set) OR `InMemoryVectorStore` (when unset).
- The demo does **NOT** pass `eviction` to `createMemory()`, so the v0.4b eviction pipeline (`CapacityBasedTrigger` / `TimeBasedTrigger` / `PgEvictor`) is never instantiated from the demo. T4.1's `F-dom-2` closure ("consumers can construct eviction pipeline via the public API") is therefore exercised only by integration tests under `tests/integration/forgetting/createLocalMemory-eviction.test.ts`, NOT by the dogfood demo.
- Both forget endpoints call `await memory.forget(body.id)` (no `{ hard }` option). `T7.1` BREAKING changed behavior: row stays in DB with `t_invalid IS NOT NULL`. The `PgvectorStore.search()` and `.list()` paths filter `t_invalid IS NULL` so the UI list re-renders correctly (verified by reading `src/local/pgvector-store.ts:247,310`). **Existing B4/D5 scenarios should still PASS** post-`T7.1` because the UI uses the filtered query — but the demo offers no way for a consumer to opt into GDPR `hard:true` erasure.
- `/test-chat-with-memory` skill (`.claude/skills/test-chat-with-memory/SKILL.md`) defines 30 scenarios in 7 groups (A Infrastructure / B User scope / C Session scope / D Skills / E History / F Chat round-trip / G Edge cases). Last execution: `.claude/knowledge-base/reviews/chat-with-memory-e2e-2026-05-30-rerun.md` (`READY 30/30`). That run was 2026-05-30 BEFORE the v0.4b-fixes-cycle (PR #24 merged 2026-05-31).
- `/dogfood` skill audits `.claude/knowledge-base/dogfood/manifest.md` + `evidence/` directory. **Anchor scenario S1 ("Claude Code auto-memory backed by TheMemory") is `planned`** — wiring depends on v0.2 TheoKit binding OR a dedicated Claude Code adapter that hasn't shipped. Per `dogfood-golden-rule.md` rule 2 ("anchor not running" caps verdict at `EVIDENCE_INSUFFICIENT`), this plan **cannot** unlock production-ready vocabulary regardless of what we ship. The evidence file this plan adds is **process dogfood** — explicitly NOT a substitute for S1's `running` transition.

### Why this matters NOW

1. **Demo is the only daily dogfood surface for `@usetheo/memory` consumers.** When a consumer reads the demo to learn how to wire eviction, they currently learn the v0.3 shape (no eviction config). The README + demo together must show the v0.4b shape OR the v0.4b feature is hidden from new adopters.
2. **`T7.1` BREAKING semantic change is invisible from the UI** but visible from any consumer who queries raw SQL or uses `vectorStore.get()` directly. The forget endpoints have no integration test asserting the soft-delete contract from the API side. Adding an opt-in `{ hard }` parameter exercises BOTH paths through the demo.
3. **`/test-chat-with-memory` baseline staleness is honest tech debt.** The skill is the canonical regression gate for the demo (per testing.md pyramid: E2E tier). Re-running it post-cycle confirms (or denies) the verdict that 7 review agents emitted on the SDK side without touching the demo.
4. **Empty `evidence/` directory is honesty risk.** Per `dogfood-golden-rule.md`, the absence of evidence files for S1 is independently checked (`no_anchor_evidence` stable identifier). Adding a process-evidence file documenting the v0.4b-fixes verification work — explicitly labeled as `scenario: process-dogfood` (NOT `claude-code-auto-memory`) — preserves S1's locked status while filling the directory with traceable validation artifacts.

### Accepted risks (declared upfront)

- **EC-A — UI scenarios B4/D5 SHOULD still PASS post-`T7.1` because UI queries are filtered.** But the test was last run 2026-05-30. If anything regressed silently (e.g., a `t_invalid IS NULL` filter accidentally dropped), this plan catches it at T4.1 not at next consumer report. Acceptable.
- **EC-B — S1 anchor is `planned` not `running`.** This plan does NOT advance S1; the evidence file added at T5.1 is process dogfood. Anyone consuming this evidence file expecting it to unlock production-ready claims is misreading; the file's frontmatter `scenario:` field makes the distinction explicit + the file body cites `dogfood-golden-rule.md` rule 2 directly.
- **EC-C — `/test-chat-with-memory` cost is ~80-150k tokens per execution** (per `token-budget.md`). Acceptable for one-shot validation; not for continuous integration.
- **EC-D — Demo has no Jest/Vitest infrastructure today.** Per ADR D5 below, the plan does NOT introduce one; relies on `/test-chat-with-memory` E2E as the canonical gate (KISS + YAGNI). Trade-off: bugs in `lib/memory.ts`'s eviction wiring surface as E2E failures, not unit failures, with longer feedback loop. Acceptable given the demo's size (102 LoC) + scope.
- **EC-E — Eviction Tab is opt-in via env var.** Default demo behavior unchanged so existing tutorials and screenshots stay valid. The `THEOMEM_EVICTION_DEMO=1` env var toggles the new tab + the factory's `eviction` config. Reduces risk of breaking existing user flows.

### Compliance scope

Honors `architecture.md § 9` (demo consumes `@usetheo/memory` via public exports only; `LocalEvictionConfig` and `EvictionNotSupported` are public per src/index.ts T4.1 re-exports). Honors `architecture.md § Module hygiene` (new eviction-tab.tsx ≤ 200 LoC; lib/memory.ts grows from 102 → ~150 LoC, well under 500). Honors `testing.md` pyramid (E2E via Chrome DevTools MCP per the test-chat-with-memory skill; no new test infra in the demo per D5). Honors `dogfood-golden-rule.md` (evidence file does NOT claim S1 advancement; vocabulary lock on `production-ready` preserved). Honors `no-paper-names-in-code.md` (new code uses neutral names — "eviction-tab" / "eviction-status" / "show-evicted-toggle" — not "Mem0-style eviction" or similar). Honors `public-copy.md` (any demo README changes use `memory store` / `managed memory` framing per BODY tier; technical-direct OK below `## How it works`). Honors Inquebrável Rule 3 (extreme honesty — no production-ready claim emitted by this plan).

## Objective

- [ ] T0.1 — Pre-flight audit verifies clean working tree, develop ≥ `9a8bca3` (PR #24 merge tip), pgvector container running, port 3000 free, demo `.env` exists, `node_modules/` present.
- [ ] T1.1 — `lib/memory.ts` accepts optional `THEOMEM_EVICTION_DEMO=1` env var; when set + `PgvectorStore` selected, wires `createLocalMemory({ eviction: { trigger: 'capacity', maxMemoriesPerScope: 10 } })`. When unset, behavior unchanged (existing `createMemory(...)` path).
- [ ] T1.2 — New `/api/memory/eviction-status` endpoint returns `{ enabled: boolean, trigger: 'capacity'|'time'|null, maxMemoriesPerScope: number|null, softDeletedCount: number }` derived from `getSingleton()` + a `SELECT COUNT(*) WHERE t_invalid IS NOT NULL` against the scope.
- [ ] T1.3 — New `EvictionTab` component (~150 LoC) renders only when `eviction-status` reports `enabled: true`; otherwise the tab shows an inline hint to set `THEOMEM_EVICTION_DEMO=1`. The tab surfaces (a) current backend + trigger config, (b) current scope active row count vs cap, (c) soft-deleted rows list with `t_invalid` timestamps (raw `SELECT * WHERE t_invalid IS NOT NULL` via new helper endpoint).
- [ ] T2.1 — `/api/memory/forget` + `/api/skills/forget` accept optional `hard?: boolean` in request body. Default unchanged (soft-delete via `T7.1` contract). When `hard: true`, calls `memory.forget(body.id, { hard: true })`.
- [ ] T3.1 — `/test-chat-with-memory` skill catalog extended from 30 → 33 scenarios. New Group H — Eviction tab (3 scenarios): H1 EvictionTab visible when env var set; H2 capacity overflow fires evict (seed > cap; remember; observe softDeletedCount > 0); H3 forget(id, { hard:true }) physically deletes (`COUNT(*) WHERE id = ?` returns 0).
- [ ] T4.1 — Run `/test-chat-with-memory` against demo tip. Assert verdict READY 33/33; if any scenario FAILs, halt + write findings + open fix sub-plan.
- [ ] T5.1 — Write process-dogfood evidence file at `.claude/knowledge-base/dogfood/evidence/2026-05-31-process-v0-4b-fixes-cycle-validation.md` documenting the v0.4b-fixes verification chain (PR #24 merge + this plan's E2E rerun + the 3 carried follow-ups). Frontmatter `scenario: process-dogfood` (NOT `claude-code-auto-memory`) to preserve S1's locked status.
- [ ] T6.1 — Final validation gate: `npm test` PASS, `npm run typecheck` PASS, `npm run lint` PASS, demo `npm install && npm run build` PASS, `/test-chat-with-memory` verdict locked at READY 33/33. Commit + push.

## ADRs

### D1 — Eviction is opt-in via env var (`THEOMEM_EVICTION_DEMO=1`), not default-on

**Decision:** demo's `lib/memory.ts` reads `THEOMEM_EVICTION_DEMO` env var. When `1` AND backend resolves to `pgvector`, wire `createLocalMemory({ eviction: { trigger: 'capacity', maxMemoriesPerScope: 10 } })`. Otherwise call existing `createMemory(...)`.

**Rationale:** existing tutorials + screenshots assume the v0.3 demo shape (no eviction). Defaulting eviction ON would silently change demo behavior + invalidate any external docs that reference the demo's UI. Opt-in via env var preserves backward compat for casual demo users while showcasing the v0.4b feature for consumers who explicitly want to learn it. `maxMemoriesPerScope: 10` is low enough that 11-message chat conversations trigger eviction empirically; demonstrates the capacity-trigger contract within a realistic demo session.

**Alternatives considered:**

- (A) **Default-on for `pgvector` backend, off for in-memory:** REJECTED — silently changes demo behavior for any user with an existing `.env` setting `THEOMEM_PG_URI`. Surprise factor too high.
- (B) **CLI flag to `npm run dev`:** REJECTED — Next.js doesn't propagate CLI args to the runtime; would need a wrapper script.
- (C) **Selected: env var** — clean, conventional, isolated to the demo's process scope, documented in demo README.

**Consequences:** demo `.env.example` (if present) gains a commented `# THEOMEM_EVICTION_DEMO=1` line. Demo README's "How to run" section gains a one-paragraph callout: "to see the v0.4b eviction pipeline in action, set `THEOMEM_EVICTION_DEMO=1`". `console.log` at boot logs `eviction=disabled|enabled` alongside the existing `backend=pgvector|in-memory` line.

### D2 — Forget endpoints accept opt-in `{ hard: boolean }` (default unchanged)

**Decision:** `/api/memory/forget` and `/api/skills/forget` extend their request body interface with an optional `hard?: boolean` field. Implementation: `await memory.forget(body.id, body.hard === true ? { hard: true } : undefined)`. Default behavior unchanged (soft-delete per `T7.1` contract).

**Rationale:** v0.4b `T7.1` BREAKING declared GDPR escape hatch via `{ hard: true }`. The demo is the most visible consumer of `Memory.forget` — exposing the option in the API surface lets users explore both contracts via the UI without touching code. Default unchanged preserves the contract that the UI's filtered queries already rely on (B4/D5 scenarios assume reload removes the item from list; soft-delete + filtered query achieves this).

**Alternatives considered:**

- (A) **Always soft-delete (no `hard` option in API):** REJECTED — leaves GDPR contract un-demonstrable from the demo; consumer would have to read source code to discover the escape hatch.
- (B) **Always hard-delete (preserve v0.1 API behavior):** REJECTED — contradicts the `T7.1` BREAKING contract; would re-introduce F-dom-3 inconsistency between caller-driven and trigger-driven forget paths.
- (C) **Selected: opt-in `hard` flag, default soft-delete** — exercises both contracts; default matches v0.4b semantics; existing demo flows unaffected.

**Consequences:** request body TypeScript interface extends from `{ userId: string; id: string }` to `{ userId: string; id: string; hard?: boolean }`. Tab UI trash-icon button stays single-click → soft-delete; a shift-click or context-menu may later add the hard-delete affordance (out of scope for this plan; logged as follow-up).

### D3 — EvictionTab is conditional, not always-rendered

**Decision:** `EvictionTab` component reads `/api/memory/eviction-status` on mount. When `enabled: false`, renders an inline hint card explaining how to enable. When `enabled: true`, renders the full tab (backend info + scope stats + soft-deleted list).

**Rationale:** eviction status depends on demo runtime config (env var + backend). Always-rendering would either (a) require eviction code paths to handle the disabled state internally (more complex), or (b) clutter the demo with a non-functional tab. Conditional render isolates the v0.4b feature behind a single env var while keeping the tab itself simple — no dead-state branches in the eviction-status helpers.

**Alternatives considered:**

- (A) **Always-render with disabled visual state:** REJECTED — clutters the UI for users not exercising eviction.
- (B) **Hide tab entirely when disabled:** REJECTED — defeats the discoverability goal (consumer learning the v0.4b API can't see what's available).
- (C) **Selected: render conditionally with inline hint** — discoverable + clean + KISS.

**Consequences:** `eviction-status` endpoint must respond even when eviction is disabled (returns `{ enabled: false, trigger: null, maxMemoriesPerScope: null, softDeletedCount: 0 }`). The hint copy is the public-copy.md BODY tier (technical-direct OK) and points at the demo README's eviction section.

### D4 — Dogfood evidence is "process dogfood" (NOT S1 anchor advancement)

**Decision:** evidence file written at T5.1 carries frontmatter `scenario: process-dogfood` (a brand new slug, NOT the locked `claude-code-auto-memory` anchor slug). File body documents the v0.4b-fixes-cycle verification chain (PR #24 + this plan's rerun) as process evidence — NOT consumer-side adoption evidence.

**Rationale:** per `dogfood-golden-rule.md` rule 2, S1 must be `running` to count toward `EVIDENCE_SUFFICIENT`. S1 is `planned` because the v0.2 wiring (Claude Code adapter or TheoKit binding for Claude Code) hasn't shipped. Adding evidence under S1's slug would either (a) be silent fabrication (S1 not `running` ≠ evidence valid) or (b) accidentally trigger `anchor_evidence_stale` audit logic. The honest path: introduce a SEPARATE `process-dogfood` slug for this evidence + leave S1 untouched.

**Alternatives considered:**

- (A) **Promote S1 to `running` and add evidence under it:** REJECTED — silently jumps S1 from `planned` to `running` without the milestones declared in the manifest (v0.1 core + v0.2 binding). Hard violation of dogfood-golden-rule § Why this rule exists.
- (B) **Skip evidence file entirely:** REJECTED — leaves the `evidence/` directory empty + makes future audits read "we just don't dogfood" when in reality we do extensive process validation.
- (C) **Selected: process-dogfood slug, separate from S1, explicitly NOT counted toward `EVIDENCE_SUFFICIENT`** — honest + auditable + doesn't poison the golden rule's enforcement model.

**Consequences:** evidence file body explicitly cites `dogfood-golden-rule.md` § The Rule (rule 2 — anchor not running) and acknowledges that this file does NOT unlock production-ready vocabulary. The manifest itself gets an appendix paragraph documenting `process-dogfood` as a non-counted secondary scenario.

### D5 — Demo gains NO new test infrastructure (`/test-chat-with-memory` is the canonical E2E gate)

**Decision:** the demo's `package.json` is NOT modified to add Jest/Vitest. Glue code in `lib/memory.ts` + `EvictionTab` + 2 new endpoints is tested only via `/test-chat-with-memory` Chrome DevTools MCP scenarios.

**Rationale:** introducing a unit test infrastructure for ~150 LoC of demo glue code violates KISS + YAGNI. The demo's purpose is to be a consumer-facing showcase; the contract surface (`@usetheo/memory`) already has 544 contract tests + 67 integration tests covering the underlying primitives. The demo's risk surface is integration of those primitives + Next.js plumbing — exactly what Chrome DevTools MCP exercises.

**Alternatives considered:**

- (A) **Add `vitest` to demo's devDeps + write unit tests for `lib/memory.ts`:** REJECTED — adds maintenance burden (sync with main monorepo's vitest version; demo's tsconfig vs main's; etc.) for minimal incremental coverage above what `/test-chat-with-memory` already provides.
- (B) **Snapshot tests for the EvictionTab via React Testing Library:** REJECTED — snapshot tests for a tab that depends on a live API endpoint are flaky + low-value.
- (C) **Selected: rely on `/test-chat-with-memory` skill (3 new scenarios in Group H)** — single source of truth for demo regressions, consistent with the 30 existing scenarios.

**Consequences:** new code in the demo cannot be unit-tested in isolation. Bugs surface as `/test-chat-with-memory` failures (slow feedback loop, ~80-150k tokens to re-run). Acceptable given the demo's stable size + the existing 7-group scenario catalog.

## Dependency Graph

```
T0.1 (preflight)
  ↓
T1.1 (lib/memory.ts eviction wiring) ─┐
                                       ├─→ T1.2 (eviction-status endpoint) ─→ T1.3 (EvictionTab UI)
T2.1 (forget endpoints {hard}) ────────┘
                                                                                ↓
                                                                              T3.1 (skill catalog extension)
                                                                                ↓
                                                                              T4.1 (/test-chat-with-memory rerun)
                                                                                ↓
                                                                              T5.1 (dogfood evidence) → T6.1 (validation gate + commit)
```

T0.1 is the gate. T1.1 + T2.1 can parallelize (they touch different files). T1.2 depends on T1.1 (consumes the singleton's eviction state). T1.3 depends on T1.2 (UI consumes the endpoint). T3.1 depends on T1.3 + T2.1 (new scenarios reference UI + API surface). T4.1 depends on T3.1 (skill catalog must contain Group H to validate). T5.1 + T6.1 chain after T4.1.

---

## Phase T0: Pre-flight

### T0.1 — Verify clean state + pgvector + port 3000 free + .env + node_modules

#### Objective

Refuse to start if any pre-condition fails, per the `/test-chat-with-memory` skill's documented refuse-or-proceed contract.

#### Evidence

`.claude/skills/test-chat-with-memory/SKILL.md § Step 1 — Pre-flight validation` lists 5 hard checks. This task lifts the same checks to T0.1 of the plan so T1+ work doesn't begin if the environment is broken.

#### Files to edit

```
(none — pure verification phase; no commits)
```

#### Tasks

1. `git status --porcelain | grep -vE "^\?\? \.claude/(\.compaction-snapshots|knowledge-base/concepts)" | head -1` returns empty.
2. `git log -1 --oneline` shows tip at OR after `85d87bd` (post-PR-#24 plan archival).
3. `docker ps --filter "publish=5432" --format "{{.Names}}"` returns ≥1 container.
4. `lsof -ti:3000` returns empty.
5. `test -f examples/chat-with-memory/.env && grep -qE "^THEOMEM_PG_URI=" examples/chat-with-memory/.env`.
6. `test -d examples/chat-with-memory/node_modules`.

#### TDD

```
RED:      none (verification-only)
GREEN:    all 6 checks pass; print confirmation
REFACTOR: none
VERIFY:   bash gate as above
```

#### Acceptance Criteria

- [ ] All 6 pre-flight checks PASS at the start of T1.1; otherwise halt.

#### DoD

- [ ] Confirmation logged inline in T1.1's commit body.

---

## Phase T1: Demo wiring for v0.4b eviction

### T1.1 — `lib/memory.ts` reads `THEOMEM_EVICTION_DEMO` and wires `createLocalMemory({ eviction })`

#### Objective

Extend the demo's singleton factory to opt-in eviction when `THEOMEM_EVICTION_DEMO=1` AND backend resolves to `pgvector`. Preserve existing default behavior.

#### Evidence

Current `examples/chat-with-memory/lib/memory.ts:75-95` calls `createMemory({ embedder, llm, vectorStore, reflectionPolicy })`. The factory `createLocalMemory({ eviction: { trigger, maxMemoriesPerScope } })` is publicly exported per T4.1 commit `cf18b7b` — verified at `src/index.ts:14-15` (`createLocalMemory` + `LocalEvictionConfig`).

#### Files to edit

```
examples/chat-with-memory/lib/memory.ts — UPDATE: import createLocalMemory + LocalEvictionConfig; read THEOMEM_EVICTION_DEMO; branch on env var; default unchanged
examples/chat-with-memory/.env.example   — UPDATE if exists, else CREATE (NEW): add `# THEOMEM_EVICTION_DEMO=1  # set to 1 to enable v0.4b capacity-trigger eviction (pgvector only)`
examples/chat-with-memory/README.md       — UPDATE: add one-paragraph callout under "How to run" explaining the env var + the EvictionTab
```

#### Deep file dependency analysis

- `lib/memory.ts` exports `getSingleton`, `getMemory`, `getBackend`. Consumers: all 8 API routes + chat/skills/memory tabs. The `MemorySingleton` interface gains a new readonly field `eviction: { enabled: boolean; trigger: 'capacity'|'time'|null; maxMemoriesPerScope: number|null }` so T1.2's endpoint can serialize it.
- `@usetheo/memory` exports `createLocalMemory` + `LocalEvictionConfig` per T4.1's barrel work — verified by grep on `src/local/eviction/index.ts:20` + `src/index.ts:14-58`.
- The demo dispose pattern: `createLocalMemory` returns `DisposableMemory` (Memory + `dispose()`). Singleton lives for the Node process lifetime; `dispose()` is not called from the demo today + isn't called in T1.1 either. Acceptable risk because Next.js dev mode HMR doesn't re-instantiate the singleton (per `globalThis._themory_demo_singleton` pattern).

#### Deep Dives

- **Branch shape**: `const evictionEnabled = process.env.THEOMEM_EVICTION_DEMO === '1' && backend === 'pgvector';` — both conditions required. Logs `eviction=enabled (capacity, max=10)` or `eviction=disabled (reason: env|backend)` at boot for diagnostics.
- **Why `maxMemoriesPerScope: 10`**: low enough that 11-message chat sessions trigger eviction empirically (demonstrates the contract within a realistic demo run). 1000 (the production-canonical value from T4.1 JSDoc) would never trigger during a demo session.
- **Why `trigger: 'capacity'` not `'time'`**: capacity is post-remember, fires synchronously, easier to observe in the UI. Time-trigger requires cron scheduling, hard to demonstrate in a 30-scenario E2E run.

#### Tasks

1. RED test scaffolding: not applicable per ADR D5 (no demo unit-test infra). Acceptance is via T4.1 E2E.
2. Read current `lib/memory.ts` shape.
3. Add `import { createLocalMemory } from '@usetheo/memory'` + `import type { LocalEvictionConfig } from '@usetheo/memory'`.
4. Extend `MemorySingleton` interface with the `eviction` field.
5. In `getSingleton()`, branch: if `THEOMEM_EVICTION_DEMO === '1'` AND `backend === 'pgvector'`, call `createLocalMemory({ ...config, eviction: { trigger: 'capacity', maxMemoriesPerScope: 10 } })`; else call existing `createMemory(...)`.
6. Update `console.log` to include `eviction=` line.
7. Update `.env.example` + README.

#### TDD

```
RED:      n/a (ADR D5 — no demo unit-test infra)
GREEN:    boot demo with THEOMEM_EVICTION_DEMO=1 + pgvector; observe console line `eviction=enabled (capacity, max=10)`
GREEN:    boot demo without env var; observe console line `eviction=disabled (reason: env var unset)`
REFACTOR: none expected (clean conditional branch)
VERIFY:   E2E rerun at T4.1
```

#### Acceptance Criteria

- [ ] Console log shows `eviction=enabled (capacity, max=10)` when `THEOMEM_EVICTION_DEMO=1` AND pgvector backend.
- [ ] Console log shows `eviction=disabled (reason: env|backend)` otherwise.
- [ ] `lib/memory.ts` ≤ 200 LoC post-changes (was 102; budget 500 per architecture.md § Module hygiene).
- [ ] `npm run build` in `examples/chat-with-memory/` succeeds (TypeScript clean).
- [ ] No paper names introduced (no `Mem0`, `Voyager`, etc. in new code per `no-paper-names-in-code.md`).

#### DoD

- [ ] Demo `npm run build` PASS.
- [ ] README + .env.example update committed.
- [ ] Architecture.md DIP boundary preserved (demo imports from `@usetheo/memory` public surface only).

### T1.2 — `/api/memory/eviction-status` endpoint

#### Objective

Surface the singleton's eviction config + the scope's soft-deleted row count so T1.3's UI can render the EvictionTab.

#### Evidence

EvictionTab needs runtime state that lives in the singleton (`eviction` field added at T1.1) PLUS a count of `t_invalid IS NOT NULL` rows for the queried user/session scope. Existing endpoints don't expose either.

#### Files to edit

```
examples/chat-with-memory/app/api/memory/eviction-status/route.ts — NEW: GET endpoint; reads getSingleton().eviction + raw SELECT COUNT(*) WHERE t_invalid IS NOT NULL filtered by userId
```

#### Deep file dependency analysis

- `app/api/memory/eviction-status/route.ts` (NEW) imports `getSingleton` from `@/lib/memory` (existing) + `NextResponse` from `next/server` (existing). No new package deps.
- Query shape: `?userId=...` (mandatory). When eviction is disabled, returns shape `{ enabled: false, trigger: null, maxMemoriesPerScope: null, softDeletedCount: 0 }` so the UI can branch cleanly.
- Raw COUNT SQL: `SELECT COUNT(*)::text AS count FROM memories WHERE user_id = $1 AND t_invalid IS NOT NULL`. Uses the singleton's `pgPool` (already wired in `MemorySingleton`).

#### Deep Dives

- **Why expose raw `t_invalid` count via a side-endpoint instead of widening the existing `/api/memory/recall`**: `recall` filters `t_invalid IS NULL` per the v0.4b contract (verified `src/local/pgvector-store.ts:247`). Including soft-deleted rows in recall would BREAK the recall contract. The side-endpoint exposes the count without touching recall semantics.
- **InMemoryVectorStore handling**: when `backend === 'in-memory'`, the endpoint returns `{ enabled: false, trigger: null, ... }`. No `t_invalid` concept exists in the in-memory adapter (per `T7.1` commit body); the endpoint doesn't attempt to query it.

#### Tasks

1. RED test: n/a (ADR D5).
2. Create the route handler. Return shape from `MemorySingleton.eviction` + raw COUNT query against pgPool when pgvector backend.
3. Validate `userId` query param; 400 on missing.
4. Confirm `npm run build` passes.

#### TDD

```
RED:      n/a (ADR D5)
GREEN:    curl GET http://localhost:3000/api/memory/eviction-status?userId=alice (env var set, pgvector) → returns { enabled: true, trigger: 'capacity', maxMemoriesPerScope: 10, softDeletedCount: 0 }
GREEN:    curl same (env var unset) → returns { enabled: false, trigger: null, maxMemoriesPerScope: null, softDeletedCount: 0 }
GREEN:    seed soft-deleted rows directly via psql; re-curl; softDeletedCount > 0
REFACTOR: none
VERIFY:   T4.1 H2 scenario
```

#### Acceptance Criteria

- [ ] Endpoint responds 200 with the documented shape for both enabled + disabled states.
- [ ] Endpoint responds 400 when `userId` missing.
- [ ] Route file ≤ 100 LoC.

#### DoD

- [ ] Demo `npm run build` PASS.

### T1.3 — `EvictionTab` component + tab registration in sidebar

#### Objective

Surface eviction state in the UI as a 5th tab (alongside User / Session / Skills / History). When `enabled: false`, the tab renders a one-paragraph hint card; when `true`, it shows backend + trigger config + scope row count vs cap + soft-deleted rows list.

#### Evidence

Tab pattern established by `components/memory-tabs/user-tab.tsx` + `session-tab.tsx` + `skills-tab.tsx` + `history-tab.tsx`. EvictionTab follows the same shape (use client, useEffect data fetch, Card UI components from `@usetheo/ui`).

#### Files to edit

```
examples/chat-with-memory/components/memory-tabs/eviction-tab.tsx — NEW: ~150 LoC component
examples/chat-with-memory/components/memory-sidebar.tsx           — UPDATE: register Eviction tab after History tab
```

#### Deep file dependency analysis

- `eviction-tab.tsx` (NEW): imports `Card`, `Button` from `@usetheo/ui`; uses `useEffect` to fetch from `/api/memory/eviction-status`; conditional render on `enabled` flag.
- `memory-sidebar.tsx` (UPDATE): tab list extended from 4 to 5; new tab id `eviction`; defaults stay on `user` tab.
- **EC-1 absorption (`userId` source — pre-`/edge-case-plan` ambiguity)**: `EvictionTab` receives `userId` via prop from `MemorySidebar` (same pattern as `UserTab.userId`). The `useEffect` fetch only fires when `userId` is truthy. Without this, the endpoint returns 400 (per T1.2 contract) before any conditional render runs, and the H1 scenario fails silently. Reference: `examples/chat-with-memory/components/memory-tabs/user-tab.tsx` for the canonical prop-shape.

#### Deep Dives

- **Render shape when disabled**: single Card with title "Eviction (v0.4b)" + body "Set `THEOMEM_EVICTION_DEMO=1` to enable. See README §  How to run." + a non-clickable link to the README anchor.
- **Render shape when enabled**:
  - Top section: backend badge + trigger badge + maxMemoriesPerScope as a stat tile.
  - Middle section: "Active rows: N / 10" with a progress bar; "Soft-deleted: M" as a counter.
  - Bottom section: "Show soft-deleted" toggle button; when clicked, fetches a NEW endpoint `/api/memory/soft-deleted?userId=...` (declared as a sibling endpoint in T1.2 if needed OR deferred to follow-up — see plan-confidence). For v1.0 of this plan, render only the COUNT (no list rendering needed for the 3 H scenarios).
- **EC-D — UI scenarios B4/D5 risk**: clicking trash icon on a User-tab card still calls `/api/memory/forget` (unchanged) which still soft-deletes by default. UI list refreshes via the existing `/api/memory/recall` which filters out `t_invalid IS NOT NULL`. B4 PASS post-`T7.1` IS the expected baseline.

#### Tasks

1. Create `eviction-tab.tsx` with conditional render branch.
2. Register tab in `memory-sidebar.tsx`.
3. Confirm `npm run build` passes.

#### TDD

```
RED:      n/a (ADR D5)
GREEN:    boot demo with env var → click Eviction tab → tab content shows trigger + cap + counters
GREEN:    boot demo without env var → click Eviction tab → tab content shows hint card pointing at README
REFACTOR: none
VERIFY:   T4.1 H1 + H2 scenarios
```

#### Acceptance Criteria

- [ ] EvictionTab renders the hint when disabled; renders the runtime state when enabled.
- [ ] `eviction-tab.tsx` ≤ 200 LoC.
- [ ] No console errors when switching tabs.

#### DoD

- [ ] Demo `npm run build` PASS.

---

## Phase T2: Forget endpoint `{ hard }` support

### T2.1 — `/api/memory/forget` + `/api/skills/forget` accept optional `hard?: boolean`

#### Objective

Expose the `T7.1` GDPR escape hatch (`{ hard: true }`) through both forget endpoints so consumers can opt into physical-delete semantics from the demo UI/script.

#### Evidence

Current `/api/memory/forget/route.ts:27` calls `await memory.forget(body.id)` (no options). `T7.1` commit `3d178e4` widened `Memory.forget` signature to `forget(memoryId, options?: ForgetOptions)` where `ForgetOptions.hard?: boolean` is exposed publicly.

#### Files to edit

```
examples/chat-with-memory/app/api/memory/forget/route.ts — UPDATE: ForgetRequest interface gains hard?: boolean; pass options when set
examples/chat-with-memory/app/api/skills/forget/route.ts — UPDATE: same
```

#### Deep file dependency analysis

- Both routes import `getMemory` (memory) or `memory.skills(repoId)` (skills) via the singleton. Signature change is additive on the request body interface.
- No UI changes in this task — the trash icon still single-clicks → soft-delete (default). Hard-delete is invoked only via direct fetch (T3.1 H3 scenario uses `evaluate_script` to construct the body).

#### Deep Dives

- **Validation**: `if (typeof body.hard !== 'undefined' && typeof body.hard !== 'boolean')` → 400 with `{ error: "hard must be boolean if provided" }`. Other shape errors unchanged.
- **Backward compat**: existing UI flow (no `hard` field in body) keeps invoking soft-delete — preserves B4/D5 contract.

#### TDD

```
RED:      n/a (ADR D5)
GREEN:    curl POST /api/memory/forget {userId, id} → 200, raw SELECT WHERE id=$1 returns 1 row with t_invalid set
GREEN:    curl POST /api/memory/forget {userId, id, hard:true} → 200, raw SELECT WHERE id=$1 returns 0 rows
GREEN:    curl POST /api/memory/forget {userId, id, hard:"yes"} → 400 "hard must be boolean if provided"
REFACTOR: none
VERIFY:   T4.1 H3 scenario
```

#### Acceptance Criteria

- [ ] Both forget routes accept optional `hard?: boolean`.
- [ ] Default behavior unchanged (soft-delete via `T7.1`).
- [ ] Invalid `hard` value returns 400.

#### DoD

- [ ] Demo `npm run build` PASS.

---

## Phase T3: `/test-chat-with-memory` skill catalog extension

### T3.1 — Extend skill catalog from 30 to 33 scenarios (Group H — Eviction tab)

#### Objective

Update `.claude/skills/test-chat-with-memory/SKILL.md` § Scenario catalogue to document 3 new Group H scenarios that exercise the eviction tab + the `{ hard }` opt-in.

#### Evidence

`.claude/skills/test-chat-with-memory/SKILL.md` lines 119-201 define groups A-G with 30 scenarios. The skill is the canonical regression gate; extending it ensures /test-chat-with-memory enforces the new contract going forward.

#### Files to edit

```
.claude/skills/test-chat-with-memory/SKILL.md — UPDATE: add Group H section with 3 scenarios (H1, H2, H3)
```

#### Deep file dependency analysis

- The skill drives Chrome DevTools MCP per the established pattern (`take_snapshot` for DOM uids, `list_network_requests` for HTTP assertions, `evaluate_script` for direct fetch). H scenarios follow the same shape.
- H scenarios require `THEOMEM_EVICTION_DEMO=1` exported in the spawned dev server's environment (per skill Step 2 pattern of setting `THEOMEM_REFLECTION_THRESHOLD=2`).

#### Deep Dives

- **H1 — EvictionTab visible when env var set**: pre-flight asserts the dev server was spawned with `THEOMEM_EVICTION_DEMO=1`. Click Eviction tab. `take_snapshot` shows "Active rows: N / 10" stat AND backend badge "pgvector".
- **H2 — capacity overflow fires evict**: seed 11 user memories via repeated `B1`-style sends (or via direct API POST to `/api/memory` if shorter). After the 11th send, `GET /api/memory/eviction-status?userId=...` returns `softDeletedCount: ≥ 1`. Eviction Tab counter reflects.
- **H3 — `forget(id, { hard: true })` physically deletes**: pick any existing User-tab fact's id. `evaluate_script` constructs `fetch('/api/memory/forget', { method: 'POST', body: JSON.stringify({ userId, id, hard: true }) })`. Response 200. `GET /api/memory/recall?userId=... AND raw COUNT(*) WHERE id=$1` returns 0 rows (verified via a SQL-helper endpoint OR via the `eviction-status` endpoint observing `softDeletedCount` did NOT increment — the row is gone, not soft-deleted).

#### Tasks

1. Read existing skill catalog (groups A-G).
2. Append Group H section in the same table format.
3. Update Step 2 (spawn dev server) section to add `THEOMEM_EVICTION_DEMO=1` to the exported env vars.
4. Update Step 5 (report shape) to extend the verdict map from 30 to 33.

#### TDD

```
RED:      n/a (skill catalog is a doc; verification is via T4.1 execution)
GREEN:    skill file lists Group H — Eviction tab (3 scenarios) with documented setup + action + pass criterion
REFACTOR: none
VERIFY:   T4.1 invocation
```

#### Acceptance Criteria

- [ ] Group H section present with 3 scenarios.
- [ ] Step 2 exports `THEOMEM_EVICTION_DEMO=1` for the spawned dev server.
- [ ] Verdict map references "READY 33/33" as the new target (not 30/30).

#### DoD

- [ ] Skill file lints clean (no broken markdown tables).

---

## Phase T4: Empirical validation via `/test-chat-with-memory`

### T4.1 — Run `/test-chat-with-memory` against demo tip; assert READY 33/33

#### Objective

Execute the skill end-to-end against the demo running at `localhost:3000` with `THEOMEM_EVICTION_DEMO=1`. Capture per-scenario PASS/FAIL evidence. Verdict must be `READY 33/33`.

#### Evidence

The skill documents its own report shape at `.claude/skills/test-chat-with-memory/templates/report-template.md`. Reports persist under `.claude/knowledge-base/reviews/chat-with-memory-e2e-{YYYY-MM-DD}.md`. Past run: `chat-with-memory-e2e-2026-05-30-rerun.md` (`READY 30/30`).

#### Files to edit

```
.claude/knowledge-base/reviews/chat-with-memory-e2e-2026-05-31-rerun.md — NEW (written by /test-chat-with-memory)
```

#### Deep Dives

- **Pre-flight**: skill itself runs the 5 checks from Step 1; if any fail, halt with the specific missing piece.
- **Cleanup**: skill's Step 4 always runs (kill background server + truncate DB).
- **Cost**: ~80-150k tokens for the full 33-scenario run.

#### Tasks

1. Invoke `/test-chat-with-memory`.
2. Read the generated report.
3. If verdict != READY 33/33, halt + record the FAIL scenarios + write a fix sub-plan.

#### TDD

```
RED:      pre-T4.1 state — /test-chat-with-memory not yet run against PR #24 tip; verdict unknown
GREEN:    /test-chat-with-memory verdict = READY 33/33 in 2026-05-31-rerun.md report
REFACTOR: n/a
VERIFY:   read the report file inline
```

#### Acceptance Criteria

- [ ] Report file exists at `.claude/knowledge-base/reviews/chat-with-memory-e2e-2026-05-31-rerun.md`.
- [ ] Verdict line is `READY` (33/33).
- [ ] All Group H scenarios marked PASS with evidence (snapshot + network observation).
- [ ] No console errors in the dev server log.

#### DoD

- [ ] Report committed.

---

## Phase T5: Dogfood evidence

### T5.1 — Write process-dogfood evidence file (NOT S1 anchor advancement)

#### Objective

Fill the empty `.claude/knowledge-base/dogfood/evidence/` directory with a traceable evidence file documenting the v0.4b-fixes-cycle verification chain. Frontmatter scenario explicitly `process-dogfood` (NOT `claude-code-auto-memory`), preserving S1's locked status.

#### Evidence

`.claude/rules/dogfood-golden-rule.md` rule 2: anchor S1 must be `running` for evidence to count. Manifest line ~22 shows `Status: planned`. Adding evidence under S1's slug would either be silent fabrication OR trigger `anchor_evidence_stale` audit logic incorrectly.

#### Files to edit

```
.claude/knowledge-base/dogfood/evidence/2026-05-31-process-v0-4b-fixes-cycle-validation.md — NEW
.claude/knowledge-base/dogfood/manifest.md — UPDATE: append "Process dogfood" appendix paragraph documenting process-dogfood as a NON-counted secondary scenario
```

#### Deep Dives

- **Frontmatter shape**:
  ```yaml
  ---
  scenario: process-dogfood
  date: 2026-05-31
  pr: 24
  merge_commit: 9a8bca3
  goal_test_recall_at_10: 1.000
  test_chat_with_memory_verdict: READY 33/33
  unlocks_production_ready_claim: false   # explicit per dogfood-golden-rule.md rule 2
  ---
  ```
- **Body**: documents the cycle's empirical gates (npm test 544/546, integration 67/67, /test-chat-with-memory 33/33, GOAL TEST 1.000), the BREAKING change disclosure (`T7.1` + ADR D7 + CHANGELOG `**BREAKING**:` prefix), the 3 carried follow-ups (F-T4.1-1 + F-`T9.1`-1 + F-tests-NEW-1), and explicitly cites `dogfood-golden-rule.md § The Rule` confirming this file does NOT unlock production-ready claims.

#### Tasks

1. Create the evidence file with the frontmatter + body.
2. Append the appendix paragraph to manifest.md.

#### TDD

```
RED:      n/a (doc artifact)
GREEN:    evidence file exists with the documented frontmatter + body cites dogfood-golden-rule.md rule 2 verbatim
REFACTOR: n/a
VERIFY:   run `/dogfood` post-T5.1 — verdict stays EVIDENCE_INSUFFICIENT (because S1 still planned); the process-dogfood file is logged but does NOT count toward EVIDENCE_SUFFICIENT
```

#### Acceptance Criteria

- [ ] Evidence file exists with the documented frontmatter.
- [ ] Body explicitly references `dogfood-golden-rule.md § The Rule` rule 2.
- [ ] Manifest appendix paragraph documents process-dogfood as NON-counted.
- [ ] `/dogfood` re-run (optional) reports `EVIDENCE_INSUFFICIENT` with stable identifier `anchor_not_running` triggered — confirming the rule still gates production-ready vocabulary correctly.

#### DoD

- [ ] Files committed.

---

## Phase T6: Final validation gate + commit

### T6.1 — Validation gate; commit; push

#### Objective

Run the project's standard validation gates against the demo + main repo + skill catalog. Commit. Push to origin.

#### Evidence

`/implement` + `/review` validation requires: npm test + npm run typecheck + npm run lint + integration tests (where applicable) PASS. Demo additionally: `npm install && npm run build` in `examples/chat-with-memory/`.

#### Files to edit

```
(none — pure validation + git commit)
```

#### Tasks

1. `npm test` → PASS expected.
2. `npm run typecheck` → exit 0.
3. `npm run lint` → exit 0 (no errors, no warnings).
4. `cd examples/chat-with-memory && npm run build && cd -` → demo Next.js build PASS.
5. `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/eviction tests/integration/forgetting` → 67/67 PASS (unchanged from PR #24).
6. Commit all plan artifacts (demo files + skill catalog + evidence + manifest appendix).
7. `git push origin develop`.

#### TDD

```
RED:      pre-T6.1 — gates may surface issues introduced by T1-T5
GREEN:    all 5 gates PASS
REFACTOR: address any gate failures and re-run
VERIFY:   git log post-push
```

#### Acceptance Criteria

- [ ] All 5 gates PASS.
- [ ] Single commit (or up to 3 atomic commits per file group: demo / skill / dogfood) on develop.
- [ ] Pushed to origin/develop.

#### DoD

- [ ] `git log origin/develop -3` shows the new commits.
- [ ] No regressions in any pre-PR-#24 test suite.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Demo doesn't exercise `createLocalMemory({ eviction })` (F-dom-2 consumer-side closure missing) | T1.1 + T1.2 + T1.3 | Singleton factory branches on `THEOMEM_EVICTION_DEMO=1` + pgvector backend; surfaces state via `/api/memory/eviction-status` + new `EvictionTab` UI |
| 2 | Forget endpoints lack `{ hard }` opt-in (`T7.1` GDPR contract un-demonstrable from demo) | T2.1 | Request body interface extended with `hard?: boolean`; default unchanged (soft-delete) |
| 3 | `/test-chat-with-memory` catalog stale (30 scenarios; eviction not covered) | T3.1 | Skill catalog extended to 33 scenarios via new Group H (3 Eviction scenarios) |
| 4 | `/test-chat-with-memory` baseline staleness (last run 2026-05-30 BEFORE PR #24) | T4.1 | Skill re-executed against post-PR-#24 tip; report at `chat-with-memory-e2e-2026-05-31-rerun.md` |
| 5 | `.claude/knowledge-base/dogfood/evidence/` directory empty (process dogfood unrecorded) | T5.1 | Process-dogfood evidence file written with `scenario: process-dogfood` (NOT S1 anchor) per ADR D4 |
| 6 | Final validation: lint/typecheck/build/integration all PASS | T6.1 | Five-gate chain executed; commits pushed |
| 7 | Pre-flight gate prevents starting on broken environment | T0.1 | 6-check pre-flight (clean tree, develop tip, pgvector container, port 3000, .env, node_modules) |

**Coverage: 7/7 gaps covered (100%)**

---

## Global Definition of Done

- [ ] All 7 tasks (T0.1 → T6.1) committed and validated.
- [ ] `npm test` PASS (no regressions).
- [ ] `npm run typecheck` exit 0.
- [ ] `npm run lint` exit 0 (no warnings).
- [ ] Demo `npm run build` PASS (TypeScript clean).
- [ ] `/test-chat-with-memory` verdict READY 33/33 in `chat-with-memory-e2e-2026-05-31-rerun.md`.
- [ ] Dogfood evidence file exists at `.claude/knowledge-base/dogfood/evidence/2026-05-31-process-v0-4b-fixes-cycle-validation.md` with explicit `unlocks_production_ready_claim: false`.
- [ ] No `production-ready` / `production-grade` / `v1.0 ready` token introduced anywhere in this plan's diff (vocabulary lock per public-copy.md + dogfood-golden-rule.md preserved).
- [ ] File-size budget respected: every new/modified file ≤ 500 LoC per architecture.md § Module hygiene.
- [ ] CHANGELOG.md `[Unreleased]` entry NOT required (this plan touches demo + tooling; the only code surface change — `Memory.forget(id, { hard })` opt-in in demo endpoints — was already shipped + CHANGELOG-disclosed in PR #24 via `T7.1` BREAKING entry).
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/examples-chat-with-memory-v0-4b-expansion-plan.md` AFTER /review verdict ≥ READY_TO_MERGE on this cycle's own PR (if any) OR after merge to main as a chore.

## Final Phase: Integration Validation (MANDATORY)

### Execution

```
npm test                                                    # contract suite green
THEOMEM_PG_URI=... npm run test:integration -- tests/integration/eviction tests/integration/forgetting   # eviction + forgetting suites green
npm run typecheck                                           # zero TS errors
npm run lint                                                # zero lint warnings
cd examples/chat-with-memory && npm run build && cd -       # demo Next.js build PASS
/test-chat-with-memory                                      # verdict READY 33/33
```

### Acceptance Criteria

- [ ] All 6 chain steps PASS in order.
- [ ] `/test-chat-with-memory` verdict locked at `READY 33/33`.
- [ ] No console errors observed in the dev server log during the 33-scenario run.

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing v0.4b-cycle artifacts (F3.5 + F3.6 are NOT introduced here).
2. Fix all plan-caused failures before declaring the plan complete.
3. Re-run the full validation chain to confirm fixes.
4. NEW BLOCKER/CRITICAL surfaces → draft `examples-chat-with-memory-v0-4b-expansion-plan v1.1` and re-loop; do NOT merge.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| @usetheo/memory | file:../.. (monorepo) | npm | Demo consumes the public surface (createLocalMemory + LocalEvictionConfig from src/index.ts T4.1 re-exports). |
| @usetheo/ui | ^0.12.0 | npm | EvictionTab uses Card + Button primitives (existing demo dep). |
| pg | ^8.13.0 | npm | eviction-status endpoint runs raw COUNT query via the existing singleton pgPool. |
| next | ^15.5.18 | npm | Demo's Next.js framework (unchanged from PR #24 baseline). Carries 1 MODERATE postcss CVE GHSA-qx2v-qp2m-jg93 via transitive `postcss <8.5.10` — pre-existing, allowlisted with sunset 2026-08-29 per `.claude/rules/deps-audit-allowlist.txt`. Risk confined to dev-server/build tooling, not the API surface this plan modifies. Audit trail: `.claude/knowledge-base/audits/examples-chat-with-memory-v0-4b-expansion-deps-audit-2026-05-31.md`. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| (none) | — | — | — | All work uses existing demo + monorepo deps. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Goal recap (machine-readable)

```
verb: validate
metric: /test-chat-with-memory verdict transition (last 30/30 on 2026-05-30) → READY 33/33 on 2026-05-31
gate_artifact: .claude/knowledge-base/reviews/chat-with-memory-e2e-2026-05-31-rerun.md
absolute_thresholds:
  - test_chat_scenarios_total: 33
  - test_chat_scenarios_passed: 33
  - test_chat_scenarios_failed: 0
  - dogfood_evidence_files_added: ≥ 1
  - dogfood_anchor_advancement: false  # S1 stays planned per dogfood-golden-rule rule 2
  - production_ready_vocabulary_introduced: false
deliverable_count: ≤ 7 atomic commits on develop (T0.1 audit; T1.1 + T1.2 + T1.3 demo wiring; T2.1 forget endpoints; T3.1 skill catalog; T4.1 e2e rerun; T5.1 dogfood evidence; T6.1 validation + push)
addresses_gaps_from: post-PR-#24 honest review session 2026-05-31 (3 gaps surfaced by user)
```
