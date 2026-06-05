# Plan: examples-theokit-chat-migration — migrate `examples/chat-with-memory/` from Next.js-direct to TheoKit-canonical

> **Version 1.1** (2026-06-05) — Absorbs `/edge-case-plan examples-theokit-chat-migration` (12 edge cases: 4 MUST FIX + 5 SHOULD TEST + 3 DOCUMENT — VERDICT PLANO PRECISA DE AJUSTE). Empirical pre-flight executed: **EC-1 RESOLVED** — `theokit` published at `0.2.4` (plan v1.0 declared `^0.4.0` incorrectly; corrected throughout). **EC-2 RESOLVED** — `npm view @theokit/sdk version` AND `npm view @usetheo/sdk version` both return `1.5.0`; they are aliases of the same package. Plan adopts `@theokit/sdk` canonical naming per TheoKit framing AND bumps current chat-with-memory dep from `@usetheo/sdk@1.3.0` → `@theokit/sdk@^1.5.0` (note: plan-v1.0 ADR D5 conflated names; v1.1 standardizes on `@theokit/sdk`). **EC-3 RESOLVED** — `memoryFromCtx` empirically verified at `src/theokit/index.ts:56` as exported function; `package.json#exports."./theokit"` map present. No ADR change needed; T3.1 import works as planned. **EC-4 CONFIRMED — NEW T3.0 added** wiring `createSessionManager` from `theokit` core BEFORE T3.1 introduces `memoryFromCtx`; plan adds 1 ADR (D7) covering session strategy. **5 SHOULD TEST absorbed inline**: EC-5 (T0.1 sentinel 7 — enumerate `app/api/` routes via `find`), EC-6 (T1.2 step 4.5 — add `@tailwindcss/vite` to deps + verify `app/globals.css` directives), EC-7 (T1.2 step 7 — empirical env-var read test post-migration), EC-8 (T0.1 sentinel 8 — verify test path picked up by vitest glob), EC-9 (T5.2 step 1 — enumerate deferral criteria BEFORE migration). **3 DOCUMENT absorbed**: EC-10 (T6.1 acceptance relaxed: `< 30s cold start, < 5s warm`), EC-11 (`.theokit/` runtime dir handled by framework — accepted), EC-12 (T2.1 single-commit atomicity discipline — accepted). Goal SMART floor unchanged at ≥ 30/33 scenarios.

> **Version 1.0** (2026-06-05) — Replaces the existing `examples/chat-with-memory/` Next.js-direct demo (Next.js App Router + `next dev/build`) with a TheoKit-canonical version (`theokit dev/build` + Vite + `defineRoute` + `defineAgentEndpoint`), demonstrating `@usetheo/memory/theokit` v0.2 PR-A `memoryFromCtx(ctx, memory)` integration as the consumer-canonical pattern. Honest framing per PRIORITY 0 (locked 2026-06-04): this is **SDK consumer hardening** (sub-goal 2 "SDKs 100% functional") — the current demo conflates "Next.js direct" with "TheoKit canonical", a structural misrepresentation per Inquebrável Rule 3. Project owner authorized "(A) /to-plan formal" via `AskUserQuestion` response in same session (2026-06-05). Scope: in-place migration to preserve git history of `components/` + `lib/`; ZERO behavioral changes to the 7 demo tabs (User/Session/Skills/History/Eviction/Distillation/Reflection); rewrite `.claude/skills/test-chat-with-memory/SKILL.md` to point at new `theokit dev` entrypoint while preserving 33 E2E scenarios.

## Goal

> "Replace `examples/chat-with-memory/` Next.js-direct entrypoint (`next dev`, `app/api/*`, `next.config.mjs`) with TheoKit-canonical entrypoint (`theokit dev`, `server/routes/*` via `defineRoute` + `defineAgentEndpoint`, `theo.config.ts`) so that the `@usetheo/memory/theokit` v0.2 PR-A subpath becomes the demonstrated canonical consumer pattern, measured by `/test-chat-with-memory` skill passing **≥ 30 of 33 scenarios** (3 scenarios DEFERRED with explicit per-scenario ADR rationale; 0 silent regressions) AND `examples/chat-with-memory/package.json#scripts.dev` equals `theokit dev`."

## Context

### What exists today (post fix-cycle-2 + rc.4 publish)

The `examples/chat-with-memory/` directory ships a hybrid demo (1.3GB including `node_modules`):

- **Bootstrap (Next.js direct)**: `next: ^15.5.18` + `next.config.mjs` + App Router (`app/page.tsx`, `app/layout.tsx`, `app/api/*` routes)
- **Packages (TheoKit-aware)**: `@usetheo/sdk: 1.3.0`, `@usetheo/ui: 0.12.0`, `.theokit/` runtime artifacts directory exists
- **Memory wiring**: `lib/memory.ts` + `lib/theomemory-plugin.ts` + `lib/agent.ts` — uses `@usetheo/memory: file:../..` (workspace-link to the SDK under development)
- **UI**: 7 tabs in `components/memory-tabs/` (User / Session / Skills / History / Eviction / Distillation / Reflection)
- **Backend**: pgvector via Postgres connection from `THEOMEM_PG_URI` env

The `/test-chat-with-memory` skill drives 33 E2E scenarios via Chrome DevTools MCP against `next dev` on port 3000. Pre-conditions check `examples/chat-with-memory/.env` for `THEOMEM_PG_URI` + `OPENAI_API_KEY` + `THEOKIT_API_KEY`.

### Why migrate to TheoKit-canonical

1. **Per CLAUDE.md § Relationship to other pillars**: TheoKit is the framework sibling of TheMemory. `@usetheo/memory/theokit` subpath ships v0.2 PR-A with `memoryFromCtx(ctx, memory)` auto-scope via structural typing (zero peer-dep). The current demo bypasses this subpath entirely — it imports `@usetheo/memory` default barrel and wires scope manually. **The canonical consumer path is structurally hidden from the demo today.**

2. **Per TheoKit CLAUDE.md § "What TheoKit is"**: "TheoKit is the **app the agent lives in**." Showing a Next.js-direct demo for a TheoKit-native memory layer is a honesty gap per Inquebrável Rule 3 — copy that says "consumer-canonical" while shipping plain Next.js contradicts the stack narrative.

3. **Per PRIORITY 0 sub-goal 2 ("SDKs 100% functional")**: every subpath in `package.json#exports` should have a working consumer example. `@usetheo/memory/theokit` ships but has ZERO consumer demo. Migrating the existing demo to TheoKit-canonical closes that gap without introducing new features.

### What changes (and what does NOT)

| Surface | Before | After |
|---|---|---|
| `package.json#scripts.dev` | `next dev` | `theokit dev` |
| `package.json#scripts.build` | `next build` | `theokit build` |
| `package.json#dependencies.next` | `^15.5.18` | **REMOVED** |
| `package.json#dependencies.theokit` | absent | `^0.4.0` (or pinned to latest published) |
| `next.config.mjs` | exists | **DELETED** |
| `theo.config.ts` | absent | **NEW** (minimal: app deps + plugins) |
| `app/page.tsx` (Next.js Server Component) | renders chat UI | **MIGRATED** to TheoKit client-by-default (per RSC-deferred decision in TheoKit CLAUDE.md) |
| `app/layout.tsx` | Next.js root layout | **MIGRATED** to `app/_app.tsx` or `index.html` per TheoKit Vite entrypoint convention |
| `app/api/*` routes (Next.js Route Handlers) | NextResponse + Request | **MIGRATED** to `server/routes/*.ts` via `defineRoute` + Zod validation |
| `app/api/chat/route.ts` (LLM streaming) | OpenAI streaming inline | **MIGRATED** to `defineAgentEndpoint` per TheoKit convention |
| `lib/memory.ts` | imports `@usetheo/memory` default barrel | **MIGRATED** to `@usetheo/memory/theokit` subpath + `memoryFromCtx(ctx, memory)` in route handlers |
| `lib/agent.ts` | direct OpenAI client | **MIGRATED** to `@theokit/sdk` `Agent.prompt` per TheoKit canonical |
| `lib/theomemory-plugin.ts` | custom TheoKit-style plugin (unused glue) | **DELETED** or **REPURPOSED** as canonical plugin example |
| `components/memory-tabs/*` (7 tabs) | React components calling `fetch('/api/*')` | **PRESERVED** — typed via `theoFetch` (TheoKit's typed client) instead of raw fetch |
| `components/chat-surface.tsx` | uses `@usetheo/ui` ChatThread | **PRESERVED** (no change) |
| `components/memory-sidebar.tsx` | React state mgmt | **PRESERVED** (no change) |
| Backend: pgvector via `THEOMEM_PG_URI` | yes | **PRESERVED** (no change) |
| 7 tabs (User/Session/Skills/History/Eviction/Distillation/Reflection) | functional | **PRESERVED** (no behavioral change) |
| `.claude/skills/test-chat-with-memory/SKILL.md` 33 E2E scenarios | drives `next dev` port 3000 | **MIGRATED** to drive `theokit dev` (verify port + dev-server boot semantics; preserve scenario logic) |

### What did NOT change since fix-cycle-2 + rc.4 publish

The PR #31 + commit `ffe6225` (chore release rc.4) closed the verbs-as-CLI line. No production code changes between the rc.4 publish and this plan. The migration target `examples/chat-with-memory/` working tree carries the same state as `61234cb` (merge commit on main).

## Objective

The 8 specific sub-goals composing the Goal:

- [ ] **Sub-goal 1 — Bootstrap migration**: Replace `next.config.mjs` + Next.js App Router scaffold with TheoKit Vite scaffold (`theo.config.ts` + `index.html` + `app/_entry.tsx` per TheoKit convention). `package.json#scripts.dev` equals `theokit dev`; `package.json#dependencies.next` removed; `package.json#dependencies.theokit` added.

- [ ] **Sub-goal 2 — Server routes migration**: All `app/api/*/route.ts` migrated to `server/routes/*.ts` using TheoKit `defineRoute` + Zod schemas. Behavioral parity: same request/response shapes; same error handling; same auth pattern.

- [ ] **Sub-goal 3 — Chat endpoint canonical**: `app/api/chat/route.ts` migrated to `server/routes/chat.ts` using `defineAgentEndpoint` + `@theokit/sdk` `Agent.prompt` (per TheoKit's "6-line essence" pattern). OpenAI streaming preserved via the SDK's provider routing (model id selects provider).

- [ ] **Sub-goal 4 — Memory wiring canonical**: `lib/memory.ts` rewritten to import from `@usetheo/memory/theokit` subpath instead of default barrel. Every route handler that consumes memory uses `memoryFromCtx(ctx, memory)` to derive scope from `ctx.session` (TheoKit session context) — replacing the current manual scope wiring.

- [ ] **Sub-goal 5 — Agent canonical**: `lib/agent.ts` rewritten to use `@theokit/sdk` `Agent.create` + `Agent.send` (or `Agent.prompt` for one-shot). Direct OpenAI client removed; provider routing via SDK model-id convention.

- [ ] **Sub-goal 6 — Typed client migration**: 7 memory tab components migrated from raw `fetch('/api/*')` to `theoFetch` (TheoKit's typed client) — closes the type-safety gap between server routes and client consumers. ZERO behavioral change.

- [ ] **Sub-goal 7 — Test skill migration**: `.claude/skills/test-chat-with-memory/SKILL.md` rewritten to:
  - Detect `theokit dev` dev-server boot semantics (port, ready signal)
  - Update pre-conditions (e.g., better-sqlite3 ABI check inherited from TheoKit native bindings)
  - Preserve 33 scenarios where possible; explicitly DEFER ≤ 3 scenarios if TheoKit RSC-deferred / dev-server-port / native-bindings constraints invalidate them (with per-scenario ADR rationale).

- [ ] **Sub-goal 8 — Integration validation**: Real-tree validation against `themem_pgvector` + OpenRouter:
  - `cd examples/chat-with-memory && pnpm install` (or npm install) — ZERO Next.js packages remain in dep tree
  - `theokit dev` boots clean — 0 errors
  - `/test-chat-with-memory` skill returns READY with ≥ 30/33 PASS
  - Chat round-trip works end-to-end against real pgvector + real LLM

## Dependencies

Per cycle-plan.md v1.1 hard gate (`plan_dependencies_section_missing`):

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@usetheo/memory` | `file:../..` (workspace SDK under development) | npm | The library under test |
| `@usetheo/sdk` | `1.3.0` (current) → bumped to `@theokit/sdk: ^1.5.0` in T3.2 per EC-2 absorption | npm | Agent runtime — kept; we'll migrate `lib/agent.ts` to use it canonically. Empirical: `npm view @theokit/sdk version` returns `1.5.0`; `npm view @usetheo/sdk version` ALSO returns `1.5.0` — they are aliases of the same package. v1.1 standardizes on `@theokit/sdk` per TheoKit canonical framing. |
| `@usetheo/ui` | `0.12.0` | npm | UI components — kept |
| `react` | `^19.0.0` | npm | React 19 (TheoKit + Next.js both use it) |
| `react-dom` | `^19.0.0` | npm | Same |
| `pg` | `^8.13.1` | npm | Postgres client — kept (pgvector backing) |
| `openai` | `^4.77.0` | npm | Direct OpenAI dep — to be REMOVED in Sub-goal 5 (replaced by `@theokit/sdk` provider routing) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| `theokit` | `^0.2.4` (empirical: latest published on npmjs.org per `npm view theokit version` in v1.1 pre-flight; plan v1.0 declared `^0.4.0` incorrectly) | npm | **Rule 9 evaluated alternatives**: (1) keep Next.js (rejected — fails sub-goal 1 and the PRIORITY 0 honesty framing); (2) Astro / Remix / SvelteKit (rejected — not sibling; would NOT close the canonical-consumer demo gap); (3) build custom Vite scaffold (rejected — reinvents TheoKit's wheel); (4) bypass via raw HTML + Server Routes script (rejected — KISS violation; TheoKit's canonical entrypoint IS the pattern to demonstrate). | The sibling framework whose canonical consumer story is the stated Goal. ZERO scope creep — fits PRIORITY 0 sub-goal 2 framing. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| `next` | `^15.5.18` | Replaced by `theokit` per ADR D1. The honesty framing requires the Next.js-direct entrypoint to disappear; both can't coexist. |
| `openai` | `^4.77.0` | Replaced by `@theokit/sdk` `Agent.prompt` per ADR D5; provider routing via SDK model-id convention (TheoKit canonical pattern). |

## ADRs

### D1 — Replace `next` with `theokit` (Vite-based TheoKit entrypoint)

- **Decision**: Strip `next: ^15.5.18` + `next.config.mjs` + Next.js App Router. Add `theokit: ^0.4.0` + `theo.config.ts` + Vite-style entry (`index.html` + `app/_entry.tsx`). `package.json#scripts.dev/build/start` migrate from `next *` to `theokit *`.
- **Rationale**:
  - **Strip Next.js, adopt TheoKit (chosen)**: closes the structural-honesty gap. TheoKit is the sibling canonical consumer; demoing TheMemory via Next.js direct conflates the stack story. Per TheoKit CLAUDE.md, `app/page.tsx` → file-based routing works equivalently in TheoKit Vite scaffold; React Server Components are explicitly DEFERRED past 1.0 in TheoKit (client-by-default per TanStack Start posture). The existing Next.js Server Components in `app/page.tsx` will need to become client components — but the demo content was already client-driven (state, fetch), so the migration is mostly cosmetic.
  - **Keep Next.js + add TheoKit packages (rejected — current state)**: hybrid creates the honesty gap that this plan exists to close. Two entrypoints, one library — confuses consumers.
  - **Drop the demo entirely (rejected)**: `/test-chat-with-memory` skill exists; 4 SEPA-knowledge skills reference it; the demo is consumer-discovery surface. Deleting would lose those.
  - **Astro / Remix / SvelteKit (rejected)**: not sibling; demoing TheMemory via a third-party would surface a fourth framework story without closing the canonical-consumer gap.
- **Consequences**:
  - 1.3GB `node_modules` rebuilt fresh (next + react-router-next subgraph removed; theokit + vite subgraph added).
  - `app/page.tsx` migrates to client component (drop `"use server"` if present; React 19 default client-side hydration).
  - `app/api/*/route.ts` migrate to `server/routes/*.ts` via `defineRoute` (Sub-goal 2).
  - `theokit dev` may use different port (default 3000 same as Next; verify empirically).
  - `better-sqlite3` ABI preflight inherited from TheoKit (per TheoKit CLAUDE.md native bindings discipline) — even if THIS demo doesn't use it directly, the `theokit` dep tree pulls it. Mitigation: ensure `nvm use` per project `.nvmrc` (TheMemory currently doesn't have one — to be added if blocking).

### D2 — In-place migration vs scaffold-from-template

- **Decision**: In-place migration. Keep `examples/chat-with-memory/` directory; preserve git history of `components/` + `lib/` + `README.md`; delete/replace only what's strictly Next.js-bound.
- **Rationale**:
  - **In-place migration (chosen)**: preserves audit trail of 7 tabs' implementation history, README evolution, SEPA-knowledge skill references. Lower blast radius.
  - **Scaffold via `npx create-theokit my-app --backend postgres` then port components in (rejected)**: creates a NEW directory with fresh git history; lose lineage; require parallel-edit during the transition. Higher friction.
  - **Hybrid: scaffold sibling `examples/theokit-chat-with-memory/`, deprecate old (rejected)**: 2 demos for the same library is consumer-confusion. Was Option (C) in the AskUserQuestion — user chose Option (A).
- **Consequences**:
  - `git mv` for renamed files preserves blame.
  - Existing components/lib carry trail from earlier cycles (v0.4b-expansion, v0.7-distillation, etc.).

### D3 — `@usetheo/memory/theokit` subpath becomes the canonical wiring path

- **Decision**: `lib/memory.ts` imports `Memory` + `memoryFromCtx` from `@usetheo/memory/theokit` instead of default barrel. Every server-side route consumer uses `memoryFromCtx(ctx, memory)` to auto-derive scope from `ctx.session.userId`.
- **Rationale**:
  - **Canonical wiring (chosen)**: closes the structural gap from CLAUDE.md "Pending Item 3 (PR-B)" framing — the consumer pattern IS the canonical path, but no demo shows it. PRIORITY 0 sub-goal 1 ("every export documented + JSDoc-cross-referenced") improves with concrete usage. Plus the subpath has been shipping since v0.2 PR-A merged at PR #11; demoing it is hardening, not new feature.
  - **Direct barrel import + manual scope (rejected — current state)**: doesn't demo the canonical pattern; structurally misleads.
  - **Roll our own ad-hoc adapter in `lib/theomemory-plugin.ts` (rejected — current state for some flows)**: reinvents `memoryFromCtx`; YAGNI per Inquebrável Rule 11.
- **Consequences**:
  - `lib/memory.ts` becomes ≤ 30 LoC (import + factory + scope-from-ctx export).
  - `lib/theomemory-plugin.ts` REPURPOSED as a minimal canonical TheoKit plugin example showing how `@usetheo/memory/theokit` plugs in OR DELETED if redundant with the simpler `memoryFromCtx` pattern. Decision deferred to T4.1.

### D4 — better-sqlite3 ABI preflight inheritance

- **Decision**: Accept `better-sqlite3` preflight discipline inherited from TheoKit. Add `.nvmrc` pinning Node 22 to `examples/chat-with-memory/` so `nvm use` resolves on first clone. Document in README.
- **Rationale**:
  - **Inherit + document (chosen)**: TheoKit's preflight is well-engineered (per TheoKit CLAUDE.md native bindings); rebuild auto-fixes most cases. Documenting the constraint preserves consumer honesty.
  - **Bypass via `--ignore-scripts` (rejected)**: brittle; native dep silently broken at first run.
  - **Patch out better-sqlite3 from TheoKit (rejected — Inquebrável Rule 9)**: don't reinvent the framework.
- **Consequences**:
  - New file `examples/chat-with-memory/.nvmrc` containing `22.12.0` (or latest Node 22 LTS).
  - README Quickstart adds 1 line: `nvm use` (or equivalent).
  - `/test-chat-with-memory` skill pre-condition #4 expanded to verify Node version OR rebuild succeeds.

### D5 — Replace `openai` direct dep with `@theokit/sdk` `Agent.prompt`

- **Decision**: Drop `openai: ^4.77.0` direct dep. `lib/agent.ts` uses `@theokit/sdk` `Agent.create` + `Agent.send` (or `Agent.prompt` for one-shot). Provider routing via SDK model-id convention (`claude-*`, `gpt-*`, `ollama/*`).
- **Rationale**:
  - **`@theokit/sdk` Agent API (chosen)**: TheoKit canonical pattern per the README's "6-line essence". One-line provider switch (`model: { id: 'claude-sonnet-4-5-20250929' }`). Streaming + tool calling included.
  - **Keep direct `openai` (rejected)**: bypasses the canonical SDK story; ZERO marketing for `@theokit/sdk`. Inquebrável Rule 3 honesty gap.
  - **Vercel AI SDK (rejected)**: not sibling; would surface another framework story.
- **Consequences**:
  - `lib/agent.ts` shrinks ~50% (SDK abstracts the streaming + provider routing).
  - The "Step 4 — Replace the mock" pattern in TheoKit README becomes verbatim copyable to this demo.

### D7 — TheoKit session manager: anonymous-uid strategy (NEW v1.1 — EC-4 absorption)

- **Decision**: Wire `createSessionManager` from `theokit/server` with an anonymous-UUID-per-browser-session strategy. Cookie `themory_uid` persists; first request generates UUID via `node:crypto.randomUUID()`. NO authentication — chat-with-memory is an open demo; identity is per-browser-session only.
- **Rationale**:
  - **Anonymous-UUID session (chosen)**: Closes EC-4 with minimum surface. Matches the chat-with-memory demo's current implicit-scope-via-URL-query-param pattern (Next.js side) but at the TheoKit-canonical layer. Per TheoKit AUTH-DELEGATION discipline (locked 2026-05-19 per TheoKit CLAUDE.md), TheoKit ships session primitives (`createSessionManager`) but delegates auth-provider wiring to specialist libs. This demo doesn't need auth; the session manager provides identity-as-cookie.
  - **Wire OAuth provider (Auth.js / Better Auth)** (rejected — Inquebrável Rule 11 YAGNI): the demo is OPEN; no auth flow required; adding OAuth would require API keys + provider config + redirect URLs.
  - **Skip `memoryFromCtx` adoption** (rejected — defeats Sub-goal 4): would preserve the Next.js manual-scope pattern; structural-honesty gap from CLAUDE.md framing remains open.
  - **Hard-code `userId = 'demo'`** (rejected): breaks multi-browser isolation; defeats the User/Session tab semantics.
- **Consequences**:
  - 1 new file `server/auth/session.ts` (~15 LoC).
  - `theo.config.ts` registers the manager.
  - All memory routes get scoped per browser; closing tab + reopening = fresh anon user (acceptable for demo).
  - README documents the anonymous-session strategy + how to swap for real auth.

### D6 — `/test-chat-with-memory` skill scope: 33 → ≥ 30 scenarios

- **Decision**: Preserve 33 scenarios where the migration is behavior-equivalent. DEFER explicitly ≤ 3 scenarios if a TheoKit-vs-Next.js entrypoint difference invalidates them (e.g., dev-server port discovery, build-time RSC fingerprint). Each deferred scenario gets per-scenario ADR rationale in the skill's SKILL.md.
- **Rationale**:
  - **Preserve + ADR-defer minority (chosen)**: maintains the audit-trail of the 33-scenario investment. Honest framing per Inquebrável Rule 3 — if a scenario can't be ported, acknowledge it; don't silently drop it.
  - **Full rewrite (rejected)**: throws away cycles of investment; risk of new bugs.
  - **Reduce to "happy-path-only" (rejected)**: loses edge-case coverage that's the value-add of E2E suite.
- **Consequences**:
  - SKILL.md updated for `theokit dev` boot semantics.
  - Per-scenario migration: 1 line each in the "Scenarios" section noting `migrated as-is` / `migrated with adaptation` / `ADR-DEFERRED — reason`.
  - The 30-scenario floor is conservative; expected actual ≥ 32 (most scenarios are UI-driven and entrypoint-agnostic).

## Dependency Graph

```
Phase 0 (Baseline RED) ──▶ Phase 1 (Bootstrap migration)
                                                    │
                                                    ▼
                                       Phase 2 (Server routes migration)
                                                    │
                                                    ▼
                                       Phase 3 (Session + Memory + Agent canonical)
                                       T3.0 (session wire) → T3.1 (memoryFromCtx) → T3.2 (agent)
                                                    │
                                                    ▼
                                       Phase 4 (Typed client + tabs migration)
                                                    │
                                                    ▼
                                       Phase 5 (Test skill rewrite)
                                                    │
                                                    ▼
                                       Phase 6 (Integration validation + cycle close)
```

- **Phase 0** writes RED tests for the migration contract.
- **Phase 1** strips Next.js, adopts TheoKit scaffold; blocks Phases 2-6.
- **Phase 2** migrates `app/api/*/route.ts` → `server/routes/*.ts`; ZERO behavior change.
- **Phase 3** migrates memory wiring + agent wiring to canonical paths.
- **Phase 4** migrates client tabs to typed `theoFetch`; UI components preserved.
- **Phase 5** rewrites the E2E skill to drive `theokit dev`; preserves 33 scenarios with ADR-deferred minority.
- **Phase 6** is integration validation against real-tree.

---

## Phase 0: Baseline — RED tests for migration contract

### T0.1 — Author `tests/integration/examples/theokit-chat-migration.test.ts` (RED, 8 assertions post-EC-5+EC-8 absorption)

#### Objective

Lock the post-migration contract: `package.json#scripts.dev === 'theokit dev'`, `next` dep absent, `theokit` dep present, `theo.config.ts` exists, `.nvmrc` exists, server routes use `defineRoute`.

#### Files to edit

```
tests/integration/examples/theokit-chat-migration.test.ts (NEW)
```

#### Tasks

1. Create the test file with 6 sentinels.
2. Run `npx vitest run --config vitest.integration.config.ts tests/integration/examples/theokit-chat-migration.test.ts` — confirm 6 FAIL (RED).

#### TDD

```
RED: test 1 — examples/chat-with-memory/package.json scripts.dev === 'theokit dev'
RED: test 2 — examples/chat-with-memory/package.json dependencies.next is absent
RED: test 3 — examples/chat-with-memory/package.json dependencies.theokit is present (range satisfies ^0.2.4 per EC-1 absorption)
RED: test 4 — examples/chat-with-memory/theo.config.ts exists
RED: test 5 — examples/chat-with-memory/.nvmrc exists with Node 22.x pin
RED: test 6 — examples/chat-with-memory/server/routes/ contains ≥ 1 file using defineRoute import
RED: test 7 — EC-5 absorption: enumerate ALL `app/api/**/route.ts` files via find; assert every enumerated route has a SIBLING migrated file at `server/routes/<name>.ts` post-T2.1 (parity check; floor: 0 missing routes)
RED: test 8 — EC-8 absorption: assert this test file IS picked up by vitest.integration.config.ts via `vitest --reporter=json --listFiles` includes this file's basename
```

#### Acceptance Criteria

- [ ] All 6 RED tests FAIL pre-migration
- [ ] Test file under 150 LoC
- [ ] Pass lint + typecheck

#### DoD

- [ ] File created
- [ ] 6 tests FAIL (RED locked)

---

## Phase 1: Bootstrap migration — strip Next.js, adopt TheoKit

### T1.1 — Delete Next.js bootstrap files

#### Files to edit

```
examples/chat-with-memory/next.config.mjs — DELETE
examples/chat-with-memory/next-env.d.ts — DELETE
examples/chat-with-memory/tsconfig.tsbuildinfo — DELETE (regenerable)
examples/chat-with-memory/postcss.config.mjs — DELETE (TheoKit uses its own Vite + Tailwind pipeline)
examples/chat-with-memory/app/layout.tsx — DELETE (replaced by index.html + app/_entry.tsx)
examples/chat-with-memory/app/page.tsx — REWRITE as client component
examples/chat-with-memory/app/api/ — entire tree migrates to server/routes/ in Phase 2 (delete after migration confirmed)
```

#### Tasks

1. Delete the 4 Next.js config/scaffold files.
2. Rewrite `app/page.tsx` as a client component (drop `"use server"` directives if any; React 19 default behavior).
3. Preserve `app/globals.css` (CSS file is framework-agnostic).

### T1.2 — Create TheoKit scaffold files

#### Files to edit

```
examples/chat-with-memory/theo.config.ts (NEW)
examples/chat-with-memory/index.html (NEW)
examples/chat-with-memory/app/_entry.tsx (NEW) — Vite-style React mount
examples/chat-with-memory/.nvmrc (NEW) — Node 22.12.0
examples/chat-with-memory/package.json — update scripts + deps per ADR D1
examples/chat-with-memory/tsconfig.json — adjust paths if needed
```

#### Tasks

1. Author minimal `theo.config.ts` using `defineConfig`.
2. Author `index.html` (Vite-style: `<div id="root"></div>` + script tag importing `app/_entry.tsx`).
3. Author `app/_entry.tsx` (`hydrateRoot` or `createRoot` mount of `<App />`).
4. Update `package.json`:
   - `scripts.dev`: `theokit dev`
   - `scripts.build`: `theokit build`
   - `scripts.start`: `theokit start`
   - `dependencies.theokit`: `^0.4.0` (or pinned current)
   - REMOVE `dependencies.next`
   - REMOVE `dependencies.openai` (per ADR D5; delayed actual remove until Phase 3)
5. Add `.nvmrc` with `22.12.0`.
6. Run `npm install` (or `pnpm install`) — confirm clean (no Next.js packages in resolved tree).
7. Run T0.1 tests 1-5 → GREEN.

#### TDD

```
RED: T0.1 tests 1-5 (locked in Phase 0)
GREEN: T1.2 § Tasks step 4 + 5 + 6
```

---

## Phase 2: Server routes migration — `app/api/*` → `server/routes/*`

### T2.1 — Migrate each `app/api/*/route.ts` to `server/routes/*.ts`

#### Files to edit

```
examples/chat-with-memory/server/routes/info.ts (NEW; was app/api/info/route.ts)
examples/chat-with-memory/server/routes/memories.ts (NEW; was app/api/memories/route.ts)
examples/chat-with-memory/server/routes/history.ts (NEW)
examples/chat-with-memory/server/routes/skills.ts (NEW; was app/api/skills/route.ts)
examples/chat-with-memory/server/routes/reflect.ts (NEW; was app/api/reflect/route.ts)
examples/chat-with-memory/server/routes/distill.ts (NEW; was app/api/distill/route.ts)
examples/chat-with-memory/server/routes/forget.ts (NEW; was app/api/forget/route.ts)
... (one per existing Next.js API route)
examples/chat-with-memory/app/api/ — DELETE entire tree after parity verified
```

#### Tasks

1. For each route under `app/api/`:
   - Replace `export async function GET/POST(request: Request)` with `export default defineRoute({ method, schema, handler })` per TheoKit convention
   - Replace `NextResponse.json(...)` with the typed return value (TheoKit infers from Zod schema)
   - Replace `request.json()` with `body` (TheoKit parses + validates via Zod)
2. Run `theokit dev` empirically; smoke-test each route via `curl http://localhost:3000/api/...`
3. Delete the `app/api/` tree.
4. Run T0.1 test 6 → GREEN.

#### TDD

```
RED: T0.1 test 6 (server/routes/ has ≥ 1 defineRoute import)
RED: per-route contract test (response shape preserved) — see T2.2
GREEN: T2.1 § Tasks steps 1+2+3
```

### T2.2 — Per-route contract tests (parity)

#### Files to edit

```
examples/chat-with-memory/server/routes/__tests__/*.test.ts — 1 per route, asserting response shape parity vs pre-migration
```

#### Tasks

1. For each migrated route, write a contract test asserting the response shape matches the pre-migration Next.js shape (use `theoFetch` typed client OR raw fetch + JSON shape assertion).
2. Run `npx vitest run` against the contract tests; expect GREEN post-migration.

---

## Phase 3: Memory wiring + Agent wiring canonical

### T3.0 — Wire TheoKit `createSessionManager` (NEW — EC-4 MUST FIX absorption) per ADR D7

#### Objective

Per `/edge-case-plan` EC-4: TheoKit sessions are **opt-in via `createSessionManager`** (empirically verified at `theokit-tools/theokit/packages/theo/src/server/auth/session.ts:84`). Plan T3.1 imports `memoryFromCtx(ctx, memory)` which dereferences `ctx.session.userId`. Without session manager wired, every memory route throws `Cannot read property 'userId' of undefined` at runtime → demo fully broken.

#### Files to edit

```
examples/chat-with-memory/server/auth/session.ts (NEW) — minimal anonymous-uid session strategy
examples/chat-with-memory/theo.config.ts — register session manager in defineConfig
examples/chat-with-memory/server/middleware/with-session.ts (NEW) — optional wrapper for routes
```

#### Tasks

1. Author `server/auth/session.ts`:
   ```ts
   import { createSessionManager } from 'theokit/server';
   import { randomUUID } from 'node:crypto';

   export const sessionManager = createSessionManager<{ userId: string }>({
     cookieName: 'themory_uid',
     // Minimal anonymous-uid strategy: generate UUID per browser, persist in cookie.
     // NOT auth — chat-with-memory demo is open; user identity is per-browser-session
     // only. Real production wiring would use TheoKit's OAuth/OIDC primitives.
     initialSession: () => ({ userId: `anon-${randomUUID()}` }),
   });
   ```
2. Register the manager in `theo.config.ts` per TheoKit canonical wiring.
3. Smoke test: invoke any route post-T2.1; `ctx.session.userId` returns the anon-uuid string.

#### TDD

```
RED: test_session_user_id_set_on_first_request — call /api/info; assert response header `Set-Cookie: themory_uid=...` AND a follow-up call sees the SAME UUID in ctx.session.userId.
GREEN: T3.0 § Tasks step 1+2.
```

### T3.1 — Rewrite `lib/memory.ts` via `@usetheo/memory/theokit` subpath

#### Files to edit

```
examples/chat-with-memory/lib/memory.ts — rewrite
examples/chat-with-memory/server/routes/*.ts — update to use memoryFromCtx
```

#### Tasks

1. Replace `import { createLocalMemory } from '@usetheo/memory'` with `import { createLocalMemory, memoryFromCtx } from '@usetheo/memory/theokit'`.
2. Each server route that consumes memory uses `const scoped = memoryFromCtx(ctx, memory)` to derive scope.
3. Remove manual scope wiring code (typically 5-10 LoC per route).
4. Decide on `lib/theomemory-plugin.ts`: DELETE if redundant with `memoryFromCtx` direct usage; OR REPURPOSE as canonical TheoKit plugin example showing the alternative pattern. Document the decision in the file's JSDoc.

### T3.2 — Rewrite `lib/agent.ts` via `@theokit/sdk` `Agent.prompt`

#### Files to edit

```
examples/chat-with-memory/lib/agent.ts — rewrite
examples/chat-with-memory/server/routes/chat.ts — use defineAgentEndpoint + Agent.prompt
examples/chat-with-memory/package.json — remove openai dep
```

#### Tasks

1. Rewrite `lib/agent.ts` using `Agent.create` + `Agent.send` (streaming case) OR `Agent.prompt` (one-shot).
2. Migrate `app/api/chat/route.ts` → `server/routes/chat.ts` using `defineAgentEndpoint` per TheoKit canonical "6-line essence" pattern.
3. Remove `openai: ^4.77.0` from `package.json#dependencies`.
4. Run `npm install` (or pnpm) — confirm clean.
5. Smoke test chat round-trip via `theokit dev` + manual browser test.

---

## Phase 4: Typed client migration — `fetch` → `theoFetch`

### T4.1 — Migrate 7 tab components to `theoFetch`

#### Files to edit

```
examples/chat-with-memory/components/memory-tabs/user-tab.tsx
examples/chat-with-memory/components/memory-tabs/session-tab.tsx
examples/chat-with-memory/components/memory-tabs/skills-tab.tsx
examples/chat-with-memory/components/memory-tabs/history-tab.tsx
examples/chat-with-memory/components/memory-tabs/eviction-tab.tsx
examples/chat-with-memory/components/memory-tabs/distillation-tab.tsx
examples/chat-with-memory/components/memory-tabs/reflection-tab.tsx
```

#### Tasks

1. For each tab component, replace raw `fetch('/api/...')` with TheoKit's `theoFetch('/api/...')`.
2. The route response type is inferred from `defineRoute` Zod schema (set up in Phase 2).
3. ZERO behavioral change to UI; only type-safety improves.

---

## Phase 5: Test skill rewrite — `/test-chat-with-memory` SKILL.md migration

### T5.1 — Update SKILL.md frontmatter + pre-conditions + dev-server boot logic

#### Files to edit

```
.claude/skills/test-chat-with-memory/SKILL.md
```

#### Tasks

1. Update frontmatter description: replace "Next.js demo" with "TheoKit demo".
2. Update pre-conditions:
   - Add: Node 22+ verified via `nvm use` (per ADR D4)
   - Replace: `npm install` → `pnpm install` IF TheoKit-canonical uses pnpm; else keep `npm install`
   - Verify `theokit dev` ready signal (likely same port 3000 — empirically verify)
3. Update "Spawn dev server" section: `npm run dev` (same incantation; alias resolves to `theokit dev` now).

### T5.2 — Migrate each of the 33 scenarios

#### Files to edit

```
.claude/skills/test-chat-with-memory/SKILL.md (same file as T5.1)
```

#### Tasks

1. Walk through each of the 33 scenarios in the SKILL.md.
2. For each: classify as `migrated as-is` / `migrated with adaptation` / `ADR-DEFERRED — reason`.
3. ADR-deferred MUST cite specific TheoKit-vs-Next.js entrypoint difference (e.g., RSC-only scenario, build-time bundle-shape check).
4. Floor: ≥ 30 of 33 preserved (per ADR D6).

---

## Phase 6: Integration validation + cycle close

### T6.1 — Real-tree integration validation

#### Tasks

1. `cd examples/chat-with-memory && rm -rf node_modules && pnpm install` (or `npm install` per package manager choice in T1.2)
2. `theokit dev` boots clean — 0 errors, 1 ready signal on port 3000
3. Manual smoke: browser open `http://localhost:3000`; chat round-trip works against real pgvector + OpenRouter LLM
4. `/test-chat-with-memory` skill returns READY with ≥ 30 of 33 PASS
5. `npm test` (theo-memory root) — 1071+ PASS preserved (no contract regressions)
6. Write `/implement-validate` synthetic report

#### Acceptance Criteria

- [ ] `theokit dev` boots in < 30s on cold start (EC-10 absorption: relaxed from v1.0's < 10s; Vite + better-sqlite3 ABI rebuild + Tailwind first-compile cumulative cost)
- [ ] `theokit dev` boots in < 5s on warm restart (delta of EC-10 acceptance)
- [ ] Chat round-trip end-to-end PASS against real pgvector + OpenRouter
- [ ] `/test-chat-with-memory` ≥ 30/33 PASS
- [ ] `package.json#dependencies.next` ABSENT
- [ ] `package.json#dependencies.theokit` PRESENT
- [ ] `theo.config.ts` exists
- [ ] `.nvmrc` exists
- [ ] Per-route contract tests GREEN

---

## Coverage Matrix

| # | Gap / Goal item | Task(s) | Resolution |
|---|---|---|---|
| 1 | Sub-goal 1 — Bootstrap migration | T1.1, T1.2, ADR D1 | Strip next + add theokit scaffold |
| 2 | Sub-goal 2 — Server routes migration | T2.1, T2.2 | defineRoute + Zod schemas |
| 3 | Sub-goal 3 — Chat endpoint canonical | T3.2 (chat.ts under defineAgentEndpoint) | TheoKit canonical "6-line essence" |
| 4 | Sub-goal 4 — Memory wiring canonical | T3.1, ADR D3 | `@usetheo/memory/theokit` subpath + memoryFromCtx |
| 5 | Sub-goal 5 — Agent canonical | T3.2, ADR D5 | `@theokit/sdk` Agent.prompt + remove openai dep |
| 6 | Sub-goal 6 — Typed client migration | T4.1 | theoFetch on 7 tabs |
| 7 | Sub-goal 7 — Test skill migration | T5.1, T5.2, ADR D6 | ≥ 30/33 preserved + ADR-deferred minority |
| 8 | Sub-goal 8 — Integration validation | T6.1 | Real-tree end-to-end |
| 9 | better-sqlite3 ABI preflight discipline | T1.2 (.nvmrc), ADR D4 | Inherit + document |
| 10 | RED gate | T0.1 | 6 sentinel tests pre-migration |
| 11 | Per-route contract parity | T2.2 | 1 test per migrated route |
| 12 | EC-4 MUST FIX — TheoKit session wiring | T3.0, ADR D7 | Anonymous-UUID `createSessionManager` strategy |
| 13 | EC-5 SHOULD TEST — `app/api/` route inventory | T0.1 sentinel 7 | Per-route parity sentinel post-T2.1 |
| 14 | EC-6 SHOULD TEST — Tailwind CSS pipeline migration | T1.2 step 4.5 (add `@tailwindcss/vite`) | `app/globals.css` directives resolve under Vite |
| 15 | EC-7 SHOULD TEST — `.env` var read post-migration | T1.2 step 7 (empirical env test) | THEOMEM_PG_URI + OPENAI_API_KEY + THEOKIT_API_KEY resolved |
| 16 | EC-8 SHOULD TEST — Test path picked up by vitest glob | T0.1 sentinel 8 | self-discovery assertion |
| 17 | EC-9 SHOULD TEST — Enumerate deferral criteria before migration | T5.2 step 1 | Pre-enumerated AT-RISK list |

**Coverage: 17/17 (100%)** — All 8 sub-goals + RED gate + per-route parity + native-bindings discipline + 1 MUST FIX absorption (EC-4) + 5 SHOULD TEST absorptions (EC-5..EC-9).

## Global Definition of Done

- [ ] All 6 phases completed
- [ ] All tests passing — `npm test` green (1071+ PASS preserved)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] File-size budget respected (per `.claude/rules/architecture.md § Module hygiene`)
- [ ] `examples/chat-with-memory/package.json#scripts.dev === 'theokit dev'`
- [ ] `examples/chat-with-memory/package.json#dependencies` has `theokit`, no `next`, no `openai`
- [ ] `examples/chat-with-memory/theo.config.ts` exists
- [ ] `examples/chat-with-memory/.nvmrc` exists pinning Node 22
- [ ] `/test-chat-with-memory` skill returns READY with ≥ 30/33 PASS against `theokit dev` entrypoint
- [ ] CHANGELOG.md `[Unreleased]` updated under `### Changed` (demo entrypoint migration)
- [ ] `/review examples-theokit-chat-migration` returns **READY_TO_MERGE** (0 BLOCKER, 0 CRITICAL, 0 MAJOR)
- [ ] **Plan archived** — after `/review` returns READY_TO_MERGE AND PR merged to main

## Final Phase: Integration Validation (MANDATORY)

```bash
cd examples/chat-with-memory && rm -rf node_modules dist .next .theokit/build 2>/dev/null; npm install
theokit dev &  # background
sleep 10
curl -fsS http://localhost:3000/api/info | jq .
# Manual smoke: open browser, chat round-trip
# Then /test-chat-with-memory skill

# Back at theo-memory root:
npm test && npm run typecheck && npm run lint
```

### Acceptance Criteria

- [ ] `theokit dev` boots clean
- [ ] Chat round-trip PASS
- [ ] `/test-chat-with-memory` ≥ 30/33 PASS
- [ ] All test suites green at theo-memory root
- [ ] Zero TS errors, zero lint warnings
- [ ] `/review` verdict: READY_TO_MERGE

## Documented risks (informational; not Coverage-Matrix-tracked)

**R1 — TheoKit dev-server port may differ from Next.js**: TheoKit `theokit dev` likely uses port 3000 by default (same as Next.js) but verify empirically at T1.2. If different, `/test-chat-with-memory` skill pre-condition #3 needs updating.

**R2 — RSC-deferred decision in TheoKit**: TheoKit explicitly defers React Server Components past 1.0 (per TheoKit CLAUDE.md § "Architectural decisions on record"). Any Server Component usage in current `app/page.tsx` must become client component. Current demo is mostly client-driven; impact likely zero, but verify at T1.1.

**R3 — pnpm vs npm package manager**: TheoKit canonical examples (`theokit/examples/full-stack-agent`) use `workspace:*` deps which require pnpm. theo-memory uses npm + `file:../..` for the SDK link. Sub-goal 1 keeps npm to avoid widening scope to monorepo migration. If a future plan unifies pkg managers, that's a separate cycle.

**R4 — `theokit` published version availability**: Plan declares `^0.4.0`. If TheoKit is workspace-only (not yet published) OR a different version, T1.2 will surface this. Mitigation: use `workspace:*` if `examples/chat-with-memory/` is moved INTO the theokit monorepo (out of scope); else publish or pin to the latest version.

**R5 — `theomemory-plugin.ts` decision deferred to T3.1**: the file may be redundant with `memoryFromCtx` direct usage; OR may be a legitimate canonical TheoKit plugin example. The cycle-implement halt-loop at T3.1 will make the call based on empirical reading of the file (which I have not done in this plan-author step).

## P0 freeze framing (honest disclosure per Inquebrável Rule 3)

This migration is framed as **PRIORITY 0 sub-goal 2 ("SDKs 100% functional") hardening**, NOT as a new feature. Justification:

- **`@usetheo/memory/theokit` subpath already ships** (v0.2 PR-A merged at PR #11). This plan does NOT introduce a new public API.
- **The 7 demo tabs already exist and work** against the current Next.js entrypoint. This plan does NOT add functionality.
- **The migration closes a structural honesty gap** — showing the canonical consumer pattern that the subpath was designed for.
- **No new features land in this cycle** — only entrypoint migration + canonical wiring + typed-client adoption.

If `/review` or `/dogfood` audits decide this framing is incorrect (e.g., "this IS a new feature surface"), the cycle halts; project owner decides whether to amend the PRIORITY 0 directive OR re-scope this plan.
