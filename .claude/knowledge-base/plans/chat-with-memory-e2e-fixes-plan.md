# Plan: chat-with-memory-e2e-fixes — close the 2 demo-environment FAILs from `/test-chat-with-memory`

> **Version 1.1** — Close the 2 demo-environment FAILs surfaced by the 2026-05-30 `/test-chat-with-memory` E2E run (D4 — consolidate produces 0 clusters with real OpenAI embeddings; F3 — reflect banner doesn't fire because Next.js HMR resets in-process `writeCounts` Map). Both fixes are scoped to `examples/chat-with-memory/` — **zero changes to `src/` (the @usetheo/memory contract)**. Ships as 3 atomic commits on the same `feat/v0-6-voyager-skill-library` branch where the demo expansion lives (now committed as baseline per v1.1 absorption note).
>
> **Change log:**
> - **v1.0 (2026-05-30):** initial draft. 4 ADRs, 5 tasks across 3 phases + integration validation. Coverage Matrix 4/4.
> - **v1.1 (2026-05-30):** absorbed 2 MUST FIX from `chat-with-memory-e2e-fixes-edge-cases-2026-05-30.md`. **EC-1 (T2.1):** `CHANGELOG.md` added to T2.1 `#### Files to edit` so the Global DoD entry doesn't get missed during the halt-loop. **EC-2 (T3.1):** `rm -rf examples/chat-with-memory/.next` added as Step 1.5 of T3.1 § Tasks + Acceptance Criteria — prevents stale build cache from masking the T0.1 + T1.1 + T1.2 fixes on re-run (already-experienced footgun in the 2026-05-30 baseline session).

## Goal

> "Enable the `examples/chat-with-memory` demo to demonstrate every feature without environment artifacts blocking the consolidate + reflect surfaces, so that the next `/test-chat-with-memory` re-run reports 0 FAIL across all 30 scenarios, measured by the verdict transitioning from `NEEDS_FIXES` to `READY` in `.claude/knowledge-base/reviews/chat-with-memory-e2e-{rerun-date}.md`."

The action verb is **enable**; the named observable metric is the `/test-chat-with-memory` verdict transition (NEEDS_FIXES → READY). Single sentence.

## Context

### What exists today

The `examples/chat-with-memory/` demo was expanded in the same session that closed the v0.6.1 voyager-skill-library cycle. It now exposes 4 tabs (User / Session / Skills / History) over the 4 Scope tiers + per-repo skills + audit-trail viewer. A full `/test-chat-with-memory` exhaustive E2E run on 2026-05-30 against real `pgvector` + real OpenAI embeddings produced 28/30 PASS, 2 FAIL:

- **D4 (Group D — Skills/RepoScope)** — `POST /api/skills/consolidate` returned 200 (458ms) but `sourceClustersCount: 0`, `derivedSkillsCount: 0`, `supersededIds: []`. Two semantically-similar skill descriptions (`retry fetch with backoff` + `axios-based retry with backoff`) failed to cluster under the default `clusterThreshold = 0.85` because real `text-embedding-3-small` vectors land below that ceiling. The integration GOAL TEST `tests/integration/skills/consolidate-two-skills.test.ts` passes because it uses a `FixtureEmbedder` that forces both vectors to the same modulo-64 basis-vector bucket (cosine 1.0). With real OpenAI vectors, even highly-similar descriptions sit around 0.65-0.80 — below the default.
- **F3 (Group F — Chat round-trip)** — `theomemory-plugin.ts` uses a module-level `const writeCounts = new Map<string, number>()` to track writes-since-last-reflection per `userId`. Next.js dev-mode HMR rebuilt the module between turn 1 and turn 2 (4 `webpack.hot-update.json` requests observed mid-session), wiping the Map. Turn 2 saw `prev=0` instead of `prev=1`, so `next=1 < 2` → fired:false. Same pattern as the documented gotcha that `lib/memory.ts` already solves with `globalThis._themory_demo_singleton`.

Both fixes are **demo-environment concerns**. The @usetheo/memory contract is healthy:

- `ConsolidateOptions.clusterThreshold` (declared at `src/core/skill.ts:122-123`) is already an optional pass-through parameter with default 0.85 per ADR D4 Deep Dives of the original voyager-skill-library plan. `consolidate.ts:259` reads `options?.clusterThreshold ?? DEFAULT_CLUSTER_THRESHOLD`. So lowering the threshold for the demo is a pure consumer-side decision — no core change required.
- `ThresholdReflectionPolicy` (v0.4a) persists its counter in the `reflection_counters` Postgres table — production users wiring that policy don't have the HMR-reset issue. The demo intentionally uses `ManualReflectionPolicy` + a side-channel counter to avoid coupling to that table during quickstart.

### Evidence that triggers this work NOW

1. The 2026-05-30 E2E report `chat-with-memory-e2e-2026-05-30.md` explicitly lists D4 + F3 as the 2 FAILs and recommends "open follow-up issues for D4 (clustering threshold) and F3 (HMR-safe writeCounts) inside `examples/chat-with-memory/`, then re-run `/test-chat-with-memory` after fixes to confirm READY".
2. The demo expansion that introduced the regressions sits uncommitted in the working tree — fixing in the same series keeps the PR atomic.
3. Both root causes are pinpointed at file:line in the E2E report; no investigation required.
4. The `D4` fix is 2 lines (request body field + pass-through to `.consolidate()`); the `F3` fix is 3 lines (Map → `globalThis._themory_demo_writeCounts`).

## Objective

- [ ] T0.1 — `writeCounts` persists across Next.js HMR module reloads via `globalThis` (closes F3)
- [ ] T1.1 — `/api/skills/consolidate` accepts optional `clusterThreshold` in request body and forwards it to `memory.skills(repoId).consolidate({clusterThreshold})` (closes D4 backend)
- [ ] T1.2 — `SkillsTab` UI sends a sensible default (`0.6`) so the demo's "Consolidate" button works without configuration (closes D4 frontend)
- [ ] T2.1 — README documents both fixes + the demo's threshold choice + the production guidance ("for production use, prefer `ThresholdReflectionPolicy` over the demo's in-process counter")
- [ ] T3.1 — `/test-chat-with-memory` re-run produces verdict `READY` (30/30 PASS) in a fresh dated report

## ADRs

### D1 — Pass `clusterThreshold: 0.6` from the demo, do NOT change the core default

- **Decision:** the demo's `POST /api/skills/consolidate` route accepts `clusterThreshold` from the request body (default `0.6` if absent) and forwards it to `memory.skills(repoId).consolidate({clusterThreshold})`. The core default of `0.85` stays untouched.
- **Rationale:** Per `architecture.md § 4`, the core voyager-skill-library consolidate orchestrator is a generic primitive. The `0.85` default was calibrated for typical fixture + production embedding pairs to favor PRECISION (no false consolidations). Lowering the default would favor RECALL at the cost of precision — a global trade-off that should be opt-in per consumer, not changed silently for everyone. The demo is one consumer with a specific need (showcase clustering on natural-language descriptions with the OpenAI embedder); other consumers (TheoCode integration, production agent loops) may prefer the stricter default. Cited rules: `architecture.md § 4` (Mem0-shape architecture — defaults favor production behavior), `cycle-implement.md` Anti-pattern #7 (no scope-creep into core for a demo concern).
- **Alternatives considered:**
  - *Lower the global default in `consolidate.ts`* — Rejected. Changes production behavior for every consumer to fix a single demo scenario. Violates KISS (one consumer's tuning leaks to all) and YAGNI (production users haven't asked for it).
  - *Make the demo cheat by pre-embedding fixture vectors* — Rejected. The demo's value is showing the REAL pipeline; faking the embeddings would mislead users about real-world consolidate behavior.
  - *Just document D4 as known limitation and skip the fix* — Rejected. The Skills tab is the v0.6 flagship surface; a demo where the headline feature doesn't observably work is a worse demo.
- **Consequences:**
  - Demo's "Consolidate" button starts surfacing derived skills + `derived_from` provenance blocks with real OpenAI embeddings.
  - Future production users wiring the API directly still get the stricter 0.85 default (no surprise looser clustering).
  - The demo can expose a "Threshold" slider later if showcase-tuning becomes part of the demo's story (out of scope for v0.6.1).

### D2 — `writeCounts` migrates to `globalThis._themory_demo_writeCounts`, mirroring the memory singleton pattern

- **Decision:** `examples/chat-with-memory/lib/theomemory-plugin.ts` replaces the module-level `const writeCounts = new Map<string, number>()` with a lazy-initialized `globalThis._themory_demo_writeCounts` accessor. Same pattern, same lifecycle as `globalThis._themory_demo_singleton` already used for the Memory instance.
- **Rationale:** `lib/memory.ts` already established the `globalThis` pattern for the same reason — Next.js dev-mode HMR rebuilds modules per-route per-edit and resets module-scoped state. The fix is to lift the state above the module boundary into the Node process scope. Cited evidence: `lib/memory.ts` `declare global { var _themory_demo_singleton: ... }` block (already documented inline as "standard Next.js pattern"). Consistency wins — both pieces of demo state now use the same persistence story.
- **Alternatives considered:**
  - *Use a Postgres-backed counter via `ThresholdReflectionPolicy`* — Rejected for this plan because it would require changing the demo's `ManualReflectionPolicy` choice + wiring `bumpReflectionCounter` against pgvector, which the demo intentionally avoids during quickstart (the demo can boot in-memory). The simpler fix (HMR-safe Map) preserves both runtime paths.
  - *Persist `writeCounts` to a file under `.next/`* — Rejected. File I/O for a counter is overkill; `globalThis` is the idiomatic Next.js solution and already a project pattern.
  - *Disable HMR for the demo via `next.config.mjs`* — Rejected. HMR is a developer-experience feature; disabling it harms the demo's "edit + see changes" workflow.
- **Consequences:**
  - Reflection threshold-crossing fires deterministically per the configured `THEOMEM_REFLECTION_THRESHOLD`.
  - The blue "✨ reflect() fired" banner appears in the UI as designed.
  - Production guidance in the README points users toward `ThresholdReflectionPolicy` for cross-process counter persistence.

### D3 — Zero changes under `src/` — both fixes live in `examples/chat-with-memory/`

- **Decision:** No file under `src/core/`, `src/local/`, `src/cloud/`, `src/theokit/`, or `src/agent-tools/` is touched. All changes are scoped to `examples/chat-with-memory/lib/` + `examples/chat-with-memory/app/api/skills/consolidate/route.ts` + `examples/chat-with-memory/components/memory-tabs/skills-tab.tsx` + `examples/chat-with-memory/README.md`.
- **Rationale:** Per `cycle-implement.md` Anti-pattern #7 ("NEVER scope-creep mid-task") and the v0.6.1 cycle just closed via 14 commits, the @usetheo/memory contract is `READY_TO_MERGE` per the 2026-05-30 `/review` re-run. Introducing core changes for a demo concern would re-open that gate. Cited rule: `architecture.md § 9` (Public API surface — additive changes only, after ADR).
- **Alternatives considered:** none — the two FAILs are both reproducible purely through demo-side configuration (cluster threshold) and demo-side state management (HMR-safe Map). No core surface is implicated.
- **Consequences:**
  - The v0.6.1 `/review` verdict + every contract test stay valid; no re-validation of core required.
  - The fix lands as 3 small commits in `examples/`, easy to revert independently if a regression surfaces.
  - The plan's Integration Validation is `/test-chat-with-memory` re-run, NOT `npm test` (which already passed at b6aead6).

### D4 — Test-of-record for these fixes is `/test-chat-with-memory` re-run, not vitest

- **Decision:** No `vitest` test files are added. `vitest.contract.config.ts` and `vitest.integration.config.ts` deliberately exclude `examples/**` (verified by reading the include globs). The test contract for both fixes is the `/test-chat-with-memory` skill re-run, which exercises the demo's UI + API + DB + browser surface end-to-end.
- **Rationale:** Per `testing.md`, every non-trivial logic change needs a test — but `testing.md` also says "Tests in CI" implicitly assumes the test runner can discover the file. The demo is a Next.js app; its tests are E2E browser tests, not vitest unit tests. Adding a vitest suite for `examples/` would require expanding `tsconfig.contract.json#include` + `vitest.contract.config.ts#include` to cover `examples/**`, which would also pull demo-only deps (`next`, `react`, `@usetheo/sdk`) into the contract typecheck and lint scope — significant scope creep for a demo concern. The `/test-chat-with-memory` skill IS the integration test infrastructure for the demo, and re-running it after each fix gives the same regression-safety as a vitest suite would.
- **Alternatives considered:**
  - *Add `tests/integration/demo/` vitest suite that boots the dev server and hits APIs* — Rejected. Would require headless Chrome in CI, ~30k LoC of orchestration, and timeouts in CI matrix. The Chrome MCP path already exists via `/test-chat-with-memory`.
  - *Skip both regression tests — relying on manual eyeball after each commit* — Rejected. The skill exists explicitly to catch this regression class; we should use it.
- **Consequences:**
  - Each fix's "TDD" cycle in this plan defines RED as "re-run the corresponding scenario, observe the documented FAIL"; GREEN as "scenario PASSes after the change".
  - The Final Phase ("Integration Validation") is a full `/test-chat-with-memory` re-run, not `npm test`.

## Dependencies

This plan introduces **ZERO new dependencies** and removes **ZERO**. Per ADR D3, the entire scope is `examples/chat-with-memory/` source-code edits + README docs — no `package.json` / `package-lock.json` touch in either the root `@usetheo/memory` package OR the demo's package.

### Existing — use as-is (no version bump)

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@usetheo/memory` (workspace `file:../..`) | rc.2 | npm (demo) | Memory contract consumed by the demo; T1.1 uses `ConsolidateOptions.clusterThreshold` which is already exposed at `src/core/skill.ts:122-123` — no new surface needed. |
| `next` | ^15.5.18 | npm (demo) | Dev server hosting the demo; T0.1's `globalThis` fix is a runtime pattern, not a Next.js version dep. |
| `@usetheo/sdk` | 1.3.0 | npm (demo) | Agent harness — unchanged. |
| `pg` | ^8.13.1 | npm (demo) | pgvector connector — added in the demo-expansion baseline commit (22f148b), not by this plan. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Dependency Graph

```
Phase 0 (F3 fix) ──┐
                   ├──▶ Phase 2 (README) ──▶ Phase 3 (Integration Validation: /test-chat-with-memory re-run)
Phase 1 (D4 fix) ──┘
```

Phase 0 and Phase 1 can run in parallel (no shared files; F3 touches `lib/theomemory-plugin.ts` only; D4 touches `app/api/skills/consolidate/route.ts` + `components/memory-tabs/skills-tab.tsx` only). Phase 2 (README) reads both fixes' final state. Phase 3 (re-run) is the gate.

---

## Phase 0: F3 fix — HMR-safe writeCounts

**Objective:** Move `writeCounts` from module scope to `globalThis` so Next.js dev-mode HMR module reloads don't reset reflection-trigger state mid-session.

### T0.1 — Lift `writeCounts` into `globalThis._themory_demo_writeCounts`

#### Objective

Replace the module-level `const writeCounts = new Map<string, number>()` in `theomemory-plugin.ts` with a lazy-initialized accessor on `globalThis` that survives Next.js HMR rebuilds of the module. Adopts the same pattern `lib/memory.ts` already uses for `_themory_demo_singleton`.

#### Evidence

- E2E report 2026-05-30 § F3 documents the failure mode: "between message 1 and message 2, 4 `_next/static/webpack/*.webpack.hot-update.json` requests were observed (Next.js dev-mode HMR ... resets the module-level `const writeCounts = new Map<string, number>()` to empty"
- `examples/chat-with-memory/lib/memory.ts` already declares `declare global { var _themory_demo_singleton: ...; }` for the same Next.js-pattern reason — pre-existing in-project precedent.

#### Files to edit

```
examples/chat-with-memory/lib/theomemory-plugin.ts — replace module-level Map with globalThis accessor
```

#### Deep file dependency analysis

- `lib/theomemory-plugin.ts` is imported by `lib/agent.ts` (the `createSystemPromptResolver` factory) and by `app/api/chat/route.ts` (the `rememberTurn` function). Neither importer touches `writeCounts` directly — they only call the exported functions. Moving the Map's storage location is internal refactor; the public surface (`createSystemPromptResolver`, `rememberTurn`, `ReflectionEvent`) stays byte-identical.
- The `globalThis` pattern is documented inline in `lib/memory.ts` ("Why `globalThis`: in Next.js dev mode (`next dev`), each route handler is compiled into its own module instance with its own module-scope state. ... `globalThis` shares state across every route handler within the same Node process. Standard Next.js pattern."). T0.1 reuses verbatim the pattern.

#### Deep Dives

- **Data structure:** `Map<string, number>` — userId → writes-since-last-reflection. No change to keys/values.
- **TypeScript shape:** the `declare global { var _themory_demo_writeCounts: Map<string, number> | undefined; }` block mirrors `_themory_demo_singleton`. Both use `var` per Node's runtime requirement (TypeScript erases `let`/`const` from the global declaration scope).
- **Lazy init:** read on first access; create empty Map if undefined. Identical lifecycle semantics to the previous module-level Map — fresh process = fresh Map; subsequent HMR rebuilds of the module re-attach to the existing Map.
- **Concurrency:** Next.js dev-server is single-process single-threaded for JavaScript (Node event loop). No race-condition concerns — the `prev`/`next` read-modify-write inside `rememberTurn` runs atomically per-event-loop-tick.
- **Production note:** in `npm run build` + `npm start`, modules aren't HMR-reloaded, so the original module-level Map would have worked. The `globalThis` pattern is a no-op penalty for production (same single Map either way) and a correctness win for dev. README in T2.1 calls out that real production deployments should use `ThresholdReflectionPolicy` against pgvector anyway.

#### Tasks

1. Add `declare global { var _themory_demo_writeCounts: Map<string, number> | undefined; }` block to `lib/theomemory-plugin.ts` (same shape as the one in `lib/memory.ts`).
2. Replace `const writeCounts = new Map<string, number>();` with an accessor function `function getWriteCounts(): Map<string, number> { ... }` that lazy-inits on `globalThis._themory_demo_writeCounts`.
3. Replace the 3 in-function call sites (`writeCounts.get(...)`, `writeCounts.set(...)` twice) with `getWriteCounts().get(...)` / `getWriteCounts().set(...)`.

#### TDD

Per ADR D4 (test-of-record is `/test-chat-with-memory`), there is no vitest test file added. The regression test is the F3 scenario:

```
RED:     /test-chat-with-memory scenario F3 — after sending 2 messages with THEOMEM_REFLECTION_THRESHOLD=2, the "✨ reflect() fired" banner does NOT appear and Reflection tile shows "1/2" instead of "fired". Currently FAILS per the 2026-05-30 E2E report.
GREEN:   After T0.1 changes, re-run /test-chat-with-memory; F3 scenario passes (Reflection tile shows "fired" + banner visible AFTER message 2).
REFACTOR: None expected.
VERIFY:  /test-chat-with-memory (Phase 3 below performs the verification holistically with the rest of the suite).
```

#### Acceptance Criteria

- [ ] `lib/theomemory-plugin.ts` has no module-level `const writeCounts = ...`
- [ ] `globalThis._themory_demo_writeCounts` is the single source of truth, declared with the same shape as `_themory_demo_singleton`
- [ ] `npm run typecheck` inside `examples/chat-with-memory/` returns 0 errors
- [ ] `npm run lint` (next lint) inside `examples/chat-with-memory/` returns 0 warnings on the changed file
- [ ] File size: `lib/theomemory-plugin.ts` remains ≤ 500 LoC (well within budget — current ~115 LoC; T0.1 adds ~10 LoC for the `declare global` block + accessor)
- [ ] No public-surface change: `createSystemPromptResolver`, `rememberTurn`, `ReflectionEvent` exports unchanged
- [ ] DIP unchanged: no new imports from `@usetheo/memory` internals

#### DoD (Definition of Done)

- [ ] T0.1 changes committed atomically (one commit) on `feat/v0-6-voyager-skill-library`
- [ ] Conventional-commit message: `fix(demo)(chat-with-memory): HMR-safe writeCounts via globalThis (T0.1 / F3)`
- [ ] `npm run typecheck` + `npm run lint` zero output (run inside `examples/chat-with-memory/`)
- [ ] Verified manually: F3 scenario evidence will surface in Phase 3

---

## Phase 1: D4 fix — clusterThreshold pass-through

**Objective:** Enable the demo's "Consolidate" button to produce derived skills on naturally-similar descriptions by passing a lower `clusterThreshold` (0.6) to the existing core `ConsolidateOptions` API.

### T1.1 — Demo's consolidate route accepts + forwards `clusterThreshold`

#### Objective

`POST /api/skills/consolidate` accepts an optional `clusterThreshold` field in the request body (number in [0, 1], default 0.6 when absent) and passes it to `memory.skills(repoId).consolidate({clusterThreshold})`. The core `ConsolidateOptions.clusterThreshold` (declared at `src/core/skill.ts:122-123`) already accepts this option — no core change.

#### Evidence

- `src/core/skill.ts:121-124` declares `ConsolidateOptions.clusterThreshold?: number` with JSDoc "Embedding-cosine threshold for cluster membership. Default 0.85 per plan ADR D4 Deep Dives."
- `src/local/skills/consolidate.ts:259` already plumbs `options?.clusterThreshold ?? DEFAULT_CLUSTER_THRESHOLD` into `clusterByEmbedding(...)`.
- E2E report 2026-05-30 § D4 documents the FAIL: at default 0.85, two retry-helper skill descriptions clustered to 0 derived; lowering would bring them together.
- Cosine similarity between OpenAI `text-embedding-3-small` vectors for descriptions like `retry fetch with backoff` and `axios-based retry with backoff` typically falls in the 0.65-0.78 range (empirical — measured during prior session investigation).

#### Files to edit

```
examples/chat-with-memory/app/api/skills/consolidate/route.ts — accept optional clusterThreshold field in body; default 0.6; forward to .consolidate()
```

#### Deep file dependency analysis

- The consolidate route currently reads `body.repoId` only and calls `memory.skills(repoId).consolidate()` with no options. Adding `body.clusterThreshold` is purely additive — existing callers (UI's "Consolidate" button) still work because the field is optional with a sensible default.
- Downstream: `memory.skills(repoId).consolidate({clusterThreshold})` is fully supported by the core API (see Evidence). No further changes propagate.
- Validation: clusterThreshold MUST be a finite number in [0, 1]. Invalid values (NaN, < 0, > 1, undefined) fall back to the demo's default (0.6).

#### Deep Dives

- **Why 0.6?** Empirical: OpenAI `text-embedding-3-small` for retry-helper descriptions sits around 0.7. 0.6 leaves a safety margin so most semantically-similar skills cluster while still rejecting obviously-distinct topics (e.g., "retry fetch" vs "format JSON" — cosine well below 0.5). The README will document this choice as DEMO-specific tuning, not a production recommendation.
- **Edge case — caller passes 0:** would cluster everything together. Demo route allows it (it's a valid demo investigation: "what would consolidate look like if everything is one cluster?"). Documented in JSDoc.
- **Edge case — caller passes 1.0:** would only cluster perfectly-identical embeddings (effectively no clustering). Demo route allows it. Documented.

#### Tasks

1. Extend `ConsolidateBody` interface in `route.ts` with `clusterThreshold?: number`.
2. Validate: `typeof body.clusterThreshold === 'number' && Number.isFinite(body.clusterThreshold) && body.clusterThreshold >= 0 && body.clusterThreshold <= 1` — otherwise fall back to default.
3. Define `const DEMO_DEFAULT_CLUSTER_THRESHOLD = 0.6;` module constant (named so the rationale is visible from the call site).
4. Forward to `.consolidate({clusterThreshold: resolved})` instead of `.consolidate()`.

### T1.2 — `SkillsTab` sends the default threshold without UI churn

#### Objective

The UI's "Consolidate" button POSTs `{repoId, clusterThreshold: 0.6}` so the demo's headline showcase works out-of-the-box without exposing a slider. (A future plan can add a slider if the demo grows a tuning surface; out of scope here.)

#### Evidence

- T1.1 alone gives the route a sensible default — passing the threshold from the UI explicitly is belt-and-suspenders for the same outcome but makes the demo-tuning visible in the UI source for future readers.

#### Files to edit

```
examples/chat-with-memory/components/memory-tabs/skills-tab.tsx — handleConsolidate adds clusterThreshold: 0.6 to the POST body
```

#### Deep file dependency analysis

- `handleConsolidate` currently POSTs `JSON.stringify({ repoId })`. Adding `clusterThreshold: 0.6` is a 1-key addition.
- No new React state, no new prop, no UI element added — pure body-shape change.

#### Deep Dives

- **Why also in UI when the route has a default?** Two reasons: (1) Defense in depth — if the default in `route.ts` is ever raised back to match `core` (e.g., as part of a future "make the demo more honest" plan), the UI still sends the demo's explicit choice. (2) Future-readability — a reader of `skills-tab.tsx` immediately sees `0.6` and understands the demo tuned for showcase recall, not production precision.

#### Tasks

1. Edit `handleConsolidate` body: `JSON.stringify({ repoId, clusterThreshold: 0.6 })`.
2. Add inline comment citing the README explanation for the magic number.

#### TDD (covers BOTH T1.1 + T1.2 — they ship as a single commit)

```
RED:     /test-chat-with-memory scenario D4 — after adding 2 similar skills + clicking Consolidate, `POST /api/skills/consolidate` returns sourceClustersCount: 0 and 0 derived skills. Currently FAILS per the 2026-05-30 E2E report.
GREEN:   After T1.1+T1.2, /test-chat-with-memory scenario D4 PASSes: response shows sourceClustersCount ≥ 1, derivedSkillsCount ≥ 1, UI feedback matches "N derived skill(s) produced from M source cluster(s)" pattern, and reload shows at least one card with the orange `derived_from:` block.
REFACTOR: None expected.
VERIFY:  /test-chat-with-memory (Phase 3 below).
```

#### Acceptance Criteria

- [ ] `route.ts` validates `clusterThreshold ∈ [0, 1]` finite, otherwise falls back to `DEMO_DEFAULT_CLUSTER_THRESHOLD = 0.6`
- [ ] `route.ts` passes the resolved threshold to `.consolidate({clusterThreshold: resolved})`
- [ ] `skills-tab.tsx` `handleConsolidate` sends `{repoId, clusterThreshold: 0.6}` in body
- [ ] `npm run typecheck` zero errors (inside `examples/chat-with-memory/`)
- [ ] `npm run lint` zero warnings on the changed files
- [ ] No core file under `src/` is touched (verify via `git diff --stat src/ | wc -l == 0`)
- [ ] File sizes respected: route.ts ≤ 500 LoC (currently ~50), skills-tab.tsx ≤ 500 LoC (currently ~230)

#### DoD (Definition of Done)

- [ ] T1.1 + T1.2 commit atomically (single commit covers both files)
- [ ] Conventional-commit message: `fix(demo)(chat-with-memory): consolidate uses 0.6 cluster threshold (T1.1+T1.2 / D4)`
- [ ] `npm run typecheck` + `npm run lint` zero output

---

## Phase 2: README documentation

**Objective:** Document both fixes in `examples/chat-with-memory/README.md` so future readers understand the demo's deliberate tunings vs the production contract's defaults.

### T2.1 — README "Notes on the integration" expanded with 2 entries

#### Objective

Add 2 short notes to the existing `## Notes on the integration` section of `examples/chat-with-memory/README.md`:

1. The demo's `clusterThreshold = 0.6` (vs core default 0.85) — what, why, and the production guidance.
2. The demo's `globalThis._themory_demo_writeCounts` choice — what, why, and the production guidance pointing to `ThresholdReflectionPolicy`.

Both notes are technical-direct (DEEP DIVE per `public-copy.md § 1`) — the section is already DEEP DIVE territory.

#### Evidence

- The README's `## Notes on the integration` section already exists (added during the demo expansion); it carries 4 short bullet points. Adding 2 more is a natural extension.

#### Files to edit

```
examples/chat-with-memory/README.md — extend "Notes on the integration" with 2 bullet points
CHANGELOG.md — append entry under [Unreleased] § Changed citing the 4 commits + re-run verdict (v1.1 / EC-1 absorption — moves the changelog from Global-DoD-only to an explicit task file, closing the halt-loop-misses-DoD-checkboxes footgun)
```

#### Deep file dependency analysis

- README is consumer-facing markdown. No code dependency.
- Per `public-copy.md § 1`, the bullets sit in the DEEP DIVE section (post-`## How it works`), so technical-direct vocabulary is allowed (`clusterThreshold`, `ThresholdReflectionPolicy`, `globalThis`, `HMR`, etc.).
- No anchor narrative is touched (no "production-ready" / "production-grade" language introduced).

#### Tasks

1. Add bullet under "Notes on the integration":
   - **"Why `clusterThreshold = 0.6` in the Skills consolidate route?"** — paragraph explaining: core default is 0.85 to favor precision; demo lowers to 0.6 to make the showcase observable on natural-language descriptions with OpenAI `text-embedding-3-small`; production users should leave the default OR tune empirically against their corpus + benchmarks (not against ad-hoc demo descriptions). Cite ADR D1 from this plan.
2. Add bullet:
   - **"Why `writeCounts` lives on `globalThis`?"** — paragraph explaining: same pattern as the memory singleton; Next.js dev-mode HMR resets module-scoped Map mid-session; production deployments should prefer `ThresholdReflectionPolicy` (v0.4a) which persists the counter in the `reflection_counters` Postgres table. Cite ADR D2.

#### TDD (docs change, no automated test)

```
RED:     Reader of the existing README sees the demo Skills tab consolidate behavior + reflection threshold UI, has no explanation for the magic 0.6 OR the globalThis-tracked Map; assumes core defaults are 0.6 and writeCounts is always module-scoped.
GREEN:   After T2.1, the README explicitly anchors both choices with rationale + production guidance.
REFACTOR: None expected.
VERIFY:  Manual visual review of the README diff against ADRs D1+D2 of this plan.
```

#### Acceptance Criteria

- [ ] README contains 2 new bullet points under "Notes on the integration"
- [ ] Both bullets cite the production-guidance alternative (`ThresholdReflectionPolicy` for F3 angle; "leave the 0.85 default OR tune empirically" for D4 angle)
- [ ] No "production-ready" / "production-grade" / "v1.0 ready" tokens introduced (vocabulary lock per `public-copy.md § 2` + `dogfood-golden-rule.md`)
- [ ] No "Mem0-clone" / "wrapper around Mem0" tokens (banned alternatives per `public-copy.md § 2`)
- [ ] File size respected: README.md remains well within reading budget (currently ~210 lines; T2.1 adds ~12 lines)

#### DoD (Definition of Done)

- [ ] T2.1 committed atomically with conventional message: `docs(demo)(chat-with-memory): document clusterThreshold + writeCounts choices (T2.1)`
- [ ] Visual diff review confirms vocabulary-lock honored

---

## Phase 3 (mandatory): Integration Validation — `/test-chat-with-memory` re-run

**Objective:** Validate end-to-end that both fixes work in a real workload by re-running the same skill that surfaced the FAILs. Per ADR D4, this skill IS the test-of-record for the demo surface.

### T3.1 — `/test-chat-with-memory` re-run produces verdict READY

#### Objective

Re-run the exhaustive `/test-chat-with-memory` skill (30 scenarios across 7 groups) against the post-fix demo and produce a new dated report at `.claude/knowledge-base/reviews/chat-with-memory-e2e-{re-run-date}.md` with verdict `READY` (30/30 PASS, 0 FAIL, 0 SKIP_WITH_REASON).

#### Evidence

- Skill `/test-chat-with-memory` is fully wired (definition at `.claude/skills/test-chat-with-memory/SKILL.md` + template at `templates/report-template.md`).
- The 2026-05-30 baseline report exists; comparing the next report's scenario list against it locates D4 + F3 as the ONLY two scenarios that should change PASS state.

#### Files to edit

```
(none — re-running the skill produces a new dated report)
.claude/knowledge-base/reviews/chat-with-memory-e2e-{re-run-date}.md  (NEW from the skill re-run)
```

#### Deep file dependency analysis

- The re-run will spawn a fresh background dev server (T0.1 + T1.1 + T1.2 applied), open Chrome MCP, and walk all 30 scenarios.
- Cleanup at the end of the re-run truncates the DB so subsequent runs start clean.

#### Deep Dives

- **Acceptance threshold:** `verdict == "READY"` (30/30 PASS). Anything less is a STOP — loop back to whichever phase regressed.
- **Acceptable variance:** If D4 still produces only 1 derived skill (instead of "≥ 1"), it's a PASS — the pass criterion is `derivedSkillsCount: ≥ 1`. If D4 produces 0 even after threshold drop, root-cause via console logs + actual cosine similarity measurement; may indicate the 0.6 threshold is still too strict (consider 0.55 or 0.50 in a v1.1 of this plan).
- **F3 expected outcome:** Reflection tile shows "fired" + blue banner appears AFTER message 2; subsequent message resets the counter to 1.

#### Tasks

1. Verify pre-conditions: working tree has T0.1 + T1.1 + T1.2 + T2.1 committed; pgvector container up; port 3000 free; node_modules intact; Node 22 via nvm in PATH.
1.5. **Purge stale Next.js build cache** (v1.1 / EC-2 absorption — prevents `.next/` artifacts from earlier `next dev` runs masking the T0.1 + T1.1 fixes; observed footgun in the 2026-05-30 baseline session):
     ```
     pkill -f "next dev" 2>/dev/null || true
     find examples/chat-with-memory/.next -mindepth 1 -delete 2>&1 || true
     ```
2. Invoke `/test-chat-with-memory`.
3. Read the resulting report; confirm `verdict: READY`.
4. If verdict is anything else, identify which scenario regressed and loop back.

#### TDD

```
RED:     Pre-fix baseline (2026-05-30 report) = NEEDS_FIXES, 28/30 PASS, D4 + F3 FAIL.
GREEN:   Post-fix re-run produces a fresh dated report with verdict: READY, 30/30 PASS.
REFACTOR: None.
VERIFY:  Compare {re-run-date} report's "Verdict" section + Group D/F tables against the 2026-05-30 baseline.
```

#### Acceptance Criteria

- [ ] New report at `.claude/knowledge-base/reviews/chat-with-memory-e2e-{re-run-date}.md` exists
- [ ] Report's `## Verdict` section reads `**READY**`
- [ ] Group D table: D1-D6 ALL show "PASS" (specifically D4 transitions FAIL → PASS)
- [ ] Group F table: F1-F4 ALL show "PASS" (specifically F3 transitions FAIL → PASS)
- [ ] No new FAILs introduced in other groups (A, B, C, E, G remain 100%)
- [ ] Console errors at most 4 (same intentional 4xx as baseline — D3 409, D6/G4 404, G2 400, G3 400)
- [ ] Cleanup confirmed: port 3000 free post-run, DB truncated, pid file removed
- [ ] **(v1.1 / EC-2)** `.next/` purged before the re-run (verified via the Step 1.5 pkill + find -delete in § Tasks)

#### DoD (Definition of Done)

- [ ] T3.1 produces the fresh report
- [ ] Report committed atomically: `docs(audit)(chat-with-memory): /test-chat-with-memory re-run READY (T3.1)`

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | D4 FAIL — consolidate produces 0 clusters with real OpenAI embeddings | T1.1 + T1.2 | Demo passes `clusterThreshold: 0.6` (vs core default 0.85) without core change |
| 2 | F3 FAIL — reflect banner doesn't fire due to HMR-reset writeCounts | T0.1 | `writeCounts` lifted to `globalThis._themory_demo_writeCounts`, mirroring the existing `_themory_demo_singleton` pattern |
| 3 | Documentation gap — magic numbers in the demo without rationale | T2.1 | README "Notes on the integration" extended with 2 bullets citing ADRs D1 + D2 |
| 4 | Validation gap — no automated regression-safety on demo behavior | T3.1 | `/test-chat-with-memory` re-run is the test-of-record per ADR D4 |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] All 3 phases (Phase 0 + Phase 1 + Phase 2) complete + Phase 3 re-run produces verdict `READY`
- [ ] No file under `src/` modified (verify with `git diff --stat src/ | wc -l == 0`)
- [ ] `npm test` from repo root still produces 490 passed (baseline at b6aead6 — no contract test regression possible since no core file touched)
- [ ] `npm run typecheck` from repo root: 0 errors
- [ ] `npm run lint` from repo root: 0 warnings
- [ ] `npm run typecheck` inside `examples/chat-with-memory/`: 0 errors
- [ ] `npm run lint` inside `examples/chat-with-memory/`: 0 warnings
- [ ] File size budget respected per `.claude/rules/architecture.md § Module hygiene` (default 500 LoC; all changed files well within budget)
- [ ] CHANGELOG.md updated under `[Unreleased]` § Changed with a "v0.6.1 demo expansion E2E fixes" entry citing the 4 commits + the re-run verdict
- [ ] Backward compatibility preserved across public API of `@usetheo/memory` (no change to `src/index.ts` exports, subpath exports, or any `src/` file)
- [ ] No "production-ready" / "production-grade" / "v1.0 ready" tokens introduced anywhere (vocabulary lock per `public-copy.md § 2` + `dogfood-golden-rule.md`)
- [ ] No `Co-Authored-By:` trailer in commits (project policy per session memory `no_coauthored_by_in_commits.md`)
- [ ] **Plan archived** — after `/test-chat-with-memory` re-run confirms verdict `READY` AND the working-tree demo commits are merged to `main`, move `.claude/knowledge-base/plans/chat-with-memory-e2e-fixes-plan.md` to `.claude/knowledge-base/plans/completed/`. NEVER move during the in-flight implementation.

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER Phase 0 + Phase 1 + Phase 2 are complete. The plan is NOT done until the integration validation chain passes.

**Objective:** Validate the fixes work in a real workload using the same exhaustive E2E skill that surfaced the FAILs.

### Execution

```
# Verify baseline contract tests still green (no src/ touched, so these MUST pass unchanged):
npm test
npm run typecheck
npm run lint

# Verify demo-side typecheck + lint:
cd examples/chat-with-memory
npm run typecheck
npm run lint
cd ../..

# The actual gate — re-run the E2E skill that produced the baseline FAILs:
/test-chat-with-memory
```

### Acceptance Criteria

- [ ] All baseline contract test suites green (`npm test` 490 passed + 2 skipped, same as b6aead6)
- [ ] Demo-side `npm run typecheck` + `npm run lint` zero output
- [ ] `/test-chat-with-memory` re-run produces `verdict: READY` (30/30 PASS)
- [ ] D4 scenario reads PASS in the new report
- [ ] F3 scenario reads PASS in the new report
- [ ] No new FAILs introduced
- [ ] No `production-ready` / `production-grade` claim introduced

### If Validation Fails

1. Identify which scenario regressed
2. Loop back to the phase that owns the regressed scenario (Phase 0 owns F3; Phase 1 owns D4; Phase 2 owns README claims; Phase 3 owns the re-run mechanics)
3. Fix + re-run `/test-chat-with-memory` until verdict transitions to READY
4. NEVER declare the plan complete with FAILs remaining — per `cycle-implement.md` anti-pattern #2 ("NEVER mark a task `done` if its tests are skipped, commented, or red")
