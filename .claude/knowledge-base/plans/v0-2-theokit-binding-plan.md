# Plan: v0.2 — TheoKit Binding (`@usetheo/memory/theokit`)

> **Version 1.1** — Ship the `@usetheo/memory/theokit` subpath that auto-resolves `user_id` / `session_id` / `agent_id` from TheoKit request context AND wires default-on memory into `create-theo` scaffolded templates (`saas`, `postgres`). This is the deliberate lock-in surface (override of Cross-Project Rule 6) ratified at CLAUDE.md § Architectural Decisions Locked. Synthesizes the v0-2-theokit-binding blueprint (SHIPPABLE_WITH_CAVEATS 89/100) into atomic TDD-disciplined tasks. Expected outcome: a consumer running `npx create-theokit my-app --template=saas` gets a working memory primitive wired into their first handler with zero explicit `createMemory` call in user code.
>
> **Version 1.1 changelog (2026-05-23):** Absorbed 5 MUST FIX + 5 SHOULD TEST + 3 DOCUMENT items from `.claude/knowledge-base/reviews/v0-2-theokit-binding-edge-cases-2026-05-23.md`. Added ADRs D7 (cross-repo PR coordination) + D8 (stub adapters + private flag removal). Added tasks T2.3 (remove `"private": true`) + T4.5 (`src/local/stubs.ts` with StubEmbedder/StubLLM). Revised T1.1 with runtime type-guard for userId. Added 5 SHOULD TEST cases inline in TDD blocks; 3 DOCUMENT items inline in Deep Dives / Acceptance Criteria. Late addition (same v1.1 cycle, post `/plan-confidence` initial run): added mandatory `## Dependencies` section per cycle-plan.md v1.1 — gap revealed by `/deps-audit` invocation.

## Goal

> "Enable consumers of `npx create-theokit --template=saas` to call `memoryFromCtx(ctx).remember(text)` inside any route handler so that memories persist scoped to `ctx.session.userId` without explicit scoping in user code, measured by the integration test `tests/integration/theokit-binding.test.ts` passing with two distinct userIds producing ZERO overlap on `recall()`."

## Context

**v0.1 shipped 2026-05-23 (PR #8):** `createLocalMemory({ vectorStore, embedder, llm, ... })` returns a `Memory` with three-tier scope (`memory.user(id).remember(text)`). Every TheoKit handler must currently call `memory.user(ctx.session.userId).remember(text)` explicitly — two lookups (`ctx.session.userId` extraction + `memory.user(id)` factory), and the consumer must thread the `memory` singleton into every handler module.

**The ergonomics gap:** discovery blueprint (v0-2-theokit-binding-blueprint.md, SHIPPABLE_WITH_CAVEATS 89/100) confirmed via Q1-Q7 that:
- TheoKit's `defineRoute<TCtx = unknown>` makes ctx structurally typed — zero peer-dep needed (Q3, ADR D1).
- ZERO `AsyncLocalStorage` usage across `../theokit/packages/` — binding must be arg-passed (Q6, ADR D2).
- 4 of 5 TheoKit fixtures share `{ session: UserSession | null }` shape; 1 fixture (`template-postgres`) has no session at all; 1 fixture (`auth-providers-diy-github`) has optional `userId` during OAuth round-trip (Q5, ADR D4).
- `create-theo` is a static-template scaffolder; no plugin API — default-on memory requires direct edits to `templates/{saas,postgres}/` AND `--bare` strip symmetry (Q4, ADR D3).
- `session.userId` is 100% consumer-controlled via `ctx.sessions.createSession(res, { userId, ... })` at login; binding TRUSTS userId as-is (Q7).
- Mem0 has NO TS server framework adapter (Q1); Letta uses `Depends(get_headers)` per-request DI (Q2) — TheMemory's binding is the first in this design space with auto-scoping precedent.

**Current `src/` state (relevant):**
- `src/index.ts` exports `createMemory`, `createLocalMemory`, `runMigrations`, classes, contract types.
- `src/core/scope.ts` declares `Scope` discriminated union (`{ kind: 'user' | 'session' | 'agent', ... }`).
- `src/core/errors.ts` declares `InvalidScope`, `MemoryNotFound`, `EmbeddingMismatch`, etc.
- `src/theokit/` DOES NOT EXIST yet — this plan creates it.
- `package.json#exports` declares `.` and `./contract` subpaths only.

**Compliance scope:** plan honors `architecture.md` (DIP — binding depends only on `src/core/` contracts), `testing.md` (TDD red-green-refactor + pyramid), `dogfood-golden-rule.md` (anchor scenario must continue running), `public-copy.md` (lock-in honesty), and `discover-blueprint-golden-rule.md` (cite blueprint as source).

## Objective

- [ ] Sub-goal 1 — `src/theokit/index.ts` exports `memoryFromCtx(ctx, memory)` function + `ScopedContext` interface + `MissingScopeError` class.
- [ ] Sub-goal 2 — `package.json#exports` declares `./theokit` subpath; `src/index.ts` does NOT re-export theokit (separate subpath per ADR D1).
- [ ] Sub-goal 3 — Binding handles 3 resolver states (userId present / session null / session-field-absent) with explicit fail-loud errors.
- [ ] Sub-goal 4 — `tests/integration/theokit-binding.test.ts` exercises real handler invocation against ephemeral pgvector with two distinct userIds producing disjoint `recall()` result sets (zero overlap).
- [ ] Sub-goal 5 — `../theokit/packages/create-theo/templates/saas/package.json.tmpl` + `templates/postgres/package.json.tmpl` declare `"@usetheo/memory": "^0.1.0"` as dependency.
- [ ] Sub-goal 6 — `templates/saas/server/routes/memory.ts` + `templates/postgres/server/routes/memory.ts` exist as demo routes exercising `memoryFromCtx(ctx).remember(body.text)`.
- [ ] Sub-goal 7 — `../theokit/packages/create-theo/src/bare-transform.ts` strips `@usetheo/memory` from default-template `--bare` output (symmetry with `@usetheo/sdk` strip).
- [ ] Sub-goal 8 — `tests/e2e/scaffolded-binding.test.ts` spawns the scaffolded `saas` template, HTTP-POSTs with an auth cookie, asserts DB row written under correct userId.

## ADRs

### D1 — Structural typing over peer-dep on `theokit`

- **Decision:** `@usetheo/memory/theokit` ships with ZERO peer-dep on the `theokit` package. The binding consumes ctx via a locally-declared structural interface `ScopedContext` (`{ session?: { userId?: string; sessionId?: string; agentId?: string } | null }`).
- **Alternatives:**
  - (A) Hard peer-dep on `theokit ^0.1.0-alpha` + import `RouteConfig` — REJECTED.
  - (B) Optional peer-dep with conditional types — REJECTED (complexity for marginal benefit).
  - (C) Selected: structural typing, no peer-dep — blueprint Q3.
- **Rationale:** TheoKit's `defineRoute<TCtx = unknown>` defaults `TCtx` to `unknown` — framework makes no commitment about ctx shape. Adding a peer-dep would tie TheMemory's release cadence to TheoKit's alpha (currently `0.1.0-alpha.5`). Letta precedent (blueprint Q2) consumes scope-carrying objects structurally without framework type imports. Honors `architecture.md § 3` (DIP — binding depends on abstraction, not concrete TheoKit type).
- **Consequences:**
  - TheMemory ships independent semver; no lockstep with TheoKit.
  - Binding works against ANY framework whose ctx has `{session: {userId?: string}}` — broader applicability for free.
  - Consumer's TypeScript still gets full inference at handler site because TheoKit preserves `TCtx` end-to-end.

### D2 — Arg-passed binding API (no `getCurrentMemory()` accessor, no AsyncLocalStorage)

- **Decision:** Binding exposes only a pure function `memoryFromCtx(ctx, memory)`. No global accessor. No async-local container.
- **Alternatives:**
  - (A) Wrap `createContext` with AsyncLocalStorage + expose `getCurrentMemory()` — REJECTED.
  - (B) React-style hook `useMemory()` — REJECTED (not a React context).
  - (C) Selected: pure arg-passed `memoryFromCtx(ctx, memory)` — blueprint Q6.
- **Rationale:** Blueprint Q6 confirmed ZERO `AsyncLocalStorage` / `async_hooks` references in `../theokit/packages/` and `../theokit/fixtures/`. TheoKit's explicit-over-implicit choice is deliberate; introducing async-local in a binding intended to feel native would violate principle-of-least-surprise. KISS (root global CLAUDE.md § 10) prefers explicit args over hidden context containers.
- **Consequences:**
  - Per-request isolation framework-guaranteed (each request gets fresh ctx); zero risk of cross-request leakage from binding-level mistake.
  - Trivially testable: pass a mock ctx object; no async-context setup boilerplate.
  - Verbosity trade-off: consumer threads `ctx` to `memoryFromCtx(ctx, memory)` at every handler.

### D3 — Default-on memory in `create-theo` scaffolded DB-bearing templates (deliberate lock-in)

- **Decision:** `@usetheo/memory` ships pre-wired in `saas` + `postgres` scaffolded templates (not in `default`, `dashboard`, `api-only`). `--bare` strip mandatory for the default template (mirrors existing `@usetheo/sdk` strip pattern).
- **Alternatives:**
  - (A) Memory opt-in — consumer manually installs + wires — REJECTED (defeats the consolidation pitch).
  - (B) Default-on in ALL templates — REJECTED (templates without sessions surface confusing missing-scope errors).
  - (C) Selected: default-on in DB-bearing templates only + `--bare` symmetry — blueprint Q4.
- **Rationale:** Lock-in surface ratified at CLAUDE.md § Architectural Decisions Locked (override of Cross-Project Rule 6). Discovery plan acceptance criterion: "Scaffolded template includes memory module by default". Templates without sessions (`default`, `api-only`) lack `ctx.session.userId`, so binding would throw `MissingScopeError` on first call — worse DX than absent dep.
- **Consequences:**
  - TheMemory PRs touching scaffolding ALSO touch `../theokit/packages/create-theo/templates/` (T-T+1 coordination required).
  - Template snapshot test mandatory: scaffolded `saas` output must contain `"@usetheo/memory"` dep + `server/routes/memory.ts` file.
  - `--bare` must drop `@usetheo/memory` while package unpublished (mirrors current `@usetheo/sdk` handling per `bare-transform.ts`).
  - Lock-in is at the BEHAVIOR level (scaffolded template + binding pre-wired), NOT the TYPE level (per D1).

### D4 — Defensive scope resolution: 3 explicit states with fail-loud errors

- **Decision:** Binding's scope resolver explicitly handles three states with separate error messages.

| State | Trigger | Behavior |
|---|---|---|
| (a) `ctx.session.userId` is non-empty string | Authenticated request, session-bearing fixture | Return `ScopedMemory` rooted at userId |
| (b) `ctx.session` is `null` | Unauthenticated request, session-bearing fixture | Throw `MissingScopeError('authenticated session required — call requireAuth(ctx.session) first')` |
| (c) `ctx.session` field absent OR `ctx.session.userId` undefined | Non-session fixture OR OAuth round-trip | Throw `MissingScopeError('binding requires session-bearing TheoKit context — wire createSessionManager first')` |

- **Alternatives:**
  - (A) Assume userId always present; NPE if absent — REJECTED (poor DX; hides blueprint Q5 edge cases).
  - (B) Fallback to `memory.anonymous()` on absent session — DEFERRED (out of v0.2 scope; revisit at v0.3 if real consumer asks).
  - (C) Selected: 3 explicit states with fail-loud errors — blueprint Q5.
- **Rationale:** Blueprint Q5 surveyed all 5 TheoKit fixtures: `template-postgres` has no session field; `auth-providers-diy-github` has `userId?: string` during OAuth round-trip. Pretending these cases don't exist produces confusing runtime errors. Consistent with Inquebrável Rule 8 (fail-fast, fail-clear) and root global CLAUDE.md § 8.
- **Consequences:**
  - Binding's `MissingScopeError` is a new error class extending the existing `InvalidScope` family in `src/core/errors.ts`.
  - Consumer guidance: call `requireAuth(ctx.session)` BEFORE `memoryFromCtx(ctx)` to narrow to state (a).
  - Anonymous-memory feature deferred to a future cycle if demand surfaces.

### D5 — Three-layer test pyramid: unit + integration + e2e snapshot

- **Decision:** v0.2 ships three test layers — unit (`memoryFromCtx` against mock ctx + mock memory), integration (handler invocation against real `createLocalMemory` + ephemeral pgvector), e2e (scaffolded template snapshot + spawned subprocess with HTTP client).
- **Alternatives:**
  - (A) Server-in-thread fixture (Letta-style, blueprint Q2) — REJECTED (TheoKit has no SDK client to test against; overkill).
  - (B) Skip e2e entirely — REJECTED (discovery plan mandates "Scaffolded template snapshot test" + "E2E with HTTP request").
  - (C) Selected: 3-layer pyramid — blueprint Q2 + Q4 synthesis.
- **Rationale:** v0.1 proved in-process integration tests + ephemeral Postgres + real LLM stubs are sufficient for confidence. Honors `testing.md § Pyramid`. E2E test slow (~30s — `npm install` in temp dir); mark `@slow`, run in CI only.
- **Consequences:**
  - E2E test requires the `create-theo` scaffolder to be available at `../theokit/packages/create-theo/`.
  - Template snapshot test provides cheap (<1s) canary if `create-theo` template drifts.
  - Integration test reuses v0.1's ephemeral pgvector fixture from `tests/integration/local-runtime.test.ts` — zero new fixture infra.

### D6 — Subpath export shape: `@usetheo/memory/theokit` as separate entry point

- **Decision:** Add `./theokit` to `package.json#exports` pointing at `./src/theokit/index.ts`. The default `@usetheo/memory` (`src/index.ts`) does NOT re-export theokit symbols.
- **Alternatives:**
  - (A) Re-export from `src/index.ts` — REJECTED (forces non-TheoKit consumers to bundle theokit binding code; widens main bundle).
  - (B) Selected: separate subpath — matches CLAUDE.md § Locked names ("Subpath exports: `@usetheo/memory` (local default) + `@usetheo/memory/cloud` (managed)") pattern.
- **Rationale:** Honors `architecture.md § 9` (Public API surface: "Subpath exports ... are explicit per the locked names table"). Bundle-size assertion test mandatory (importing `@usetheo/memory` does NOT pull `src/theokit/` code).
- **Consequences:**
  - Consumers using TheoKit: `import { memoryFromCtx } from '@usetheo/memory/theokit'`.
  - Consumers NOT using TheoKit: pay zero binding cost.
  - Per `architecture.md § 9`, README's "Planned API contract" + `package.json#exports` + a public-path test all must be updated together.

### D7 — Cross-repo PR coordination protocol (absorbs EC-4)

- **Decision:** v0.2 ships as **two coordinated PRs** with explicit merge order. PR-A (this repo, `theo-memory`) lands first with binding code + publish gate; PR-B (sibling repo, `theokit`) lands second with template edits + `bare-transform.ts` extension, blocked on PR-A's npm publish completing.
- **Alternatives:**
  - (A) Single PR mixing both repos — IMPOSSIBLE (different repos, no shared CI).
  - (B) PR-B (theokit) merges first with templates declaring future-version dep — REJECTED (theokit CI breaks on scaffold smoke test until `@usetheo/memory@^0.1.0` exists on registry).
  - (C) Feature flag `THEMEMORY_DEFAULT_ON=1` toggle in scaffold CLI — REJECTED (adds permanent dead-code branch for one-time-only sequencing).
  - (D) Selected: ordered merge — PR-A publishes package; PR-B then activates templates. — From edge case review EC-4.
- **Rationale:** Inquebrável Rule 3 (extreme honesty about cross-repo coordination); Inquebrável Rule 4 (no force-pushes, no rewrite history — sequential merges respect both git histories cleanly).
- **Consequences:**
  - PR-A description MUST link to PR-B as "Followed by"; PR-B description MUST link to PR-A as "Blocked on".
  - Phase 4 tasks (T4.1-T4.4) become part of PR-B, not PR-A. Phase 4 in this plan represents content authored in `../theokit/`; the actual git commit lives in the sibling repo.
  - Acceptance criterion adds: "PR-B passes scaffold smoke test in CI after `npm install @usetheo/memory@<published-version>` resolves successfully".
  - Rollback: if PR-A merges but PR-B is delayed > 7 days, that's acceptable — the binding is usable without scaffolded default-on; default-on becomes a follow-up.

### D8 — Stub adapters + publish gate (absorbs EC-2 + EC-5)

- **Decision:** Two coupled changes ship together to make scaffolded `npm install + npm run dev` succeed without consumer wiring: (a) ship `StubEmbedder` + `StubLLM` in new `src/local/stubs.ts` exported via `@usetheo/memory`; scaffolded singleton uses them as default; (b) flip `package.json` `"private": true` → remove the flag (or set to `false`); add `npm publish --dry-run` to CI as a publish-gate check.
- **Alternatives:**
  - (A) Require consumer to wire LLM/Embedder at scaffold time, surface error in scaffolded README — REJECTED (defeats "default-on memory" lock-in narrative; first-`npm run dev` crashes on probe).
  - (B) Default to OpenAI/Anthropic provider when `OPENAI_API_KEY` env var is set — REJECTED (creates implicit dependency on environment that's not declared in `dependencies`; consumer-side surprise).
  - (C) Keep `"private": true` and document workspace-only dogfood — REJECTED (Phase 5 E2E test cannot exercise the publish path; Goal "consumer running `npx create-theokit ...` gets working memory" unattainable).
  - (D) Selected: stubs + publish gate together — from edge case review EC-2 + EC-5.
- **Rationale:** Honors `architecture.md § 4` (Mem0-shape "robust I/O fallbacks at every boundary" — probe-time stub IS the fallback) + `architecture.md § 8` (validate at boundaries — stub throws clear error on first remember() if consumer didn't override). Honors `dogfood-golden-rule.md` honesty discipline — scaffolded demo MUST actually run, not crash on first start.
- **Consequences:**
  - Stubs are deterministic (probe returns zero-vector of `MAX_EMBEDDING_DIM` length; LLM returns empty fact array) — passes probe, scaffolded app boots, first `remember()` call surfaces "wire your real provider" guidance.
  - Public surface widens: `src/index.ts` re-exports `StubEmbedder` + `StubLLM` (test/demo path; mark via JSDoc `@experimental — for scaffold demo only, replace before production`).
  - Removing `"private": true` opens the npm publish path; first publish (`0.0.0-rc.3` or first `0.1.0` cut) becomes a gate for Phase 5 E2E.
  - PR description must reference D7 + D8 together (publish gate enables PR-B).

## Dependencies

Per cycle-plan.md v1.1 — mandatory declaration of every Existing / New / Removed dep this plan touches. Cross-referenced by `/deps-audit` against current manifests + registry + CVE database.

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| drizzle-orm | ^0.45.0 | npm | v0.1 dep; binding does NOT use it directly but T4.5 stubs ship alongside DrizzleHistoryManager (already exported) |
| pg | ^8.13.0 | npm | v0.1 dep; binding does NOT use it directly; only relevant to T4.5 stubs as the Pool type for sample usage |
| zod | ^3.24.0 | npm | v0.1 dep; T4.2 demo route uses zod for body schema (mirrors TheoKit fixture pattern) |
| @opentelemetry/api | ^1.9.0 | npm (dev) | v0.1 dep; binding does NOT instrument (delegates to underlying createLocalMemory which already does) |
| typescript | ^5.4.0 | npm (dev) | v0.1 dep; T0.2 type-only tests + structural typing rely on TS ≥ 5.4 inference |
| vitest | ^4.0.0 | npm (dev) | v0.1 dep; T1.1 + T3.1 use vitest; T0.2 uses vitest's `expectTypeOf` |
| vitest-mock-extended | ^4.0.0 | npm (dev) | v0.1 dep; T1.1 spy on `memory.user()` uses mock-extended |
| eslint + plugins | ^9.0.0 | npm (dev) | v0.1 dep; lint gate honored per Global DoD |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | — | — | N/A — v0.2 introduces ZERO new runtime deps to `@usetheo/memory`'s `package.json`. | The binding lives in `src/theokit/` and depends ONLY on `src/core/` (per DIP `architecture.md § 3`). Stubs (T4.5) implement existing `Embedder` + `LLM` DIPs from `src/core/dip/` — no external lib needed. Demo route in scaffolded template uses `zod` which is already a TheoKit peer-dep (no addition required there either). |

**Cross-repo dep declaration** (sibling `theokit` repo, NOT this repo's `package.json`):

| Package | Version | Where | Rule 9 rationale | Why |
|---|---|---|---|---|
| @usetheo/memory | ^0.1.0-next.0 | `../theokit/packages/create-theo/templates/{saas,postgres}/package.json.tmpl` | N/A — this package IS the dep being introduced (self-reference into scaffolded apps) | T4.1 adds the dep to template `package.json.tmpl`. Version range ties to PR-A's npm publish (per ADR D7). |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | v0.2 introduces additive code only (`src/theokit/` + `src/local/stubs.ts`); zero deletions from manifest. T2.3 removes `"private": true` from `package.json` BUT that is a PACKAGE METADATA change, not a dep removal. |

### Audit expectations

- v0.2's own `package.json` is UNCHANGED for runtime deps; `/deps-audit` against the current manifest should report whatever CVEs the v0.1 deps surface (already audited at v0.1 release with HIGH CVE on drizzle-orm <0.45.2 forcing the ^0.45.0 bump per v0.1 ADR D1.10).
- The cross-repo `@usetheo/memory` dep added in template `package.json.tmpl` lives in the sibling theokit repo and is audited there (not by THIS invocation of `/deps-audit`).

## Dependency Graph

```
Phase 0 (Contract types) ──▶ Phase 1 (Core binding) ──▶ Phase 2 (Subpath + publish gate)
                                       │                       │
                                       │                       ├── T2.1 (subpath)
                                       │                       ├── T2.2 (README)
                                       │                       └── T2.3 (remove "private": true) [v1.1, D8]
                                       │                                │
                                       ▼                                ▼
                                Phase 3 (Integration tests)  Phase 4 (Template integration — PR-B per D7)
                                                                  ├── T4.1 (package.json.tmpl)
                                                                  ├── T4.2 (demo route)
                                                                  ├── T4.3 (singleton + ctx augment)
                                                                  ├── T4.4 (bare-transform strip)
                                                                  └── T4.5 (stubs — src/local/stubs.ts) [v1.1, D8]
                                                                  │
                                                                  ▼
                                                            Phase 5 (E2E test)
                                                                  │
                                                                  ▼
                                                        Phase 6 (Docs + CHANGELOG)
                                                                  │
                                                                  ▼
                                                  Final Phase (Integration Validation)
```

- Phase 0 blocks Phases 1-6 (types are the foundation).
- Phase 1 blocks Phases 2, 3 (binding code must exist).
- Phase 2 (incl. T2.3 publish gate) blocks Phase 5 (subpath must be importable for scaffolded app AND package must be publishable).
- Phase 4 blocks Phase 5 (templates must be updated before scaffolded app can be spawned).
- Phases 3 + 4 can run in parallel after Phase 2.
- **PR coordination (D7):** Phases 0-3 + 6 land in PR-A (this repo). Phase 4 lands in PR-B (sibling `theokit` repo) AFTER PR-A's publish step completes. Phase 5 E2E test runs in PR-B against the published `@usetheo/memory@<version>` from PR-A.
- **T4.5 (stubs)** lives in `src/local/` so it lands in PR-A (Phase 4 actually splits: T4.5 in PR-A; T4.1-T4.4 in PR-B). Naming kept as "Phase 4" to preserve task numbering across reviews.

---

## Phase 0: Contract Types

**Objective:** Declare the structural `ScopedContext` interface and `MissingScopeError` class that the binding consumes.

### T0.1 — Declare `MissingScopeError` in `src/core/errors.ts`

#### Objective
Add a typed domain error so the binding's 3-state resolver can throw with stable error class consumers can `instanceof`-check.

#### Evidence
Blueprint ADR D4 mandates fail-loud errors with distinct messages for state (b) vs state (c). `src/core/errors.ts` already exports `InvalidScope`, `MemoryNotFound`, `EmbeddingMismatch` etc. — pattern is established.

#### Files to edit
```
src/core/errors.ts — add MissingScopeError class extending Error
src/core/__tests__/errors.test.ts — RED tests for MissingScopeError construction + instanceof checks (NEW IF not present; APPEND otherwise)
src/core/index.ts — re-export MissingScopeError (verify barrel)
```

#### Deep file dependency analysis
- `src/core/errors.ts` — currently exports 6+ error classes; SRP respected per class. Adding `MissingScopeError` follows the same shape.
- `src/core/index.ts` — re-exports all errors via `export * from './errors.js'`; no change needed if `errors.ts` exports a new class.
- Downstream: `src/theokit/index.ts` (Phase 1) imports `MissingScopeError` from `@usetheo/memory/core` (`./core/errors.js` internally).

#### Deep Dives
- **Data structure:** `MissingScopeError extends Error` with `readonly name = 'MissingScopeError'` for stable `instanceof` + serializable name.
- **Invariant:** message MUST be one of two stable strings (state b message vs state c message) — tests assert exact substring presence.
- **Edge cases:** error must be JSON-serializable (no circular refs); cause chain via `Error.cause` if needed (not required at v0.2).

#### Tasks
1. Add `MissingScopeError` class to `src/core/errors.ts`.
2. Confirm `src/core/index.ts` re-exports it (test imports through `@usetheo/memory/contract`).
3. Update RED tests in `src/core/__tests__/errors.test.ts`.

#### TDD
```
RED:     test_missing_scope_error_has_stable_name() — asserts new MissingScopeError(msg).name === 'MissingScopeError'
RED:     test_missing_scope_error_is_instance_of_error() — asserts new MissingScopeError(msg) instanceof Error
RED:     test_missing_scope_error_preserves_message() — asserts new MissingScopeError('test').message === 'test'
GREEN:   Add the class to errors.ts
REFACTOR: None expected (single-class addition)
VERIFY:  npm test -- src/core/__tests__/errors.test.ts
```

#### Acceptance Criteria
- [ ] `MissingScopeError` is importable via `import { MissingScopeError } from '@usetheo/memory/contract'`
- [ ] All 3 RED tests pass after GREEN step
- [ ] Pass: complexity — class is trivial (cyclomatic 1)
- [ ] Pass: coverage — 100% (class is 4 lines)
- [ ] Pass: lint — zero warnings on `src/core/errors.ts`
- [ ] Pass: size — `src/core/errors.ts` ≤ 500 lines (currently ~80; safe)

#### DoD
- [ ] All tasks completed and validated
- [ ] All tests passing — `npm test -- src/core/__tests__/errors.test.ts` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected

---

### T0.2 — Declare `ScopedContext` interface in `src/theokit/types.ts`

#### Objective
Create the structural interface the binding consumes. Lives in `src/theokit/` (not `src/core/`) because it's binding-specific, not part of the universal Memory contract.

#### Evidence
ADR D1 mandates structural typing with no peer-dep on `theokit`. The interface MUST accommodate all 5 fixture variants from blueprint Q5 (session present, session null, session field absent, userId optional).

#### Files to edit
```
src/theokit/types.ts — NEW: declare ScopedContext interface
src/theokit/__tests__/types.test-d.ts — NEW: type-only tests asserting compatibility with each fixture's RequestContext shape
```

#### Deep file dependency analysis
- `src/theokit/types.ts` (NEW) — sole purpose: declare `ScopedContext`. ≤ 30 lines.
- `src/theokit/__tests__/types.test-d.ts` (NEW) — uses `expectTypeOf` (vitest) to assert TheoKit fixture shapes are assignable to `ScopedContext`. Per `testing.md § What NOT to test`, type-only tests are acceptable for tricky inference paths.
- Downstream: `src/theokit/index.ts` imports `ScopedContext`; integration tests reference it.

#### Deep Dives
- **Type structure:**
  ```ts
  export interface ScopedContext {
    session?: {
      userId?: string
      sessionId?: string
      agentId?: string
    } | null
  }
  ```
- **Why `| null` and `?:` both:** matches blueprint Q5 — `template-postgres` has no `session` field (the `?:` case); session-bearing fixtures may have `session: null` when unauthenticated (the `| null` case). Both states must be representable.
- **Invariant:** consumer's narrower types must be assignable to `ScopedContext`. Verified via `expectTypeOf<UserSession>().toMatchTypeOf<NonNullable<ScopedContext['session']>>()`.

#### Tasks
1. Create `src/theokit/` directory.
2. Write `src/theokit/types.ts` with `ScopedContext` interface + JSDoc citing blueprint Q5.
3. Write `src/theokit/__tests__/types.test-d.ts` with 5 type assertions (one per fixture shape).

#### TDD
```
RED:     test_template_saas_context_is_assignable() — assertType<{session: {userId: string, email: string} | null}>() satisfies ScopedContext
RED:     test_sessions_auth_context_is_assignable() — same shape as saas minus db
RED:     test_authjs_bridge_context_is_assignable() — adds optional name?: string
RED:     test_diy_github_context_is_assignable() — userId is OPTIONAL on UserSession
RED:     test_template_postgres_context_is_assignable() — {db} only (no session field at all)
GREEN:   Declare ScopedContext interface
REFACTOR: None expected
VERIFY:  npm run typecheck && npm test -- src/theokit/__tests__/types.test-d.ts
```

#### Acceptance Criteria
- [ ] All 5 type-assertion tests compile + pass
- [ ] `ScopedContext` is exported from `src/theokit/types.ts`
- [ ] Pass: complexity — interface has no runtime code (cyclomatic N/A)
- [ ] Pass: coverage — type-only file, exempt from runtime coverage
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — `src/theokit/types.ts` ≤ 50 lines

#### DoD
- [ ] All tasks completed and validated
- [ ] `npm run typecheck` green
- [ ] Zero lint warnings on new files
- [ ] File-size budget respected

---

## Phase 1: Core Binding

**Objective:** Implement `memoryFromCtx(ctx, memory)` with the 3-state resolver from ADR D4.

### T1.1 — Implement `memoryFromCtx` function in `src/theokit/index.ts`

#### Objective
The core binding function: accepts a `ScopedContext` + a `Memory` instance, returns a `ScopedMemory` rooted at `ctx.session.userId`. Throws `MissingScopeError` for states (b) and (c) per ADR D4.

#### Evidence
Blueprint Recommendation #1: "Ship `@usetheo/memory/theokit` subpath as a single 50-100 LoC module: structural `ScopedContext` interface + `memoryFromCtx(ctx, memory)` function + `MissingScopeError` class".

#### Files to edit
```
src/theokit/index.ts — NEW: implement memoryFromCtx + re-export ScopedContext + MissingScopeError
src/theokit/__tests__/memory-from-ctx.test.ts — NEW: RED tests for all 3 states
```

#### Deep file dependency analysis
- `src/theokit/index.ts` (NEW) — public barrel for the subpath. Imports `Memory`, `ScopedMemory` from `src/core/memory-store.js`; imports `MissingScopeError` from `src/core/errors.js`; imports `ScopedContext` from `./types.js`. NO import from `src/local/` or `src/cloud/` (DIP per `architecture.md § 3`).
- Downstream: `package.json#exports./theokit` (Phase 2), integration tests (Phase 3), scaffolded routes (Phase 4).

#### Deep Dives
- **Function signature:**
  ```ts
  export function memoryFromCtx<T extends ScopedContext>(
    ctx: T,
    memory: Memory
  ): ScopedMemory
  ```
- **3-state resolver logic** (per ADR D4 + edge-case absorption v1.1 EC-3 EC-6):
  1. If `ctx.session` is `undefined` (field absent) → throw `MissingScopeError('binding requires session-bearing TheoKit context — wire createSessionManager first')`.
  2. If `ctx.session` is `null` (unauthenticated) → throw `MissingScopeError('authenticated session required — call requireAuth(ctx.session) first')`.
  3. **Runtime type-guard (v1.1 EC-3 absorption)** — if `typeof ctx.session.userId !== 'string'` OR `ctx.session.userId.trim().length === 0` → same state-(c) error message. Covers: `undefined`, empty string, whitespace-only (EC-6), `any`-escape passing number/object/null (EC-3).
  4. Else → return `memory.user(ctx.session.userId)`.
- **Invariant:** function is pure; no side effects; same `ctx` → same `ScopedMemory` instance shape. **Consumer's `ctx` MUST NOT be mutated** (v1.1 EC-7 absorption — assertion in tests).
- **Edge cases:**
  - `ctx.session.userId === ''` (empty string) — treat as state (c).
  - `ctx.session.userId === '   '` (whitespace-only) — treat as state (c) via `.trim().length === 0` (v1.1 EC-6).
  - `ctx.session.userId === 123 as any` (TypeScript escape) — treat as state (c) via `typeof !== 'string'` (v1.1 EC-3).
  - Future scopes (`sessionId`, `agentId`): NOT resolved in v0.2 — only `userId`. If consumer wants session-tier or agent-tier scoping, they call `memory.session(...)` or `memory.agent(...)` directly. **JSDoc on `memoryFromCtx` MUST surface this** (v1.1 EC-11 DOCUMENT): "v0.2 only resolves the userId tier. Use `memory.session(id)` / `memory.agent(id)` directly for other tiers. Multi-tier auto-resolution may land in v0.3+."
  - `memory` is `null` or `undefined`: TypeScript catches at compile time; runtime no-check by design. **JSDoc MUST surface this** (v1.1 EC-12 DOCUMENT): "This binding does NOT runtime-validate the `memory` parameter — TypeScript's `Memory` type guard is the contract. If you escape the type system, you own the resulting NPE."

#### Tasks
1. Create `src/theokit/index.ts`.
2. Implement `memoryFromCtx` with explicit 3-state branching.
3. Re-export `ScopedContext`, `MissingScopeError` from the barrel (so consumers have a single import).
4. Write RED tests for all 3 states + edge cases.

#### TDD
```
RED:     test_returns_scoped_memory_for_state_a() — ctx.session.userId='alice' → returns memory.user('alice'); assert via spy on memory.user()
RED:     test_throws_for_state_b_session_null() — ctx.session=null → throws MissingScopeError with message containing 'authenticated session required'
RED:     test_throws_for_state_c_session_absent() — ctx={} → throws MissingScopeError with message containing 'session-bearing TheoKit context'
RED:     test_throws_for_state_c_userId_undefined() — ctx.session={pending:{...}} (OAuth round-trip) → throws same as state c
RED:     test_throws_for_state_c_userId_empty_string() — ctx.session.userId='' → throws same as state c
RED:     test_returns_memory_user_id_unchanged() — binding passes userId through without normalization (per blueprint Q7)
RED:     test_userId_whitespace_only_treated_as_state_c() — v1.1 EC-6: ctx.session.userId='   ' or '\n\t' → throws state-c error (via trim().length===0)
RED:     test_userId_non_string_any_escape_treated_as_state_c() — v1.1 EC-3: ctx.session.userId = 123 as any → throws state-c error (via typeof !== 'string')
RED:     test_memory_from_ctx_does_not_mutate_session() — v1.1 EC-7: clone ctx; invoke memoryFromCtx; assert ctx.session.userId === ctxClone.session.userId byte-equal
RED:     test_session_id_in_ctx_ignored_returns_user_scope() — v1.1 EC-8: ctx={session:{userId:'alice',sessionId:'s1'}} → returns memory.user('alice'), NOT memory.session('s1')
GREEN:   Implement memoryFromCtx with 3-state resolver + runtime type-guard
REFACTOR: Extract userId validation into private helper if branches share logic
VERIFY:  npm test -- src/theokit/__tests__/memory-from-ctx.test.ts
```

#### Acceptance Criteria
- [ ] All 6 RED tests pass after GREEN
- [ ] `memoryFromCtx` is importable via `import { memoryFromCtx } from '@usetheo/memory/theokit'` (post Phase 2)
- [ ] Function is pure — no side effects observable via spy on `memory`
- [ ] Pass: complexity — function ≤ 10 cyclomatic (3 if-branches + 1 default)
- [ ] Pass: coverage — 100% on `src/theokit/index.ts` (critical path)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — `src/theokit/index.ts` ≤ 100 lines (per blueprint Recommendation #1 budget)

#### DoD
- [ ] All tasks completed and validated
- [ ] All tests passing — `npm test -- src/theokit/` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint -- src/theokit/`
- [ ] File-size budget respected (target ≤ 100 LoC)

---

## Phase 2: Subpath Export

**Objective:** Wire `@usetheo/memory/theokit` into `package.json` and ensure the main barrel does NOT re-export theokit symbols (per ADR D6).

### T2.1 — Add `./theokit` to `package.json#exports`

#### Objective
Make `@usetheo/memory/theokit` importable as a separate entry point. Verify bundle-size assertion: importing `@usetheo/memory` (default) does NOT pull theokit code.

#### Evidence
ADR D6 mandates separate subpath. `architecture.md § 9` requires synchronized updates to `src/index.ts`, `package.json#exports`, README's "Planned API contract", and a unit test importing through the public path.

#### Files to edit
```
package.json — add ./theokit subpath export
src/index.ts — verify NO re-export of src/theokit (no change expected; assertion is structural)
tests/integration/public-paths.test.ts — APPEND test asserting @usetheo/memory/theokit resolves AND src/theokit is not in @usetheo/memory's import graph
```

#### Deep file dependency analysis
- `package.json` — current `exports` has 2 entries (`.`, `./contract`). Adding `./theokit` follows same shape.
- `src/index.ts` — currently re-exports local-runtime symbols + core; MUST NOT re-export `src/theokit/`.
- `tests/integration/public-paths.test.ts` — appends test for new subpath; bundle-graph check via dynamic import.

#### Deep Dives
- **`package.json` shape:**
  ```json
  "./theokit": {
    "types": "./src/theokit/index.ts",
    "default": "./src/theokit/index.ts"
  }
  ```
- **Bundle-graph assertion:** use `require.resolve` or a tsserver-based check to confirm `@usetheo/memory` does NOT transitively import `src/theokit/*`. v0.1 used this pattern in its public-paths test.
- **Invariant:** consumers running `npm install @usetheo/memory` get the theokit binding for free (subpath available), but pay bundle cost only when they import it.

#### Tasks
1. Edit `package.json` — add `./theokit` to `exports`.
2. Confirm `src/index.ts` has no `export * from './theokit/...'` or named `theokit` re-exports.
3. Append test to `tests/integration/public-paths.test.ts`.

#### TDD
```
RED:     test_subpath_theokit_resolves() — dynamic import('@usetheo/memory/theokit') returns module with memoryFromCtx export
RED:     test_main_barrel_does_not_export_theokit() — import('@usetheo/memory') does NOT have memoryFromCtx key
RED:     test_subpath_exports_scoped_context_type() — types resolved when consumer does `import type { ScopedContext } from '@usetheo/memory/theokit'`
RED:     test_subpath_resolves_under_node16_moduleResolution() — v1.1 EC-9: tsconfig fixture with "moduleResolution":"node16" compiles a snippet `import { memoryFromCtx } from '@usetheo/memory/theokit'`; tsc exit code 0. Same fixture variant with "bundler" + "nodenext".
GREEN:   Add subpath to package.json#exports
REFACTOR: None expected
VERIFY:  npm test -- tests/integration/public-paths.test.ts
```

#### Acceptance Criteria
- [ ] All 3 RED tests pass after GREEN
- [ ] `package.json#exports./theokit` is declared
- [ ] `src/index.ts` does NOT mention `theokit`
- [ ] Pass: complexity — declarative change (cyclomatic N/A)
- [ ] Pass: coverage — public-paths test exercises the new path
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — `package.json` ≤ 500 lines (currently ~80)

#### DoD
- [ ] All tasks completed and validated
- [ ] All tests passing — `npm test -- tests/integration/public-paths.test.ts` green
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings

---

### T2.2 — Update README's "Planned API contract" section

#### Objective
Per `architecture.md § 9`: adding a public export requires README sync. Document `@usetheo/memory/theokit` subpath + `memoryFromCtx` example.

#### Evidence
README currently shows v0.1 local-runtime quickstart but no v0.2 theokit example. Lock-in narrative (CLAUDE.md § Voice and Tone) requires demonstrating the "default-on memory in TheoKit handler" promise.

#### Files to edit
```
README.md — APPEND v0.2 binding example under existing "Planned API contract" OR "How it works" section
```

#### Deep file dependency analysis
- `README.md` — current voice rules apply (per `public-copy.md`): HERO + BODY use aspirational voice; "How it works" downward stays technical-direct.
- Downstream: no source code depends on README; but `discover-blueprint-golden-rule.md` requires README updates to match locked names.

#### Deep Dives
- **Snippet to add:**
  ```ts
  // src/server/routes/notes.ts (TheoKit handler)
  import { defineRoute } from 'theokit/server'
  import { memoryFromCtx } from '@usetheo/memory/theokit'
  import { memory } from '../memory.js' // your app-scoped singleton

  export const POST = defineRoute({
    body: z.object({ text: z.string() }),
    handler: async ({ ctx, body }) => {
      requireAuth(ctx.session)
      await memoryFromCtx(ctx, memory).remember(body.text)
      return { ok: true }
    },
  })
  ```
- **Invariant:** voice rules — no banned terms; no production-ready claims; v0.2 status flag preserved.

#### Tasks
1. Read current `README.md` to find the right insertion point.
2. Add v0.2 binding section with the snippet above + a one-line description of the 3-state resolver.
3. Update README's "Status" section if it cites the binding as Planned (flip to Shipped only after Phase 5 PASS).

#### TDD
```
RED:     None — documentation change has no executable test. Verified via README review in Final Phase Integration Validation.
GREEN:   Write the README section
REFACTOR: None expected
VERIFY:  manual review for voice compliance + locked names alignment
```

#### Acceptance Criteria
- [ ] README contains a `@usetheo/memory/theokit` example using `memoryFromCtx`
- [ ] No banned terms (per `public-copy.md`) in new content
- [ ] No production-ready claims (per `dogfood-golden-rule.md`)
- [ ] Pass: size — `README.md` reasonable growth (≤ +50 lines for this section)

#### DoD
- [ ] All tasks completed and validated
- [ ] Manual voice review PASS
- [ ] No tools to run on .md beyond markdown lint (if installed)

---

### T2.3 — Remove `"private": true` from `package.json` + add publish-gate CI check (absorbs EC-5 + D8)

#### Objective
Make the package publishable to npm. Without this, Phase 5 E2E test cannot exercise the full `npx create-theokit` flow, and PR-B (per D7) cannot resolve `@usetheo/memory@<version>` during scaffold smoke test.

#### Evidence
Edge case review EC-5 (`package.json:5` declares `"private": true` → `npm publish` refused). ADR D8 (stub adapters + publish gate ship together). Discovery plan acceptance criterion #1 implies a real publishable package because consumer-running-`npx create-theokit` is the test.

#### Files to edit
```
package.json — remove "private": true OR set to false
.github/workflows/ci.yml (or equivalent) — APPEND step: npm publish --dry-run (gate)
tests/integration/publish-readiness.test.ts — NEW: assert package.json exposes the right files + no banned keys
```

#### Deep file dependency analysis
- `package.json:5` — single-line removal. Downstream: `npm publish` becomes possible.
- CI workflow — adds publish-dry-run as a gate; PR cannot merge if dry-run fails (missing required field, license issue, file-pattern mismatch, etc.).
- New test file — fast (no network) assertion of package shape pre-publish.

#### Deep Dives
- **Why remove vs `private: false`:** convention. Remove the key entirely; npm defaults to publishable when key is absent.
- **`npm publish --dry-run` checks:** validates `files` glob, `exports` shape, `version` semver, presence of `license` + `repository` (if required by registry). Does NOT actually publish.
- **First publish strategy:** v0.2 cycle's PR-A merge triggers a manual `npm publish --tag next` from a release branch (operator-driven; not automated yet). Tag `next` keeps the install opt-in (`npm install @usetheo/memory@next`) until v1.0 cut.
- **Invariant:** after this task, `npm publish --dry-run` exits 0 on every PR.
- **Edge case:** removing `private` could expose accidentally-committed secrets via tarball. Mitigated by `files` allow-list in package.json (already declared: `src/**/*.ts` + migrations + exclusions for `__tests__/`/`*.test.ts`/`*.test-d.ts`). Test asserts allow-list is intact.

#### Tasks
1. Edit `package.json`: remove the `"private": true` line.
2. Run `npm publish --dry-run` locally to capture errors; fix any (likely none given v0.1 prep).
3. Add CI step to run `npm publish --dry-run` on every PR.
4. Write the publish-readiness test asserting `files` glob + no banned keys.

#### TDD
```
RED:     test_package_json_is_publishable() — read package.json; assert "private" key absent; assert "files" includes src/**/*.ts + migrations; assert no "publishConfig.access":"restricted" (we want public)
RED:     test_publish_dry_run_exits_zero() — execSync('npm publish --dry-run', {stdio:'pipe'}) exit code 0
RED:     test_published_tarball_excludes_tests() — run `npm pack --dry-run`; parse output; assert no path contains "__tests__" or ".test." or "test-d"
GREEN:   Remove "private": true; verify tests pass
REFACTOR: None expected
VERIFY:  npm test -- tests/integration/publish-readiness.test.ts && npm publish --dry-run
```

#### Acceptance Criteria
- [ ] `package.json` has no `"private"` key (or `"private": false`)
- [ ] `npm publish --dry-run` exits 0 locally and in CI
- [ ] Tarball excludes test files (verified via `npm pack --dry-run`)
- [ ] CI gate prevents PR merge if publish-readiness fails
- [ ] Pass: complexity — declarative; N/A
- [ ] Pass: lint — JSON valid

#### DoD
- [ ] All tasks completed and validated
- [ ] CI publish-gate check green on PR
- [ ] Manual verification: `npm pack --dry-run` output does not surface secrets or dev-only files
- [ ] Coordinated with D7: this task enables PR-B's `npm install @usetheo/memory@<version>` resolution

---

## Phase 3: Integration Tests (in parallel with Phase 4)

**Objective:** Exercise the binding against a real `createLocalMemory` instance + ephemeral pgvector container. Prove two distinct userIds produce ZERO overlap on `recall()`.

### T3.1 — Write `tests/integration/theokit-binding.test.ts`

#### Objective
The acceptance-criterion test from the discovery plan: "Isolation test: two distinct user_id values produce disjoint recall() result sets (zero overlap)". Plus a handler-shape test exercising the full POST → remember → DB round-trip.

#### Evidence
Discovery plan acceptance criterion #1: "E2E test in scaffolded TheoKit app: HTTP request with auth header → remember() inside handler persists under correct user_id without explicit scoping in user code".
Discovery plan acceptance criterion #2: "Isolation test: two distinct user_id values produce disjoint recall() result sets (zero overlap)".

#### Files to edit
```
tests/integration/theokit-binding.test.ts — NEW: integration tests using real createLocalMemory + ephemeral pgvector
tests/integration/fixtures/ephemeral-pgvector.ts — REUSE (already exists from v0.1)
```

#### Deep file dependency analysis
- `tests/integration/theokit-binding.test.ts` (NEW) — imports `memoryFromCtx` from `@usetheo/memory/theokit`, `createLocalMemory` from `@usetheo/memory`, ephemeral-pgvector fixture from v0.1.
- `tests/integration/fixtures/ephemeral-pgvector.ts` — already in place from v0.1; spins up real pgvector via testcontainers; resets DB between tests per `testing.md § Determinism`.
- Downstream: this is the test that gates Phase 5 (e2e).

#### Deep Dives
- **Test 1 — Handler shape:**
  ```ts
  it('persists memory under correct userId when handler calls memoryFromCtx', async () => {
    const memory = await createLocalMemory({ /* ephemeral pgvector + stubbed LLM */ })
    const ctx = { session: { userId: 'alice', email: 'alice@example.com' } }
    await memoryFromCtx(ctx, memory).remember('Paulo likes coffee')
    const results = await memory.user('alice').recall('beverages')
    expect(results.some(r => r.text.includes('coffee'))).toBe(true)
  })
  ```
- **Test 2 — Isolation:**
  ```ts
  it('produces disjoint recall result sets for two distinct userIds', async () => {
    const memory = await createLocalMemory({ /* ... */ })
    await memoryFromCtx({ session: { userId: 'alice' } }, memory).remember('Alice secret')
    await memoryFromCtx({ session: { userId: 'bob'   } }, memory).remember('Bob secret')
    const alice = await memory.user('alice').recall('secret')
    const bob   = await memory.user('bob').recall('secret')
    // ZERO overlap
    const intersect = alice.filter(a => bob.some(b => b.id === a.id))
    expect(intersect).toEqual([])
  })
  ```
- **Test 3 — 3-state resolver under real handler:**
  - Unauthed (`ctx.session=null`) → `memoryFromCtx` throws `MissingScopeError`.
  - No session field (`ctx={}`) → `memoryFromCtx` throws `MissingScopeError`.
- **Invariant:** each test resets DB; no shared state between tests (per `testing.md § Anti-patterns`).
- **Performance:** mark `@slow` if container spin-up exceeds 5s; v0.1's fixture pattern keeps it under 3s typically.

#### Tasks
1. Write `tests/integration/theokit-binding.test.ts` with 3 test cases.
2. Confirm ephemeral-pgvector fixture reuse works (no copy-paste).
3. Run locally; assert all green.

#### TDD
```
RED:     test_persists_under_correct_userId() — handler-shape test
RED:     test_two_distinct_userIds_have_zero_overlap() — isolation test
RED:     test_unauthed_ctx_throws_missing_scope_error() — state (b)
RED:     test_no_session_field_throws_missing_scope_error() — state (c)
GREEN:   No new production code — Phases 1+2 provide the implementation
REFACTOR: Extract shared fixture setup into beforeEach if duplicated
VERIFY:  npm test -- tests/integration/theokit-binding.test.ts
```

#### Acceptance Criteria
- [ ] All 4 integration tests pass against real pgvector container
- [ ] DB state isolated between tests (per `testing.md § Determinism`)
- [ ] Pass: complexity — each test ≤ 10 cyclomatic
- [ ] Pass: coverage — adds to overall integration coverage (target 90%+)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — test file ≤ 500 lines

#### DoD
- [ ] All tasks completed and validated
- [ ] `npm test -- tests/integration/theokit-binding.test.ts` green
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] Test runtime ≤ 30s (per `testing.md` integration guidance)

---

## Phase 4: Template Integration (in parallel with Phase 3)

**Objective:** Edit `../theokit/packages/create-theo/templates/{saas,postgres}/` to default-on memory. Extend `bare-transform.ts` for symmetry.

### T4.1 — Add `@usetheo/memory` to saas + postgres template `package.json.tmpl`

#### Objective
Default-on memory in DB-bearing scaffolded templates (per ADR D3). Templates without sessions (`default`, `api-only`, `dashboard`) are NOT touched.

#### Evidence
Blueprint Recommendation #2 lists exact files to edit. Blueprint Q4 evidence shows the existing `package.json.tmpl` shape.

#### Files to edit
```
../theokit/packages/create-theo/templates/saas/package.json.tmpl — add "@usetheo/memory": "^0.1.0" to dependencies
../theokit/packages/create-theo/templates/postgres/package.json.tmpl — same
../theokit/packages/create-theo/tests/scaffold.test.ts — APPEND snapshot test asserting scaffolded output contains the dep (if test infra supports)
```

#### Deep file dependency analysis
- `templates/saas/package.json.tmpl` — currently 31 lines; one-line addition.
- `templates/postgres/package.json.tmpl` — same shape.
- TheoKit's existing test infra (if any) — append rather than create.

#### Deep Dives
- **Version constraint** (v1.1 EC-1 absorption): cannot be `"^0.1.0"` while TheMemory ships `0.0.0-rc.X` pre-releases — `^0.1.0` rejects `0.0.x` per semver. Resolution per D7+D8:
  - **PR-A (this repo)** publishes `@usetheo/memory@0.1.0-next.0` (or similar) with `--tag next` AFTER T2.3 + T4.5 land.
  - **PR-B (theokit repo)** templates declare `"@usetheo/memory": "^0.1.0-next.0"` to match the published tag.
  - Once v1.0 cuts (post-roadmap Item 11), templates bump to `"^1.0.0"`.
- **Why not `workspace:*`:** scaffolded apps live OUTSIDE the monorepo by definition. `workspace:` protocol only resolves inside pnpm/yarn workspaces. Real consumers running `npx create-theokit my-app` get a directory that's NOT in the TheMemory workspace.
- **Edge case:** between PR-A merge (publish) and PR-B merge (template update), `npx create-theokit` from the previous theokit release does NOT include memory — acceptable per D7 rollback note ("default-on becomes a follow-up").
- **Invariant:** sort order of dependencies preserved (matches existing convention).

#### Tasks
1. Edit `templates/saas/package.json.tmpl` — add the dep.
2. Edit `templates/postgres/package.json.tmpl` — same.
3. Append snapshot test (if TheoKit's test framework supports scaffold snapshots).

#### TDD
```
RED:     test_scaffolded_saas_has_memory_dep() — scaffold a temp dir; parse package.json; assert "@usetheo/memory" in dependencies
RED:     test_scaffolded_postgres_has_memory_dep() — same for postgres template
GREEN:   Add the dep line to both .tmpl files
REFACTOR: None expected (declarative)
VERIFY:  cd ../theokit/packages/create-theo && npm test -- scaffold
```

#### Acceptance Criteria
- [ ] Both .tmpl files contain `"@usetheo/memory"` in `dependencies`
- [ ] Snapshot tests (if applicable) pass
- [ ] Pass: complexity — declarative; N/A
- [ ] Pass: lint — JSON is valid
- [ ] Pass: size — files still ≤ 50 lines each

#### DoD
- [ ] All tasks completed and validated
- [ ] TheoKit's test suite green (if scaffold test exists)
- [ ] Manual review confirms JSON validity (no trailing commas, proper quoting)

---

### T4.2 — Add demo `server/routes/memory.ts` to saas + postgres templates

#### Objective
Provide a working demo route exercising `memoryFromCtx(ctx).remember(text)` so the scaffolded consumer sees the lock-in surface immediately.

#### Evidence
Blueprint Recommendation #3 specifies file paths + handler shape derived from Q4 (template-saas/routes/me.ts pattern).

#### Files to edit
```
../theokit/packages/create-theo/templates/saas/server/routes/memory.ts — NEW: demo handler
../theokit/packages/create-theo/templates/postgres/server/routes/memory.ts — NEW: demo handler
```

#### Deep file dependency analysis
- Both files are NEW. Each imports `defineRoute`, `requireAuth` from `theokit/server`; imports `memoryFromCtx` from `@usetheo/memory/theokit`; imports a singleton `memory` from `../memory.js` (consumer scaffolds this file too — T4.3).
- Pattern mirrors existing `templates/saas/server/routes/me.ts` from Q4 evidence.

#### Deep Dives
- **Handler shape:**
  ```ts
  import { defineRoute, requireAuth } from 'theokit/server'
  import { memoryFromCtx } from '@usetheo/memory/theokit'
  import { z } from 'zod'
  import { memory } from '../memory.js'
  import type { RequestContext } from '../context.js'

  export const POST = defineRoute<
    z.ZodUndefined,
    z.ZodObject<{ text: z.ZodString }>,
    z.ZodUndefined,
    RequestContext
  >({
    body: z.object({ text: z.string().min(1) }),
    handler: async ({ ctx, body }) => {
      requireAuth(ctx.session)
      await memoryFromCtx(ctx, memory).remember(body.text)
      return { ok: true }
    },
  })

  export const GET = defineRoute<
    z.ZodObject<{ q: z.ZodString }>,
    z.ZodUndefined,
    z.ZodUndefined,
    RequestContext
  >({
    query: z.object({ q: z.string() }),
    handler: async ({ ctx, query }) => {
      requireAuth(ctx.session)
      const results = await memoryFromCtx(ctx, memory).recall(query.q)
      return { results }
    },
  })
  ```
- **Invariant:** uses TheoKit's existing `requireAuth(ctx.session)` helper to narrow state to (a); binding never sees `ctx.session === null`.
- **Edge case:** `postgres` template's `RequestContext` may not match `saas`'s exactly — verify against `../theokit/fixtures/template-postgres/server/context.ts` (which is `{db}` only). For the `postgres` scaffolded TEMPLATE to support memory, T4.3 must augment `context.ts` to include session — OR ADR-defer postgres template to v0.3.

#### Tasks
1. Write the demo route file for `saas`.
2. Write the demo route file for `postgres` (after confirming context augmentation in T4.3).
3. Update `theokit/packages/create-theo` test snapshots if any.

#### TDD
```
RED:     test_scaffolded_saas_has_memory_route() — assert file exists at expected path
RED:     test_scaffolded_postgres_has_memory_route() — same
RED:     test_memory_route_imports_match_expected() — grep imports in scaffolded file
GREEN:   Write the two route files
REFACTOR: None expected
VERIFY:  cd ../theokit/packages/create-theo && npm test -- scaffold
```

#### Acceptance Criteria
- [ ] Both files exist at expected paths
- [ ] Handler signatures match the shape above
- [ ] Imports point at `@usetheo/memory/theokit` (not `@usetheo/memory`)
- [ ] Pass: complexity — handlers ≤ 10 cyclomatic each
- [ ] Pass: lint — zero warnings (run TheoKit's lint config)
- [ ] Pass: size — both files ≤ 100 lines

#### DoD
- [ ] All tasks completed and validated
- [ ] TheoKit's lint passes on both new files
- [ ] Manual review confirms handler shape

---

### T4.3 — Add singleton `server/memory.ts` to saas + postgres templates

#### Objective
Provide the app-scoped singleton consumer's handlers import. Wires `createLocalMemory` against the template's DB.

#### Evidence
Blueprint Recommendation #5 (template snapshot test): "asserts `package.json` contains `"@usetheo/memory"` AND `server/routes/memory.ts` exists". The singleton file is implied — without it, the demo route doesn't import.

#### Files to edit
```
../theokit/packages/create-theo/templates/saas/server/memory.ts — NEW: createLocalMemory singleton
../theokit/packages/create-theo/templates/postgres/server/memory.ts — NEW: same
../theokit/packages/create-theo/templates/postgres/server/context.ts — augment to include session (currently {db} only)
```

#### Deep file dependency analysis
- `server/memory.ts` (NEW) — instantiates `createLocalMemory` against the template's `pg` Pool; exports a module-scoped `memory` symbol consumed by routes.
- `templates/postgres/server/context.ts` — current state (per blueprint Q5): `export function createContext() { return { db } }`. T4.3 augments to include `session` via `createSessionManager` AND keeps backward compat with existing postgres-template routes.

#### Deep Dives
- **Singleton shape:**
  ```ts
  import { createLocalMemory } from '@usetheo/memory'
  // TODO consumer: pick your LLM + Embedder providers
  // import { OpenAILLM, OpenAIEmbedder } from '@usetheo/memory/openai' (v0.2+ adapter — TBD)
  import { PgvectorStore } from '@usetheo/memory'
  import { pool } from './db/index.js'

  export const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool),
    embedder: /* consumer wires */,
    llm:      /* consumer wires */,
  })
  ```
- **Top-level await:** requires `"type": "module"` in package.json (already set in TheoKit templates per blueprint Q4).
- **Edge case:** consumer doesn't supply LLM/Embedder credentials at scaffold time — the scaffolded template must work as a `npm install` smoke test even without provider keys. Resolution: ship a no-op stub adapter inside the template that throws on first call (consumer replaces).
- **Postgres context augment:** changing `templates/postgres/server/context.ts` from `{db}` to `{db, sessions, session, res}` may break existing postgres-template routes (`users.ts`, `health.ts`). Audit those routes; if breaking change, isolate via ADR.

#### Tasks
1. Write `templates/saas/server/memory.ts` singleton with stub adapters.
2. Write `templates/postgres/server/memory.ts` same.
3. Augment `templates/postgres/server/context.ts` to add session (or ADR-defer postgres-template memory wiring to v0.3 if scope too large).
4. Verify existing postgres-template routes still pass after context augment.

#### TDD
```
RED:     test_scaffolded_saas_memory_module_exports_memory() — dynamic import + assert export shape
RED:     test_scaffolded_postgres_context_has_session() — assert RequestContext type widened
RED:     test_existing_postgres_routes_still_compile() — tsc --noEmit on scaffolded postgres template
GREEN:   Write the singleton + augment context
REFACTOR: None expected
VERIFY:  cd ../theokit/packages/create-theo && npm test -- scaffold + tsc --noEmit on scaffolded output
```

#### Acceptance Criteria
- [ ] Singleton file exists in both templates
- [ ] postgres template's `context.ts` includes session (or ADR-defer)
- [ ] Existing routes in postgres template still compile
- [ ] Stub adapters surface clear "wire your LLM" guidance on first call
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — singleton ≤ 50 lines

#### DoD
- [ ] All tasks completed and validated
- [ ] TheoKit's lint + typecheck pass on scaffolded output
- [ ] If postgres context augment ADR-deferred, plan version bumps + downstream task lifts memory wiring for postgres template

---

### T4.4 — Extend `bare-transform.ts` to strip `@usetheo/memory`

#### Objective
Symmetry with existing `@usetheo/sdk` strip. While `@usetheo/memory` is unpublished, `--bare` must drop it from `package.json` AND `unlinkSync` the demo route file.

#### Evidence
Blueprint Recommendation #4 specifies exact insertion point in `bare-transform.ts:46-64` (existing `delete pkg.dependencies['@usetheo/sdk']` line).

#### Files to edit
```
../theokit/packages/create-theo/src/bare-transform.ts — APPEND memory strip
../theokit/packages/create-theo/tests/bare-transform.test.ts — APPEND RED test
```

#### Deep file dependency analysis
- `bare-transform.ts` — currently 97 lines; one block addition.
- Existing test infra (if any) — append rather than create.

#### Deep Dives
- **Strip block:**
  ```ts
  // After existing @usetheo/sdk strip:
  delete pkg.dependencies['@usetheo/memory']
  // Demo route depends on the strip-target — remove it too
  const memoryRoutePath = join(targetDir, 'server/routes/memory.ts')
  if (existsSync(memoryRoutePath)) {
    unlinkSync(memoryRoutePath)
  }
  const memorySingletonPath = join(targetDir, 'server/memory.ts')
  if (existsSync(memorySingletonPath)) {
    unlinkSync(memorySingletonPath)
  }
  ```
- **Invariant:** `--bare` only applies to `default` template per blueprint Q4. But memory is NOT in the default template (per ADR D3) — so the strip is only relevant if a future expansion adds memory to default. SAFER: implement the strip defensively in case a future contributor adds memory to default by accident.
- **Edge case:** `delete pkg.dependencies['@usetheo/memory']` on an object that doesn't have the key is a no-op — safe.

#### Tasks
1. Append the strip block to `bare-transform.ts` after the existing sdk strip.
2. Append RED test asserting `--bare default` does NOT contain `@usetheo/memory`.
3. Verify existing `--bare default` flow still works.

#### TDD
```
RED:     test_bare_default_does_not_contain_memory() — scaffold default --bare; parse package.json; assert key absent
RED:     test_bare_default_removes_demo_route_if_present() — same, assert no server/routes/memory.ts
GREEN:   Append strip block to bare-transform.ts
REFACTOR: Extract route-strip into helper if pattern repeats
VERIFY:  cd ../theokit/packages/create-theo && npm test -- bare-transform
```

#### Acceptance Criteria
- [ ] Both RED tests pass
- [ ] Existing bare-transform tests still pass (no regression)
- [ ] Pass: complexity — two new conditionals (cyclomatic +2)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — `bare-transform.ts` ≤ 200 lines (currently ~97; safe)

#### DoD
- [ ] All tasks completed and validated
- [ ] TheoKit's test suite green
- [ ] Manual review of strip symmetry vs sdk pattern

---

### T4.5 — Ship `StubEmbedder` + `StubLLM` in `src/local/stubs.ts` (absorbs EC-2 + D8)

#### Objective
Provide deterministic stub adapters so scaffolded `npm install && npm run dev` boots without crashing on the probe call. Consumer sees demo route work BEFORE wiring real OpenAI/Anthropic providers.

#### Evidence
Edge case review EC-2 (singleton scaffoldado requer LLM + Embedder wiring sem fallback funcional; `createLocalMemory` probes embedder no construtor — crash imediato no `npm run dev`). ADR D8 (stub adapters ship together with publish gate).

#### Files to edit
```
src/local/stubs.ts — NEW: StubEmbedder + StubLLM implementations
src/local/__tests__/stubs.test.ts — NEW: RED tests asserting probe-safety + clear error on first non-probe call
src/local/index.ts — APPEND re-exports for StubEmbedder + StubLLM
src/index.ts — APPEND re-exports for StubEmbedder + StubLLM (top-level barrel)
```

#### Deep file dependency analysis
- `src/local/stubs.ts` (NEW) — implements `Embedder` + `LLM` interfaces from `src/core/dip/`. Belongs in `src/local/` (per `architecture.md § 3`: `local/` implements core contracts; stubs are local-runtime artifacts). NO new public API surface beyond exports.
- `src/index.ts` — adds the re-export per `architecture.md § 9` (Public API surface synchronization).
- Downstream: scaffolded templates' `server/memory.ts` (T4.3) imports these stubs as defaults.

#### Deep Dives
- **`StubEmbedder` shape:**
  ```ts
  import { MAX_EMBEDDING_DIM } from '../core/constants.js'
  import type { Embedder } from '../core/dip/embedder.js'

  export class StubEmbedder implements Embedder {
    private warned = false
    async embed(text: string): Promise<readonly number[]> {
      if (text === '__themem_probe__') {
        // Probe path — return correct-dim zero vector; createLocalMemory passes
        return Array(MAX_EMBEDDING_DIM).fill(0)
      }
      if (!this.warned) {
        // Loud guidance on first real embed call (post-probe)
        // eslint-disable-next-line no-console -- demo stub
        console.warn('[StubEmbedder] Replace with your real Embedder (OpenAI/Cohere/etc.) before production use. Returning zero vectors will collapse all memories into a single bucket.')
        this.warned = true
      }
      return Array(MAX_EMBEDDING_DIM).fill(0)
    }
  }
  ```
- **`StubLLM` shape:**
  ```ts
  import type { LLM, ExtractionPrompt } from '../core/dip/llm.js'

  export class StubLLM implements LLM {
    private warned = false
    async extract(prompt: ExtractionPrompt): Promise<readonly { text: string }[]> {
      if (!this.warned) {
        // eslint-disable-next-line no-console -- demo stub
        console.warn('[StubLLM] Replace with your real LLM (OpenAI/Anthropic/etc.) before production use. Returning empty fact arrays disables extraction.')
        this.warned = true
      }
      return []
    }
  }
  ```
- **Probe-safety guarantee:** `StubEmbedder.embed('__themem_probe__')` returns exactly `MAX_EMBEDDING_DIM` zeros — passes `createLocalMemory`'s probe check (`src/local/index.ts:242-247`). No `EmbeddingMismatch` thrown.
- **Single-warning rule:** each stub logs once per instance to avoid log-spam. Subsequent calls silent.
- **Test discipline:** stubs honor `testing.md § Determinism` — deterministic output (zero vectors, empty arrays), no clock dependency, no random.
- **JSDoc on both classes:** `@experimental — for scaffold demo only. Replace with your real provider before production.`
- **Edge case:** if consumer keeps stubs in production, no data loss but ALL memories collide on dedup (same hash for same text) AND retrieval ranks all results identically (zero vectors = zero cosine differentiation). Warning surfaces this loudly.

#### Tasks
1. Write `src/local/stubs.ts` with `StubEmbedder` + `StubLLM` classes.
2. Write RED tests asserting probe-safety + warning emission + deterministic output.
3. Re-export from `src/local/index.ts` and `src/index.ts`.
4. Update README's "Planned API contract" to mention stub fallback (one line under T2.2's binding example).

#### TDD
```
RED:     test_stub_embedder_probe_returns_correct_dim_zeros() — StubEmbedder.embed('__themem_probe__') returns array of MAX_EMBEDDING_DIM zeros
RED:     test_stub_embedder_warns_once_on_first_non_probe_call() — capture console.warn; first non-probe call warns; second call silent
RED:     test_stub_llm_returns_empty_fact_array() — StubLLM.extract({...}) returns []
RED:     test_stub_llm_warns_once_on_first_call() — same warn-once pattern
RED:     test_createLocalMemory_with_stubs_passes_probe() — integration: createLocalMemory({vectorStore: inMemory, embedder: new StubEmbedder(), llm: new StubLLM()}) resolves without throwing
RED:     test_stubs_exported_from_top_level_barrel() — import { StubEmbedder, StubLLM } from '@usetheo/memory' resolves
GREEN:   Implement both stub classes + wire re-exports
REFACTOR: Extract warn-once helper if shared between stubs (>2 occurrences = rule of 3 not yet, keep inline)
VERIFY:  npm test -- src/local/__tests__/stubs.test.ts
```

#### Acceptance Criteria
- [ ] `StubEmbedder` + `StubLLM` exported from `@usetheo/memory` and `@usetheo/memory` (via `src/index.ts`)
- [ ] `createLocalMemory({embedder: new StubEmbedder(), llm: new StubLLM(), vectorStore: ...})` resolves without throwing
- [ ] Single-warning rule verified for both stubs
- [ ] JSDoc `@experimental` tag present on both classes
- [ ] Pass: complexity — each class ≤ 5 cyclomatic
- [ ] Pass: coverage — 100% on stubs.ts
- [ ] Pass: lint — `no-console` exception scoped to stub files only (eslint disable comment)
- [ ] Pass: size — `src/local/stubs.ts` ≤ 100 lines

#### DoD
- [ ] All tasks completed and validated
- [ ] All tests passing — `npm test -- src/local/__tests__/stubs.test.ts` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings (sans the scoped no-console exception)
- [ ] File-size budget respected
- [ ] Coordinated with T4.3: scaffolded singleton imports these stubs as defaults

---

## Phase 5: E2E Test

**Objective:** Spawn the scaffolded saas template in a subprocess; HTTP-POST against the demo route; assert DB row written under correct userId.

### T5.1 — Write `tests/e2e/scaffolded-binding.test.ts`

#### Objective
End-to-end smoke test of the full chain: `create-theo --template=saas` → `npm install` → start server → HTTP POST with auth cookie → DB row exists.

#### Evidence
Discovery plan acceptance criterion #1: "E2E test in scaffolded TheoKit app: HTTP request with auth header → remember() inside handler persists under correct user_id without explicit scoping in user code". Blueprint Recommendation #7.

#### Files to edit
```
tests/e2e/scaffolded-binding.test.ts — NEW: full E2E flow
tests/e2e/fixtures/temp-scaffold.ts — NEW: helper for spawning create-theo in temp dir
package.json — APPEND test:e2e npm script gated by CI=true OR --run flag
```

#### Deep file dependency analysis
- `tests/e2e/scaffolded-binding.test.ts` (NEW) — orchestrates spawn + HTTP + DB assert.
- `tests/e2e/fixtures/temp-scaffold.ts` (NEW) — helper isolates the `create-theo` subprocess invocation; cleanup logic.
- `package.json` — adds `test:e2e` script; `npm test` does NOT run E2E by default (slow).

#### Deep Dives
- **Flow** (order matters per v1.1 EC-10 — symlink BEFORE npm install):
  1. `mkdir tmp-scaffold-{uuid}`
  2. `npx create-theokit my-app --template=saas --skip-install` (skip install in test to avoid registry hit)
  3. **FIRST** create `node_modules/` dir + symlink `node_modules/@usetheo/memory` → repo root (workspace dogfood pattern). NPM will preserve existing symlinks during install.
  4. `npm install` in scaffolded dir — installs OTHER deps; leaves symlinked `@usetheo/memory` intact (verified by test).
  5. Start server in subprocess with test SECRET + ephemeral pgvector URL
  6. HTTP POST `/api/login` to create session cookie
  7. HTTP POST `/api/memory` with body `{text: 'paulo likes coffee'}` + auth cookie
  8. Assert DB row exists in `memories` table with `user_id = 'u-{email}'` (per saas template's login stub)
  9. Cleanup: kill subprocess; rm tmp dir
- **Performance budget:** ≤ 90s total (scaffold + npm install + server start + HTTP + assert). Mark `@slow`; gate behind `CI=true`.
- **Edge cases:**
  - `create-theo` not built in repo — test SKIPS with honest message if `../theokit/packages/create-theo/dist/` missing.
  - Port collision — pick random free port via `node:net` `server.address().port`.
  - Cleanup on test failure — `afterAll` always runs cleanup even on assertion fail.
  - **Windows platform** (v1.1 EC-13 DOCUMENT): symlink requires admin privileges OR developer-mode flag — skip E2E on Windows via `it.skipIf(process.platform === 'win32')`. Justification: TheoKit + TheMemory target Linux/macOS dev primarily; Windows runtime supported but not test infra.
  - **Symlink + npm install order** (v1.1 EC-10): if npm install runs FIRST, it creates `node_modules/@usetheo/memory` from registry; subsequent symlink fails (path exists) OR overwrites with broken state. Fixture enforces symlink-first order; test verifies `realpath(node_modules/@usetheo/memory)` resolves to repo root.

#### Tasks
1. Write `temp-scaffold.ts` helper.
2. Write the E2E test orchestrator.
3. Add `test:e2e` npm script.
4. Document slow-test gating in README.

#### TDD
```
RED:     test_e2e_scaffolded_saas_persists_memory() — full flow asserts DB row
RED:     test_e2e_unauthed_request_returns_401() — POST without cookie → handler's requireAuth throws → 401
RED:     test_temp_scaffold_install_order_correct() — v1.1 EC-10: after fixture setup, realpath(node_modules/@usetheo/memory) === repo root path (symlink intact, not overwritten by npm install)
RED:     test_e2e_skipped_on_windows() — v1.1 EC-13: process.platform==='win32' branch — test marked skipIf; verified via it.skipIf signature on win32 CI runner (or noop locally)
GREEN:   Implement the flow (no new src/ code; everything from Phases 0-4)
REFACTOR: Extract HTTP-client helper if duplicated across e2e tests
VERIFY:  npm run test:e2e
```

#### Acceptance Criteria
- [ ] E2E test passes against real scaffolded app + ephemeral pgvector
- [ ] Test isolated — no leaked subprocesses or temp dirs after run
- [ ] Test SKIPs gracefully if create-theo dist missing (CI honesty)
- [ ] Pass: complexity — orchestrator function ≤ 15 cyclomatic (E2E tests get a higher budget per `testing.md`)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — test file ≤ 300 lines

#### DoD
- [ ] All tasks completed and validated
- [ ] `npm run test:e2e` green on local + CI
- [ ] Zero leaked processes / temp dirs (verified via `ps` after run)
- [ ] Runtime under 90s budget

---

## Phase 6: Documentation + CHANGELOG

**Objective:** Honesty discipline (Inquebrável Rule 6) — every shipped feature appears in CHANGELOG. README sync (T2.2 already partial) finalized post-Phase 5.

### T6.1 — CHANGELOG.md entry under `[Unreleased]`

#### Objective
Per CLAUDE.md root § 6 and v0.1's discipline: every code change updates CHANGELOG.md. The file does NOT exist in repo yet — Phase 6 creates it (or appends if v0.1 created it earlier).

#### Evidence
Inquebrável Rule 6 ("Changelogs are not optional"); roadmap Item 3 Acceptance Criterion implicitly requires it.

#### Files to edit
```
CHANGELOG.md — NEW or APPEND under [Unreleased]
```

#### Deep file dependency analysis
- `CHANGELOG.md` — if missing, create with `[Unreleased]` section. If present (from v0.1), append v0.2 entries.

#### Deep Dives
- **Entry shape (per CLAUDE.md root § 6):**
  ```markdown
  ## [Unreleased]

  ### Added
  - `@usetheo/memory/theokit` subpath with `memoryFromCtx(ctx, memory)` auto-scoping function (#PR-NUMBER)
  - `MissingScopeError` typed error for 3-state scope resolution (#PR-NUMBER)
  - Default-on memory in `create-theo` scaffolded `saas` + `postgres` templates (#PR-NUMBER)
  - E2E test exercising scaffolded-app → HTTP POST → memory persistence flow (#PR-NUMBER)
  ```
- **Invariant:** every entry has a ticket/PR reference per CLAUDE.md root § 6.

#### Tasks
1. Check if `CHANGELOG.md` exists.
2. Create or append under `[Unreleased]`.
3. Fill in PR numbers after PR is opened (post-Phase 5).

#### TDD
```
RED:     None — documentation. Verified via Final Phase Integration Validation grep for v0.2 entries.
GREEN:   Write the entries
REFACTOR: None expected
VERIFY:  grep "@usetheo/memory/theokit" CHANGELOG.md
```

#### Acceptance Criteria
- [ ] CHANGELOG.md contains v0.2 entries under `[Unreleased]`
- [ ] Each entry has a PR ref (populated post-merge)
- [ ] Categories match Keep-a-Changelog spec (Added / Changed / Fixed / etc.)
- [ ] Pass: lint — markdown valid

#### DoD
- [ ] All tasks completed and validated
- [ ] Manual review by maintainer

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Subpath `@usetheo/memory/theokit` resolves | T2.1 | `package.json#exports` declares `./theokit` |
| 2 | `memoryFromCtx(ctx, memory)` returns ScopedMemory for state (a) | T1.1 | Function implemented; covered by unit + integration tests |
| 3 | State (b) — `session: null` throws MissingScopeError | T0.1 + T1.1 + T3.1 | Error class declared; resolver throws; integration test asserts |
| 4 | State (c) — session field absent throws MissingScopeError | T0.1 + T1.1 + T3.1 | Same chain |
| 5 | Two distinct userIds produce disjoint recall result sets (zero overlap) | T3.1 | Integration test asserts intersection empty |
| 6 | Scaffolded saas template includes `@usetheo/memory` dep | T4.1 | Template `package.json.tmpl` edited |
| 7 | Scaffolded postgres template includes `@usetheo/memory` dep | T4.1 | Same |
| 8 | Scaffolded saas template includes demo `server/routes/memory.ts` | T4.2 | New file in template |
| 9 | Scaffolded postgres template includes demo `server/routes/memory.ts` | T4.2 + T4.3 | New file + context augment (or ADR-defer) |
| 10 | Scaffolded templates include singleton `server/memory.ts` | T4.3 | New file in both templates |
| 11 | `--bare default` strips `@usetheo/memory` (symmetry with sdk strip) | T4.4 | `bare-transform.ts` extended |
| 12 | E2E scaffolded-app flow: HTTP POST → DB row | T5.1 | New E2E test with subprocess + HTTP client |
| 13 | E2E unauthed request returns 401 | T5.1 | Same test file |
| 14 | Structural typing on ctx (no peer-dep on theokit) | T0.2 | `ScopedContext` declared structurally; bundle-size assertion in T2.1 |
| 15 | ZERO `AsyncLocalStorage` usage in binding | T1.1 | Function is pure arg-passed; verified by grep + code review |
| 16 | Bundle isolation — `@usetheo/memory` does not pull `src/theokit/` | T2.1 | Public-paths test asserts |
| 17 | README documents the new subpath + example | T2.2 | README sync per architecture.md § 9 |
| 18 | CHANGELOG entries for v0.2 features | T6.1 | New CHANGELOG.md or append |
| 19 | Lock-in surface positioning honored in public copy | T2.2 + T6.1 | Voice rules per public-copy.md applied; no banned terms |
| 20 | DIP boundary: `src/theokit/` does not import from `src/local/` or `src/cloud/` | T1.1 | architecture.md § 3 enforced; `.claude/hooks/boundary-check.sh` blocks |
| 21 | Anchor scenario (Claude Code auto-memory backed by TheMemory) survives plan | T6.1 + Final Phase | `/dogfood` re-verified post-PR in Final Phase Acceptance; T6.1 CHANGELOG entries don't introduce production-grade claims |
| 22 | All 5 fixture variants from blueprint Q5 represented in `ScopedContext` | T0.2 | Type-only tests for 5 fixture shapes |
| 23 | v1.1 EC-1: Version constraint mismatch (`^0.1.0` vs `0.0.0-rc.X`) | T4.1 + T2.3 + D7 + D8 | PR-A publishes `@usetheo/memory@0.1.0-next.0`; PR-B templates declare `^0.1.0-next.0` |
| 24 | v1.1 EC-2: Scaffolded singleton crashes on probe without LLM/Embedder | T4.5 + D8 | `StubEmbedder` returns correct-dim zeros; `StubLLM` returns empty fact array; probe passes |
| 25 | v1.1 EC-3: Runtime type-guard for `userId` (any-escape protection) | T1.1 | `typeof userId !== 'string'` check + `.trim().length === 0` |
| 26 | v1.1 EC-4: Cross-repo PR coordination protocol | T2.3 (publish gate per D7) | T2.3 enforces the npm publish gate that PR-A → PR-B ordering depends on per ADR D7 |
| 27 | v1.1 EC-5: `package.json` `"private": true` blocks publish | T2.3 + D8 | Remove flag; CI publish-dry-run gate |
| 28 | v1.1 EC-6: Whitespace-only userId | T1.1 | `.trim().length === 0` covers it; test added |
| 29 | v1.1 EC-7: Binding does not mutate consumer's `ctx` | T1.1 | Pure function assertion test |
| 30 | v1.1 EC-8: `sessionId`/`agentId` in ctx silently ignored | T1.1 + T0.2 | Test confirms; JSDoc surfaces decision |
| 31 | v1.1 EC-9: Subpath resolves under `moduleResolution: "node16"/"bundler"` | T2.1 | TSConfig fixture tests |
| 32 | v1.1 EC-10: Symlink + npm install order in E2E fixture | T5.1 | Symlink BEFORE npm install; realpath assertion |
| 33 | v1.1 EC-11: Future-tier expansion documented in JSDoc | T1.1 | JSDoc on `memoryFromCtx` |
| 34 | v1.1 EC-12: Runtime no-check on `memory` parameter documented | T1.1 | JSDoc on `memoryFromCtx` |
| 35 | v1.1 EC-13: E2E test skipped on Windows | T5.1 | `it.skipIf(process.platform === 'win32')` |

**Coverage: 35/35 gaps covered (100%)** — incl. 13 absorbed from edge case review v1.1.

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npm test` green (unit + integration) AND `npm run test:e2e` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (per `.claude/rules/architecture.md § Module hygiene`; `src/theokit/index.ts` ≤ 100 LoC per blueprint Recommendation #1)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Inquebrável Rule 6)
- [ ] Backward compatibility preserved across public API (`src/index.ts` unchanged; new subpath additive)
- [ ] `@usetheo/memory/theokit` subpath import works end-to-end
- [ ] Scaffolded `saas` template contains `@usetheo/memory` dep + demo route + singleton (template snapshot test)
- [ ] Scaffolded `postgres` template same (OR ADR-defer documented in plan v1.1)
- [ ] `--bare default` strip symmetry verified
- [ ] Zero `AsyncLocalStorage` / `async_hooks` references introduced in `src/theokit/`
- [ ] DIP boundary enforced — `src/theokit/` only imports from `src/core/`
- [ ] **Runtime-metric proof** — the binding's 3-state resolver is exercised by integration test runs (state (a), (b), (c) each fire at least once in `tests/integration/theokit-binding.test.ts`); the isolation test produces ZERO overlap on disjoint userId recall sets (`expect(intersect).toEqual([])` evaluates green)
- [ ] **Anchor scenario unaffected** — `/dogfood` returns `EVIDENCE_SUFFICIENT` post-PR (anchor scenario "Claude Code auto-memory backed by TheMemory" still `running`)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has been merged to `main`, move `.claude/knowledge-base/plans/v0-2-theokit-binding-plan.md` to `.claude/knowledge-base/plans/completed/v0-2-theokit-binding-plan.md`. NEVER move before merge.

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER all implementation phases are complete. The plan is NOT done until the integration validation chain passes.

**Objective:** Validate that the implemented changes work in a real workload — not just isolated unit tests.

### Execution

Run the full validation chain:

```
npm test                        # unit + integration tests
npm run test:coverage           # coverage report (≥ 90% on changed files; 100% on src/theokit/)
npm run typecheck               # zero TS errors
npm run lint                    # zero lint warnings
npm run test:e2e                # E2E scaffolded-app flow
```

Plus the post-implementation dogfood re-check:

```
# Invoke /dogfood to confirm anchor scenario still running
# (manual: re-run the skill and assert verdict ≥ EVIDENCE_WITH_CAVEATS)
```

### Acceptance Criteria

- [ ] All test suites green (unit + integration + e2e)
- [ ] Coverage ≥ 90% on changed files; 100% on `src/theokit/` (critical path)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] Runtime-metric proof — 3-state resolver exercised; isolation test green
- [ ] Bundle isolation — `@usetheo/memory` (default) does not pull `src/theokit/`
- [ ] DIP boundary verified — `src/theokit/` imports only from `src/core/` (grep + boundary-check.sh)
- [ ] `/dogfood` returns `EVIDENCE_SUFFICIENT` (anchor scenario unaffected)

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing (use `git diff main` baseline).
2. Fix all plan-caused failures before declaring the plan complete.
3. Re-run the validation chain to confirm fixes.
4. Pre-existing issues are logged but do NOT block plan completion (document in PR description).
