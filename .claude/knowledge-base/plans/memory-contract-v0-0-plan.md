# Plan: Memory Contract v0.0

> **Version 1.2** — Ship the v0.0 type-only contract for `@usetheo/memory` (no runtime code yet), composed of: the public `Memory` / `MemoryStore` / `MemoryConfig` surface, four DIP interfaces (`VectorStore`, `LLM`, `Embedder`, `HistoryManager`) plus `ReflectionPolicy`, supporting types (scope, payload, options, errors), and nine ADRs that lock every load-bearing decision (four from `CLAUDE.md § Roadmap Item 1` + five from `CLAUDE.md § Open questions`). Downstream items v0.1–v1.4 implement against this surface without revisiting the public shape — the contract is the contract for the full v1.0 destination.
>
> **Change log:**
> - **v1.1 → v1.2 (2026-05-22)** — Absorbed `/deps-audit` findings from `.claude/knowledge-base/audits/memory-contract-v0-0-deps-audit-2026-05-22.md` (verdict FAIL_MEDIUM → after corrections, PASS expected). **Two version bumps:** `vitest` ^1.5.0 → ^4.0.0 (resolves F1-F4: 4 MEDIUM CVEs chained vitest → vite → esbuild → vite-node, all GHSA-67mh-4wv8-2f99 + GHSA-4w7w-66w2-5vf9); `typescript-eslint` ^7.0.0 → ^8.0.0 (resolves F5: peer-dep conflict with eslint@^9.0.0 — v8.x added eslint 9+10 support). Rule 9 columns refreshed inline. Audit preamble added to `## Dependencies` section.
> - **v1.0 → v1.1 (2026-05-22)** — Absorbed 11 edge cases from `.claude/knowledge-base/reviews/memory-contract-v0-0-edge-cases-2026-05-22.md`. **4 MUST FIX:** EC-1 (`MemoryConfig` + `CloudMemoryConfig` defined in T2.5 Deep Dive); EC-2 (`Object.setPrototypeOf` mandatory in every error constructor in T2.4); EC-3 (`package.json#exports./contract.default` points to the same file, not `null`, in T4.1); EC-4 (Phase 5 grep gates use context-aware exclusions). **3 RECOMMENDED TESTS:** EC-5 (`asOf` JSDoc + runtime-divergence type-test added to T2.5); EC-6 (`VectorStore.getUserId/setUserId` contract clarification added to T3.3); EC-7 (ESLint smoke test added to T0.3; `eslint-plugin-import` added to `## Dependencies`). **4 DOCUMENT:** EC-8 (additive-only CLAUDE.md edits noted in T1.2); EC-9 (`MemoryItem.metadata` flat-primitives limitation JSDoc in T2.2); EC-10 (`LLM.tools` opaque-shape JSDoc in T3.1); EC-11 (npm name reservation verification added to T0.1 DoD).

## Goal

> "Enable `@usetheo/sdk` agents and TheoKit consumers to compile-check against a frozen v0.0 type contract for `@usetheo/memory` so that the v0.1 local runtime and downstream items v0.2–v1.4 can be implemented without revising public API shape, measured by `npx tsc --noEmit -p tsconfig.contract.json` returning exit code 0 with all four DIPs declared and nine ADRs filed under `docs/adrs/`."

## Context

**What exists today.** TheMemory is greenfield. The repo at `/home/paulo/Projetos/usetheo/theo-memory/` ships only foundation artifacts: `README.md`, `CLAUDE.md` (locked design + roadmap), `CHANGELOG.md` skeleton, `.claude/rules/` (architecture/testing/public-copy + cycles + golden rules), the `referencia/` clones (Mem0/Letta/LangMem; read-only; gitignored), and `docs/` empty. No `src/`, no `package.json`, no `tsconfig.json`, no test setup. `git status` is clean on `main`.

**What's missing.** Roadmap Item 1 (`v0.0 — Contract design`) is `In progress` per `CLAUDE.md § Macro roadmap`. Its acceptance criteria:

- `tsc --noEmit` passes on `docs/contract/*.ts`
- Four DIP interfaces declared (`VectorStore`, `LLM`, `Embedder`, `HistoryManager`)
- One ADR per locked decision (Mem0-shape, three-scope, ADD-only, API verbs) under `docs/adrs/`

**What's pending (from `CLAUDE.md § Open questions`).** Five questions MUST be locked before v0.0 ships, because the contract IS those decisions:

- Q2 — `update()` semantics inside ADD-only
- Q3 — Reflection trigger (background / explicit / threshold)
- Q4 — Bi-temporal `t_valid` / `t_invalid` columns on local
- Q5 — Entity store opt-out (`entityBoost: false` flag)
- Q6 — `THEOKIT_API_KEY` reuse for cloud auth

**Evidence motivating this work NOW (not later).**

- Strategic destination locked at v1.0 (Item 11) with 15 roadmap items and Phase II/III/IV depending on v0.0 stability — every later item compiles against this surface.
- Mem0-ts reference shows the four-DIP shape works in production (`referencia/mem0/mem0-ts/src/oss/src/{storage,vector_stores,llms,embeddings}/base.ts` — verified to exist).
- Cloud runtime (v0.5) depends on Theo PaaS GA; surfaces the bi-temporal moat — must decide Q4 schema posture now or face migration pain at v0.5.
- Dogfood gate is LOCKED day-0 (`.claude/rules/dogfood-golden-rule.md`); we cannot make `production-ready` claims regardless, so quality on the contract is what carries us to v1.0.

**What `referencia/` confirms.** Mem0-ts ships four base interfaces (`Embedder`, `LLM`, `VectorStore`, `HistoryManager`) that map 1:1 onto our planned DIPs (Architectural Decision §3 in `architecture.md`). Their public `Memory` class exposes `add / get / search / update / delete / deleteAll / history / reset / getAll` — we diverge by renaming to `remember / recall / forget / reflect`, eliminating public `update()`, and keeping `get / getAll / history / reset` for parity.

## Objective

- [ ] Sub-goal 1 — `docs/contract/` directory exists with the seven canonical TypeScript files defining `Memory`, `MemoryStore`, scope types, DIPs, errors, options, and a single barrel `index.ts`.
- [ ] Sub-goal 2 — Four DIP interfaces declared verbatim with the method counts locked in `D8` (and only those methods; no leakage).
- [ ] Sub-goal 3 — Nine ADRs filed at `docs/adrs/ADR-000{1..9}-*.md` with alternatives + rationale + consequences sections present and non-empty (MADR 3.0-aligned shape).
- [ ] Sub-goal 4 — `tsconfig.contract.json` compiles `docs/contract/**/*.ts` under `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitAny: true`, with zero diagnostics.
- [ ] Sub-goal 5 — Type-level invariant tests (file `docs/contract/__tests__/contract.test-d.ts`) assert: scope narrowing (`memory.user(id)` returns User-scoped type), ADD-only (no `update` on public surface), forget-then-remember mutation path resolves, reflection promise return type is `Promise<ReflectionResult>`, and the four DIPs are structurally compatible with synthetic implementations.
- [ ] Sub-goal 6 — `package.json` exports map declared but `"private": true` until v0.1 (no publish path yet; types live in `docs/contract/` for inspection, not in `src/` for distribution — v0.1 moves them).
- [ ] Sub-goal 7 — `CHANGELOG.md` `[Unreleased]` section gains one `Added` entry referencing this plan's slug.

## ADRs

> Each ADR below ALSO ships as a standalone `docs/adrs/ADR-000N-{slug}.md` file in MADR 3.0 shape (Status / Context / Decision / Consequences / Alternatives). The summaries below are the plan's normative version; the standalone files are derivative artifacts.

### D1 — Mem0-shape architecture (locked, ratified)

- **Decision.** Adopt Mem0's six-phase write pipeline + nine-step search + additive scoring + hash-only dedup + UUID/integer mapping + auto-detected embedding dim + `infer: false` escape hatch + per-row fallback paths at every I/O boundary (batch failure → per-item retry). Diverge on public verbs (`remember/recall/forget/reflect`), ADD-only (no public `update()`), and three-tier vocabulary (User/Session/Agent).
- **Rationale.** Mem0 is the production-tested baseline (`referencia/mem0/`, Apache-2.0). Inquebrável Rule 9 (Não Reinvente a Roda) — adopt the proven pipeline shape. The divergences are public-surface ergonomics, not architecture. Cited rules: `.claude/rules/architecture.md § 4 Mem0-shape architecture` (explicit list of patterns to adopt, diverge, defer).
- **Consequences.**
  - Enables: clean inheritance of Mem0's hard-won lessons (anti-hallucination integer mapping, sigmoid normalization, BM25-vs-semantic gating).
  - Constrains: cannot drift into Letta's function-calling-driven memory (kept as separable agent-tools layer at v0.3) or Zep's bi-temporal-first (kept as cloud-tier feature at v0.5).
  - Reversible? Partially. Public verb rename is hard to undo post-v1.0; architecture choices are reversible per item (e.g., scoring strategy is already pluggable per `D7`).
- **Alternatives evaluated.**
  - **Letta-shape (function-calling memory).** Rejected — would conflate primitive with framework; we are infrastructure, they are agent loop.
  - **Zep/Graphiti-shape (graph-first).** Rejected — heavyweight backend (Neo4j); we ship pgvector first, optional graph at v1.3.
  - **From-scratch.** Rejected — violates Rule 9; Mem0 already paid the iteration cost.

### D2 — Three-tier scope (User / Session / Agent)

- **Decision.** Public API exposes three sub-objects: `memory.user(id)`, `memory.session(id)`, `memory.agent(id)`. Internally these compose into Mem0's `{ user_id, agent_id, run_id }` filter shape (renaming only `run_id → session_id`). Tier vocabulary is locked per `CLAUDE.md § Locked names`.
- **Rationale.** TypeScript narrowing is much stronger when the call shape is `memory.user(id).remember(...)` than when it's `memory.remember(text, { userId })` — the sub-object form lets the compiler infer scope downstream. Cited: `.claude/rules/architecture.md § 1 Three-tier scope` + `.claude/rules/testing.md § What to test` (scope object built correctly is a unit-test target).
- **Consequences.**
  - Enables: scoped-call type narrowing; clearer mental model for consumers; trivial mapping onto Mem0's existing filter shape internally.
  - Constrains: a fourth tier requires strategic review (architecture.md §1); cannot collapse to a single global namespace.
  - Reversible? Hard. Public sub-object API is load-bearing for type narrowing — renaming or collapsing breaks every consumer.
- **Alternatives evaluated.**
  - **Flat API with options bag (`memory.remember(text, { userId, sessionId, agentId })`).** Rejected — loses type narrowing, increases ambiguity (which tier wins if multiple provided?).
  - **Single tier ("just `user_id`").** Rejected — TheoKit binding (v0.2) needs session_id resolution from request context; agent_id is required for the v0.3 agent-tools layer.
  - **Mem0's tier names (`run_id` instead of `session_id`).** Rejected — public copy uses "Session" (per `public-copy.md § 2` locked positioning anchors); internal filter key `session_id` is intentional rename.

### D3 — ADD-only public API (no `update()`)

- **Decision.** Public surface has NO `update()` method. The LLM-extraction pipeline absorbs semantic merge inside the next `remember()` write. Consumers mutate via `forget(memoryId) + remember(newText)`. `history(memoryId)` exists for audit.
- **Rationale.** Per `CLAUDE.md § Architectural Decisions Locked #4` (ADD-only is one of four root-level lockes). Holding the line here is what makes the architecture predictable: every memory event becomes a new fact with hash deduplication; semantic merge is the LLM's job; no in-place mutation primitives leak side-effects through the API. Cited: `.claude/rules/architecture.md § 2 ADD-only by design`. Resolves `CLAUDE.md § Open questions Q2`.
- **Consequences.**
  - Enables: clean event-log semantics; trivial reasoning about audit history; no race conditions on concurrent updates (last write doesn't lose).
  - Constrains: consumers who want "patch this fact text" must use `forget + remember`. Slight ergonomic cost; documented in API reference.
  - Reversible? Hard — undoing ADD-only post-v1.0 introduces silent semantic merge changes for existing consumers.
- **Alternatives evaluated.**
  - **Mem0's `update(id, text)` adopted as-is.** Rejected — adds destructive update path; complicates reasoning; we explicitly diverge (architecture.md §2).
  - **`replace(id, text)` (sugar over `forget + remember` atomically).** Rejected for v0.0 — pollutes API surface; same outcome achievable with two calls; reconsider at v1.1+.

### D4 — API verbs (`remember / recall / forget / reflect`)

- **Decision.** Public verbs are exactly `remember(text, options?)`, `recall(query, options?)`, `forget(memoryId)`, `reflect(options?)`. Plus four parity helpers from Mem0: `get(memoryId)`, `getAll(options)`, `history(memoryId)`, `reset()`.
- **Rationale.** Verbs are user-facing copy; aspirational voice per `.claude/rules/public-copy.md § 5`. `remember/recall/forget/reflect` is the locked vocabulary from `CLAUDE.md § Locked names`. The parity helpers (`get/getAll/history/reset`) keep the API discoverable for Mem0 emigrants without polluting the headline.
- **Consequences.**
  - Enables: marketing copy aligns with API ("remembers what your agent learned, across sessions, automatically"); no verb mismatch between docs and code.
  - Constrains: the verbs cannot be renamed without strategic review (CLAUDE.md § Locked names — strategic? = yes for all four).
  - Reversible? Effectively no after v1.0 publish.
- **Alternatives evaluated.**
  - **Mem0 verbs (`add/search/delete`).** Rejected — public copy commitment is "remember/recall/forget/reflect".
  - **CRUD-style (`create/read/update/delete`).** Rejected — collides with D3 (no `update`) and loses the cognitive-science framing that justifies "Memory" branding.

### D5 — Reflection trigger: explicit-only in v0.0, policy interface declared

- **Decision.** v0.0 contract types `reflect()` as an **explicit awaitable method**. A `ReflectionPolicy` DIP is declared in the contract but only one implementation (`ManualReflectionPolicy`) ships in v0.0. Threshold-based and sleep-time policies land at v0.4a behind the same interface (per roadmap Item 5).
- **Rationale.** v0.1's default `remember()` path must NEVER trigger reflection automatically — surprise LLM cost would poison adoption. Explicit method is honest about cost. The policy interface keeps the v0.4a sleep-time worker (Letta pattern) a pluggable addition, not a redesign. Resolves `CLAUDE.md § Open questions Q3`. Cited: roadmap Item 5 acceptance ("sleep-time worker test: background trigger fires within TBD seconds when threshold of N new memories crossed").
- **Consequences.**
  - Enables: zero-surprise pricing in v0.1 (caller pays for reflection only when they call it); v0.4a worker is a drop-in policy that doesn't change the contract.
  - Constrains: v0.1 consumers must call `reflect()` themselves; documentation must make the trigger model obvious.
  - Reversible? Medium. Adding default-auto-reflect in v1.x would be a breaking behavior change even if the type contract stays the same.
- **Alternatives evaluated.**
  - **Background scheduler by default in v0.0.** Rejected — surprise cost; v0.1 cannot reliably manage a worker (no scheduler in core).
  - **Threshold-based by default.** Rejected — couples write path to LLM call timing; complicates reasoning about latency.
  - **Drop `reflect()` from v0.0; add at v0.4a.** Rejected — Item 1 acceptance criteria reference reflection as a locked verb (D4); also forces downstream re-keying.

### D6 — Bi-temporal columns: schema-yes-in-local, query-API-no-until-v0.5

- **Decision.** Local schema (v0.1) provisions `t_valid` and `t_invalid` as nullable `TIMESTAMPTZ` columns on the memory table from day 1, BUT the local runtime's `recall()` does NOT accept an `asOf` parameter until v0.5. The cloud runtime (v0.5) is the first to expose `asOf` in the public type contract. The contract types declare `asOf?: Date` as an OPTIONAL parameter on `RecallOptions`; the local runtime throws `BiTemporalNotSupportedLocally` at runtime when `asOf` is provided (until v0.5 backports the local query support).
- **Rationale.** Schema migrations are painful; provisioning two TIMESTAMPTZ columns at zero query cost prevents v0.5 migration pain. Keeping the query API uniform (both runtimes accept `asOf?: Date`) means the contract stays stable across local/cloud — the divergence is a runtime error, not a type error. The uniform-contract-with-runtime-divergence pattern matches the locked positioning ("two runtimes — local + cloud") in `public-copy.md § 2`. Resolves `CLAUDE.md § Open questions Q4`.
- **Consequences.**
  - Enables: v0.5 cloud (and possibly v0.5+ local backport) lights up `asOf` queries without contract changes; Zep's bi-temporal moat (cited in CLAUDE.md § Competitive superiority matrix row Zep/Graphiti) is matched at v0.5 without re-keying public API.
  - Constrains: local v0.1 callers who try `asOf` get a runtime error (test must assert this); documentation must flag asOf as cloud-only until v0.5+ backport.
  - Reversible? Easy. Removing the columns later is a migration. Loosening the runtime error to a `recall()` that ignores `asOf` would be backward-compatible (no contract change).
- **Alternatives evaluated.**
  - **Local has no bi-temporal columns; cloud schema diverges.** Rejected — divergent schemas force divergent migrations and codebases.
  - **Local has columns AND query API in v0.1.** Rejected — additional Drizzle query work for v0.1; deferred to v0.5+ backport.
  - **Cloud-only contract for asOf (different `RecallOptions` per runtime).** Rejected — breaks the "two runtimes, one contract" anchor; consumers can't write runtime-agnostic code.

### D7 — Entity store: opt-out via constructor flag `entityBoost: boolean`

- **Decision.** The `Memory` constructor accepts a config option `entityBoost?: boolean` (default `true`). When `false`, the second vector store (entity store) is never instantiated; recall's entity-boost component is set to zero in the scoring formula; storage cost is halved for opted-out scopes.
- **Rationale.** Doubling storage is a meaningful cost in production; not every consumer wants it. Per-recall opt-out is wasteful (entities already written); per-write opt-out is confusing (mismatch between write-time decision and recall-time benefit). Constructor-level is the right granularity. Default `true` preserves Mem0 parity (Mem0's separate entity vector store is on by default). Resolves `CLAUDE.md § Open questions Q5`. Cited: `.claude/rules/architecture.md § 4 Mem0-shape architecture` (entity store is in the "Adopt" list).
- **Consequences.**
  - Enables: cost-sensitive consumers can halve their pgvector footprint at the cost of entity-boost recall quality.
  - Constrains: turning it on/off mid-life requires a backfill (recall quality drop until backfill completes); document as a one-time decision per Memory instance.
  - Reversible? Yes, with backfill.
- **Alternatives evaluated.**
  - **Always on (no opt-out).** Rejected — storage cost objection from cost-sensitive consumers; locks them in to Mem0's defaults.
  - **Per-`remember` flag (`{ extractEntities: false }`).** Rejected — write-time decision invalidates recall-time benefit; confusing.
  - **Per-`recall` flag.** Rejected — entity vectors already written, ignoring them at recall is computation waste.

### D8 — DIP interfaces: VectorStore (11), LLM (2), Embedder (2), HistoryManager (4 required + 3 optional)

- **Decision.** Lock the four DIP interfaces at the following surface in `docs/contract/dip/`:
  - **`VectorStore`** — 11 methods: `initialize()`, `insert(vectors, ids, payloads)`, `search(query, topK?, filters?)`, `keywordSearch(query, topK?, filters?)`, `get(id)`, `update(id, vector, payload)`, `delete(id)`, `deleteCol()`, `list(filters?, topK?)`, `getUserId()`, `setUserId(userId)`.
  - **`LLM`** — 2 methods: `generateResponse(messages, responseFormat?, tools?)`, `generateChat(messages)`.
  - **`Embedder`** — 2 methods: `embed(text)`, `embedBatch(texts)`.
  - **`HistoryManager`** — 4 required + 3 optional: required `addHistory(...)`, `getHistory(memoryId)`, `reset()`, `close()`; optional `saveMessages?(...)`, `getLastMessages?(...)`, `batchAddHistory?(...)`.
- **Rationale.** Each surface is taken VERBATIM from Mem0-ts (`referencia/mem0/mem0-ts/src/oss/src/{storage,vector_stores,llms,embeddings}/base.ts` — all verified to exist via `Path.exists()`). Inquebrável Rule 9 — these surfaces have been iterated by Mem0 and battle-tested with 30+ vector store / 24+ LLM / 15+ embedding implementations; we adopt the surface and diverge only on naming polish, never on shape. ISP-compliant (`.claude/rules/architecture.md § 8 Error handling` implicitly + ISP per global CLAUDE.md PARTE II-13.4): optional methods on `HistoryManager` are the right shape — not every backend supports V3 message history. Cited: `architecture.md § 3 Dependency direction` (these DIPs live in `src/core/`; adapters in `src/local/` and `src/cloud/` implement them).
- **Consequences.**
  - Enables: adapters from `referencia/mem0/mem0-ts/src/oss/src/vector_stores/pgvector.ts` and siblings can be ported with minimal adaptation; v0.5 cloud adapter is similarly constrained to this surface.
  - Constrains: any divergence from Mem0's signatures will hurt portability; introducing a fifth DIP later (e.g., `ReflectionWorker`) constitutes a contract change.
  - Reversible? Adding methods to optional sections is backward-compatible; removing or renaming required methods is breaking.
- **Alternatives evaluated.**
  - **Smaller VectorStore surface (5 methods: init/insert/search/get/delete).** Rejected — Mem0's pgvector adapter needs `list/update/getUserId/setUserId` for tenant isolation + maintenance ops.
  - **Folded `Embedder` into `LLM` (single provider abstraction).** Rejected — embeddings and chat-completion are operationally separate (different rate limits, different SLAs, often different providers).

Note on adoption: we adopt Mem0's signatures rather than diverge on naming polish, per Rule 9.

### D9 — Cloud auth: `THEOKIT_API_KEY` reuse with optional `apiKey` parameter override

- **Decision.** The cloud runtime (`@usetheo/memory/cloud`) reads `THEOKIT_API_KEY` from process env by default. Constructor accepts an optional `apiKey?: string` parameter that overrides the env var. No separate `THEMEMORY_API_KEY`.
- **Rationale.** Per `CLAUDE.md § Architectural Decisions Locked § Cross-Project Rule 6 exception` — TheoKit + TheMemory + TheoCloud is a deliberate single-platform consolidation. Reusing the auth credential is the practical surface of that consolidation: a user installs `@usetheo/sdk` and `@usetheo/memory/cloud` and gets a single auth model. Confirmed shared per `CLAUDE.md § Open questions Q6`. Cited: root `CLAUDE.md § Cross-Project Rule 6` (override authorized for the lock-in pattern).
- **Consequences.**
  - Enables: single env var across the TheoCloud surface; matches `@usetheo/sdk` pattern; minimum config to get started.
  - Constrains: multi-account / dev-vs-prod scenarios MUST use the explicit `apiKey` override; documentation must show both paths.
  - Reversible? Adding a separate env var later (with `THEMEMORY_API_KEY` taking precedence) is backward-compatible.
- **Alternatives evaluated.**
  - **Separate `THEMEMORY_API_KEY` env var.** Rejected — extra env var to manage; breaks the consolidation pitch.
  - **API key required as constructor arg only (no env fallback).** Rejected — every TheoCloud consumer would re-implement the env-var read; redundant.
  - **Both env vars, separate-takes-precedence.** Rejected for v0.0 — over-engineered for a problem we don't have; revisit when a real-world multi-account scenario surfaces.

## Dependencies

> Mandatory section per `cycle-plan.md` v1.1 + `deps-audit-golden-rule.md`. Every entry pinned with version range; every NEW entry carries Rule-9 evaluation.
>
> **Audit status (2026-05-22):** verified via sandbox `npm install --package-lock-only` + `npm audit` against the declared set in `/tmp/themory-deps-audit-2026-05-22/`. Initial verdict FAIL_MEDIUM (4 MEDIUM CVEs chained from `vitest@^1.5.0` + 1 peer-dep conflict on `typescript-eslint@^7.0.0` vs `eslint@^9.0.0`). Two corrections applied below (bumps to `vitest ^4.0.0` and `typescript-eslint ^8.0.0`). See `.claude/knowledge-base/audits/memory-contract-v0-0-deps-audit-2026-05-22.md` for full report.

### Existing

None — greenfield repo. No `package.json`, no `node_modules/`, no lockfile.

### New

| Package | Version pin | Scope | Rule 9 — alternatives evaluated, rationale |
|---|---|---|---|
| `typescript` | `^5.4.0` | devDep | **ADOPT.** Rejected: nothing — TypeScript is the project's compile target, mandated by `architecture.md § 7 Module hygiene` ("TypeScript strict mode"). Pin `^5.4.0` because vitest 1.x type-only tests need 5.0+ and decorator metadata stable since 5.2. |
| `vitest` | `^4.0.0` | devDep | **ADOPT.** Rejected: (a) `jest` — Mem0-ts uses it; slower; ESM pain; `expectTypeOf` is a separate package. (b) `node:test` (built-in) — viable but loses `expectTypeOf` for type-level assertions which `.claude/rules/testing.md § What NOT to test` explicitly endorses. (c) `tsc-only` (no runner) — cannot run integration tests at v0.1 from same config. Chosen vitest: faster, ESM-native, single tool for runtime + type-level tests, matches Mem0's own `cli/node/` choice. **Bumped 2026-05-22 from ^1.5.0 → ^4.0.0** to resolve `/deps-audit` findings F1-F4 (GHSA-67mh-4wv8-2f99 + GHSA-4w7w-66w2-5vf9 + chained vite/vite-node MEDIUM CVEs all rooted in vitest v1.x's vite-5 dep). v4.x preserves the `expectTypeOf` + `test.typecheck.enabled` config surface this plan relies on (verified via sandbox lockfile resolution: vitest@4.1.7 resolves clean with 0 vulnerabilities). |
| `@types/node` | `^20.0.0` | devDep | **ADOPT.** Rejected: nothing — Node.js LTS 20 is the minimum target per Mem0 `cli/node/package.json` and TheoKit conventions. No alternative; required for `node:crypto` types used in D1 (UUID/hash). |
| `eslint` | `^9.0.0` | devDep | **ADOPT.** Rejected: (a) `biome` — Mem0 `cli/node/` uses it; smaller config; but ESLint has broader plugin ecosystem (typescript-eslint, eslint-plugin-import). (b) `oxlint` — newer, smaller, faster, but plugin coverage thinner. (c) `tslint` — deprecated. Chosen ESLint: matches the established ecosystem; `cycle-implement.md` validation gate references `npm run lint`. |
| `typescript-eslint` | `^8.0.0` | devDep | **ADOPT** (transitive of ESLint+TS). Rejected: (a) stale `@typescript-eslint/*` separate packages — `typescript-eslint` 7+/8+ is the unified package; (b) `typescript-eslint@^7.x` — INITIAL CHOICE, **rejected 2026-05-22** due to `/deps-audit` finding F5: v7.x declares peer `eslint: ^8.56.0`, INCOMPATIBLE with our declared `eslint@^9.0.0` (ERESOLVE error on `npm install`). v8.x's peer is `eslint: ^8.57.0 || ^9.0.0 || ^10.0.0`, resolves cleanly with our eslint choice. Verified via sandbox lockfile: typescript-eslint@8.59.4 resolves with zero peer warnings. |
| `eslint-plugin-import` | `^2.30.0` | devDep | **ADOPT** (EC-7 absorption). Required because `architecture.md § 7 Module hygiene` mandates `import/no-namespace` (no `import * as ns`) AND `import/order` for stable diffs — neither is provided by typescript-eslint core. Rejected: (a) `eslint-plugin-import-x` — newer fork, less mature; (b) `oxlint built-in import rules` — partial coverage, can't run alongside ESLint cleanly. |

> **NEW deps deferred to v0.1 (declared here for forward visibility; NOT installed in v0.0).** `zod ^3.22` (schema validation), `pg ^8.11` (Postgres driver), `drizzle-orm ^0.30` (type-safe SQL), `pgvector` (Drizzle pgvector helper), and `uuid ^9` (or `node:crypto.randomUUID` if cross-runtime allows). The v0.1 plan applies Rule 9 evaluation to each one; listing them now exposes the dep-graph for `/deps-audit` cross-check.

### Removed

None.

## Dependency Graph

```
Phase 0 (tooling) ──▶ Phase 1 (ADRs)
                              │
                              ▼
                       Phase 2 (core types) ──▶ Phase 3 (DIPs)
                              │                       │
                              └───────────┬───────────┘
                                          ▼
                                Phase 4 (subpath exports)
                                          │
                                          ▼
                                Phase 5 (Integration Validation)
```

- **Sequential blockers:** Phase 0 → 1 → 2 → 3 → 4 → 5. Phase 2 needs ADRs to cite; Phase 3 references types from Phase 2.
- **Parallel:** Phases 2 and 3 can proceed concurrently for non-overlapping files once Phase 1 lands ADR D8 (locks DIP method counts).

---

## Phase 0: Tooling setup (TypeScript + vitest + ESLint, contract-only scope)

**Objective:** Set up the minimum tooling needed to type-check and type-test `docs/contract/` files, without bringing in runtime deps. The phase ships `package.json`, `tsconfig.contract.json`, `vitest.contract.config.ts`, ESLint config, and `.npmrc`.

### T0.1 — Initialize `package.json` (private, contract-only scripts)

#### Objective
Create a private `package.json` declaring scripts that the validation chain will invoke: `typecheck`, `lint`, `test`. No `"main"` / `"types"` / `"exports"` entries pointing to runtime code yet — the `exports` map for `@usetheo/memory` lands at v0.1; v0.0 only proves the contract compiles.

#### Evidence
`CLAUDE.md § Locked names` reserves `@usetheo/memory` as the npm name but explicitly says "not yet published". `cycle-implement.md § Phase contracts` requires `npm test`/`npm run typecheck`/`npm run lint` to be invokable for the validation gate to pass. Without `package.json`, no validation gate works.

#### Files to edit
```
package.json — (NEW) — private:true, name "@usetheo/memory", version "0.0.0-rc.1", scripts: typecheck/lint/test/test:type
.npmrc — (NEW) — engine-strict=true; save-exact=false; default save-prefix=^
```

#### Deep file dependency analysis
- **`package.json`** is the foundation for every subsequent tool. The `private: true` flag prevents accidental publish before v0.1. The version `0.0.0-rc.1` makes it clear nothing here is released.
- **`.npmrc`** locks engine-strict to enforce Node 20+ at install time (matches `@types/node ^20`).

#### Deep Dives
- **No `main`/`module`/`types`/`exports` yet.** v0.0 is contract design only; consumers will never import from the live npm name. Adding `exports` now would let someone `npm install @usetheo/memory` and import broken code paths — block that vector by staying `private`.
- **Scripts shape:**
  - `typecheck`: `tsc --noEmit -p tsconfig.contract.json`
  - `lint`: `eslint docs/contract/**/*.ts`
  - `test`: `vitest run --config vitest.contract.config.ts`
  - `test:type`: `tsc --noEmit -p tsconfig.contract.json --strict` (kept as separate script for clarity in the validation gate output)
- **No bundler (tsup/esbuild) at v0.0.** Distribution comes at v0.1 with `src/` and a real `exports` map.

#### Tasks
1. Run `cd /home/paulo/Projetos/usetheo/theo-memory` and inspect that no `package.json` exists.
2. Write `package.json` with `name`, `version`, `private:true`, `description` (one-line from README HERO), `license: MIT`, `engines: { node: ">=20.0.0" }`, `scripts`, `devDependencies`, `repository`, `bugs`, `homepage` fields per Mem0-ts shape (verified at `referencia/mem0/mem0-ts/package.json`).
3. Write `.npmrc` with the two lines above.
4. Run `npm install` (only devDeps; no postinstall side effects expected at this phase).

#### TDD
```
RED:     test_package_json_is_private() — assert package.json has "private": true (this file does NOT exist yet → assert fails)
RED:     test_engines_pins_node_20_plus() — assert "engines.node" matches ">=20.0.0"
RED:     test_no_main_or_types_field() — assert package.json has no "main", "module", "types", or "exports" key (locks v0.0 from accidental distribution)
GREEN:   Write package.json + .npmrc; run npm install
REFACTOR: None expected.
VERIFY:  npm run typecheck — should fail because tsconfig doesn't exist yet (that's Phase 0's NEXT task)
```

#### Acceptance Criteria
- [ ] `package.json` exists and is valid JSON (`node -e "require('./package.json')"` exits 0)
- [ ] `"private": true` is set
- [ ] `scripts` has `typecheck`, `lint`, `test`, `test:type` entries
- [ ] `devDependencies` contains exactly: `typescript`, `vitest`, `@types/node`, `eslint`, `typescript-eslint` (no extras)
- [ ] `npm install` completes with zero errors and zero warnings except for funding/audit messages
- [ ] Pass: complexity — N/A (declarative JSON)
- [ ] Pass: lint — N/A (Phase 0; lint task itself lands in T0.3)
- [ ] Pass: size — `package.json` ≤ 80 lines

#### DoD
- [ ] `node_modules/` exists after `npm install`
- [ ] `package-lock.json` committed
- [ ] No emoji in package.json description (per global CLAUDE.md PARTE I — no emojis)
- [ ] **EC-11 — npm name reservation deferred check (not v0.0 blocker).** Add a one-line note to `CHANGELOG.md` `[Unreleased]` under a new `### Known issues` block: "v0.1 readiness gate: verify `npm view @usetheo/memory` returns 404 or is owned by the `@usetheo` npm org, and that the publish auth token is provisioned. Not v0.0 task; flagged for v0.1 implementation kickoff." This is NOT a v0.0 task — `"private": true` blocks accidental publish.

---

### T0.2 — `tsconfig.contract.json` (strict; targets `docs/contract/`)

#### Objective
Configure TypeScript strictness to enforce the architecture rules: no `any`, no unchecked indexed access, ES modules only, target Node 20+.

#### Evidence
`.claude/rules/architecture.md § 7 Module hygiene` mandates: "TypeScript strict mode. No `any`." `testing.md § What NOT to test` mentions `expectTypeOf` for type-level tests — those need `strict` + `noUncheckedIndexedAccess` to be meaningful.

#### Files to edit
```
tsconfig.contract.json — (NEW) — strict bundle, targets docs/contract/**/*.ts, isolatedModules:true
tsconfig.json — (NEW) — minimal root config that extends nothing; future-proof for src/ in v0.1
```

#### Deep file dependency analysis
- **`tsconfig.contract.json`** is invoked by `npm run typecheck`. Including pattern: `docs/contract/**/*.ts`. Excluding: `node_modules`, `referencia/`, `dist`.
- **`tsconfig.json`** at root exists as a stub so editor LSPs find a config; it `references` the contract config and (later) the src config.

#### Deep Dives
- **Strict flags (all enabled):** `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`, `exactOptionalPropertyTypes: true`, `noPropertyAccessFromIndexSignature: true`.
- **Module config:** `module: "node20"`, `moduleResolution: "node20"`, `target: "es2022"` (matches Node 20 native support; avoids unnecessary down-leveling).
- **`isolatedModules: true`** — required for vitest's transformation; also catches ambient-type-only imports.
- **Why a separate `tsconfig.contract.json` vs everything in one file:** v0.1 introduces `tsconfig.src.json` for the runtime; keeping them separate from day 1 makes the destination obvious.

#### Tasks
1. Write `tsconfig.contract.json` with the strict flag set + include `docs/contract/**/*.ts` + paths config for `@contract/*` (sugar for cross-file imports inside `docs/contract/`).
2. Write `tsconfig.json` at root with only `{"references": [{"path": "./tsconfig.contract.json"}], "files": []}`.
3. Run `npx tsc --noEmit -p tsconfig.contract.json` — expect "No files matched" or empty exit; both indicate the config is valid but no `.ts` files exist yet (Phase 2/3 fixes that).

#### TDD
```
RED:     test_tsconfig_has_strict_true() — load tsconfig.contract.json, assert compilerOptions.strict === true
RED:     test_no_unchecked_indexed_access() — assert compilerOptions.noUncheckedIndexedAccess === true
RED:     test_target_es2022_or_newer() — assert compilerOptions.target ∈ {"es2022", "esnext"}
GREEN:   Write both tsconfig files
REFACTOR: None expected.
VERIFY:  npm run typecheck — exits 0 (no files to type-check yet, but config is valid)
```

#### Acceptance Criteria
- [ ] `tsconfig.contract.json` exists with strict:true + noUncheckedIndexedAccess:true
- [ ] `tsconfig.json` (root) compiles via `tsc -b` (no actual files yet, but references resolve)
- [ ] `npm run typecheck` exits 0
- [ ] Pass: lint — N/A
- [ ] Pass: size — both files ≤ 60 lines

#### DoD
- [ ] `npx tsc --version` matches `^5.4.0`
- [ ] No `lib` override (default lib is fine for our types-only scope)

---

### T0.3 — ESLint flat config + vitest config

#### Objective
ESLint flat config (v9) targeting `docs/contract/**/*.ts` with `typescript-eslint` strict rules + import sorting. Vitest config that picks up `docs/contract/__tests__/*.test.ts` and `docs/contract/**/*.test-d.ts` (type-level tests).

#### Evidence
`.claude/rules/architecture.md § 7` requires: "Destructured imports always: `import { foo, bar } from 'baz'`. Avoid `import * as ns`." That's an ESLint rule (`import/no-namespace`). `.claude/rules/testing.md § Running tests` references `npm test` as the validation gate entry — must point at a working vitest config.

#### Files to edit
```
eslint.config.ts — (NEW) — flat config; tseslint + import + no-emoji rule
vitest.contract.config.ts — (NEW) — vitest config; type-test pattern; coverage off for v0.0
```

#### Deep file dependency analysis
- **`eslint.config.ts`** is loaded by ESLint 9's flat config protocol. It exports an array of config objects; we use typescript-eslint's `tseslint.config(...)` helper for type-aware linting.
- **`vitest.contract.config.ts`** is loaded by `vitest run --config vitest.contract.config.ts`. Type-level tests via `.test-d.ts` pattern.

#### Deep Dives
- **ESLint rules layered on top of typescript-eslint recommended-strict-type-checked:**
  - `import/no-namespace`: error
  - `import/order`: warn (auto-fix)
  - `no-console`: error (per `architecture.md § 7`: "No `console.log` in production code paths")
  - Custom rule (deferred to v0.1+): no-emoji in source files (architecture.md hints; for v0.0 we manually verify).
- **Vitest config:**
  - `test.typecheck.enabled: true` — runs `tsc --noEmit` on `.test-d.ts` files using the `expectTypeOf` flow (Vitest docs § Type Testing).
  - `test.coverage` disabled at v0.0 — there's no runtime code to cover yet (types-only).

#### Tasks
1. Write `eslint.config.ts` with tseslint.config([...]) wrapping recommended-strict-type-checked + custom rules.
2. Write `vitest.contract.config.ts` with `test: { typecheck: { enabled: true, include: ['docs/contract/**/*.test-d.ts'] }, include: ['docs/contract/__tests__/**/*.test.ts'] }`.
3. Run `npm run lint` (exits 0 with no files; Phase 2 produces .ts files to lint).
4. Run `npm test` (exits 0; no test files exist yet).

#### TDD
```
RED:     test_eslint_config_is_flat() — load eslint.config.ts via dynamic import, assert default export is an array
RED:     test_vitest_typecheck_enabled() — load vitest.contract.config.ts, assert test.typecheck.enabled === true
GREEN:   Write both config files
REFACTOR: None expected.
VERIFY:  npm run lint && npm test — both exit 0
```

#### Acceptance Criteria
- [ ] `eslint.config.ts` exists; `npx eslint --print-config docs/contract/types.ts 2>/dev/null || true` doesn't crash (no files yet, but config parses)
- [ ] **EC-7 — ESLint smoke test passes:** `npx eslint --print-config docs/contract/index.ts > /dev/null` exits 0 once T4.1 lands the barrel file. Pre-T4.1, run against any temporary placeholder `.ts` file to verify the plugin chain resolves (typescript-eslint + eslint-plugin-import + flat-config compatibility).
- [ ] `vitest.contract.config.ts` exists; `npx vitest run --config vitest.contract.config.ts --reporter=basic` exits 0 with "no test files found"
- [ ] Pass: lint — N/A
- [ ] Pass: size — both files ≤ 80 lines

#### DoD
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0
- [ ] `npm run typecheck` exits 0

---

## Phase 1: ADRs (lock D1-D9 into `docs/adrs/`)

**Objective:** Persist each of D1-D9 as a standalone MADR-3.0-shape file. Each ADR has Status (Accepted), Context, Decision, Consequences (Positive/Negative/Reversibility), and Alternatives (with rejection reasons).

### T1.1 — ADRs D1-D4 (locked decisions ratified)

#### Objective
File D1 (Mem0-shape), D2 (Three-tier scope), D3 (ADD-only), D4 (API verbs) as separate markdown files under `docs/adrs/`. Each is a CONSOLIDATION of `CLAUDE.md § Architectural Decisions Locked` content into MADR shape — the strategic review already accepted these; this task just persists the rationale in the canonical location.

#### Evidence
Roadmap Item 1 acceptance: "One ADR per locked decision (Mem0-shape, three-scope, ADD-only, API verbs) under `docs/adrs/`." Without these files, `/plan-confidence` will flag missing ADRs (although the plan's `## ADRs` section satisfies the inline requirement, the `docs/adrs/` files are the durable artifact for v0.1+ consumers).

#### Files to edit
```
docs/adrs/ADR-0001-mem0-shape-architecture.md — (NEW) — MADR 3.0 shape
docs/adrs/ADR-0002-three-tier-scope.md — (NEW)
docs/adrs/ADR-0003-add-only-public-api.md — (NEW)
docs/adrs/ADR-0004-api-verbs.md — (NEW)
docs/adrs/README.md — (NEW) — index pointing at ADR-0001..0009 with one-line summaries
```

#### Deep file dependency analysis
- **`docs/adrs/`** is greenfield. The README.md index helps `/review`'s cross-validation agent + future-`/to-plan` invocations discover the catalogue.
- These ADR files DO NOT live under `src/` so they are NOT subject to `architecture.md` LoC budget. Markdown size budget per file: keep ≤ 200 lines.

#### Deep Dives
- **MADR 3.0 sections (locked):**
  - Title (one-line, action-oriented)
  - Status: `Accepted`
  - Date: `2026-05-22` (today)
  - Context (what + why-now)
  - Decision (concrete commitment, with `MUST` / `MUST NOT` framing)
  - Consequences:
    - Positive (what this enables)
    - Negative (what this constrains)
    - Reversibility (how hard is it to undo)
  - Alternatives (table: option / rejected because)
  - References (links to CLAUDE.md sections, referencia/ paths, this plan)
- **No emoji** in any ADR (architecture rule).
- **Cite paths and line numbers** when referencing `referencia/` — and only paths that exist (`Path.exists()` check).

#### Tasks
1. Write each of the four ADR files using the content from `## ADRs § D1..D4` above as the source.
2. Write `docs/adrs/README.md` as an index listing all 9 ADRs (D5-D9 added in T1.2).

#### TDD
```
RED:     test_adr_files_exist() — assert Path.exists() for ADR-0001..0004
RED:     test_madr_section_present_in_each() — for each ADR, assert sections Status, Context, Decision, Consequences, Alternatives are H2 headers
RED:     test_status_is_accepted() — assert the Status line reads "Accepted"
RED:     test_no_emoji_in_adr() — assert each ADR file has zero emoji chars (regex /[\u{1F300}-\u{1FAFF}]/u returns no match)
GREEN:   Write the four ADR files + README
REFACTOR: Tighten language; harmonize alternatives tables across the four files.
VERIFY:  Read each ADR; manual review against MADR 3.0 shape.
```

#### Acceptance Criteria
- [ ] Four ADR files exist at the paths above
- [ ] `docs/adrs/README.md` lists all 9 ADRs (D5-D9 will be filled by T1.2; the index is forward-looking)
- [ ] Each ADR has exactly one `Status:` line set to `Accepted`
- [ ] Each ADR has non-empty Alternatives section
- [ ] Pass: size — each ADR ≤ 200 lines
- [ ] Pass: lint — N/A (markdown)
- [ ] No emoji in any ADR

#### DoD
- [ ] Cross-references inside ADRs use repo-relative paths (`../../CLAUDE.md § ...`) or `referencia/` paths that exist
- [ ] No `production-ready` token appears in any ADR (Inquebrável Rule 3 + dogfood gate)

---

### T1.2 — ADRs D5-D9 (resolves CLAUDE.md § Open questions Q2-Q6)

#### Objective
File D5 (Reflection trigger), D6 (Bi-temporal columns), D7 (Entity store opt-out), D8 (DIP method counts), D9 (Cloud auth) as separate markdown files. Resolves the five open questions in `CLAUDE.md`.

#### Evidence
`CLAUDE.md § Open questions` lists Q2-Q6 as "Lock before v0.0 contract ships". Without these ADRs, the contract's types (`reflect()`, `RecallOptions.asOf`, `MemoryConfig.entityBoost`, four DIP shapes, `CloudConfig.apiKey`) are unjustifiable — leaving `/plan-confidence` with cap-70 from `ADR without alternatives`.

#### Files to edit
```
docs/adrs/ADR-0005-reflection-trigger.md — (NEW)
docs/adrs/ADR-0006-bi-temporal-local-schema.md — (NEW)
docs/adrs/ADR-0007-entity-store-opt-out.md — (NEW)
docs/adrs/ADR-0008-dip-method-counts.md — (NEW)
docs/adrs/ADR-0009-cloud-auth-theokit-api-key.md — (NEW)
docs/adrs/README.md — (UPDATE) — add D5-D9 entries to the index
CLAUDE.md — (UPDATE) — § Open questions: mark Q2-Q6 as RESOLVED, link to ADRs
```

#### Deep file dependency analysis
- Same MADR 3.0 shape as T1.1.
- **`CLAUDE.md` UPDATE:** the open-questions section gets `RESOLVED 2026-05-22: see ADR-000{5..9}` annotations. The questions stay in the document for context (audit trail).

#### Deep Dives
- **D8 IS the load-bearing ADR for the DIPs.** Phase 3 cites D8 verbatim — any divergence between the contract files and D8 fails `/plan-confidence`.
- **D6's runtime-error behavior** must be reflected in the contract by exporting a typed error class `BiTemporalNotSupportedLocally` (Phase 2 T2.4). The ADR justifies this error type.
- **D9's optional `apiKey` parameter** appears in the cloud `Memory` constructor signature (Phase 2 T2.5).
- **CLAUDE.md edits MUST be purely additive (resolves EC-8).** Section `§ Open questions` is NOT in CLAUDE.md's "Locked items" list, so editing it is part of the plan's normal contract. BUT every Q2-Q6 entry MUST be preserved verbatim (audit trail of the original question), with only an APPENDED `RESOLVED 2026-05-22 → docs/adrs/ADR-000N-*.md` line below each question. Never delete the question text. Never reword the question. The git diff for the CLAUDE.md edit MUST be ADD-ONLY (no `-` lines that touch question text).

#### Tasks
1. Write each of the five ADR files using the content from `## ADRs § D5..D9` above.
2. Update `docs/adrs/README.md` to include D5-D9.
3. Update `CLAUDE.md § Open questions`: mark Q2-Q6 RESOLVED with links to ADRs; do NOT remove the questions (audit trail).

#### TDD
```
RED:     test_adr_files_d5_d9_exist() — Path.exists() for ADR-0005..0009
RED:     test_claude_md_open_questions_resolved() — read CLAUDE.md, assert each of Q2..Q6 has "RESOLVED" or "→ ADR-" mention
RED:     test_d8_lists_4_dips_with_method_counts() — parse ADR-0008, assert text mentions "VectorStore", "LLM", "Embedder", "HistoryManager" and method counts 11/2/2/(4+3)
GREEN:   Write the five ADR files + update README + CLAUDE.md
REFACTOR: Cross-reference D5-D9 against D1-D4 where appropriate (e.g., D5 references D4's verb list).
VERIFY:  Manual read of CLAUDE.md to confirm Q2-Q6 annotations don't break the document's narrative.
```

#### Acceptance Criteria
- [ ] Five ADR files exist
- [ ] `docs/adrs/README.md` index has 9 entries
- [ ] `CLAUDE.md § Open questions`: Q2-Q6 each have `RESOLVED 2026-05-22 → docs/adrs/ADR-000N-...md` annotation
- [ ] No emoji
- [ ] Pass: size — each ADR ≤ 200 lines
- [ ] Pass: lint — N/A

#### DoD
- [ ] `CLAUDE.md` still validates (markdown-readable; cross-references resolve)
- [ ] CHANGELOG.md `[Unreleased]` `Added` section gets one entry: `docs(adrs): ADR-0001..0009 published for v0.0 contract design (see plan: memory-contract-v0-0)`

---

## Phase 2: Core types (Memory + MemoryStore + supporting)

**Objective:** Write the type-only files that consumers will eventually `import` from `@usetheo/memory`. Everything in `docs/contract/`. NO runtime code. NO `class` keywords with bodies — interface-only.

### T2.1 — `docs/contract/scope.ts` (three-tier scope shape)

#### Objective
Define the `Scope` discriminated-union and the three scope-specific narrow types: `UserScope`, `SessionScope`, `AgentScope`. The narrow types power D2's compile-time type narrowing.

#### Evidence
`.claude/rules/architecture.md § 1 Three-tier scope` + ADR-0002. Mem0-ts's `SearchFilters` (verified at `referencia/mem0/mem0-ts/src/oss/src/types/index.ts:84-89`) is the internal shape; our public types narrow over it.

#### Files to edit
```
docs/contract/scope.ts — (NEW) — Scope discriminated union + three narrow types + Filters internal shape
docs/contract/__tests__/scope.test-d.ts — (NEW) — type-level invariants
```

#### Deep file dependency analysis
- **`scope.ts`** is imported by every other contract file (`memory-store.ts`, `options.ts`, `errors.ts`). Lives at the root of `docs/contract/` for visibility.
- **`scope.test-d.ts`** uses `expectTypeOf` from vitest to assert: `UserScope extends Scope`, `UserScope & SessionScope is never` (mutual exclusion), the `kind` discriminator narrows correctly.

#### Deep Dives
- **Shape:**
  ```ts
  export type UserScope = { readonly kind: 'user'; readonly userId: string }
  export type SessionScope = { readonly kind: 'session'; readonly sessionId: string; readonly userId?: string }
  export type AgentScope = { readonly kind: 'agent'; readonly agentId: string; readonly userId?: string }
  export type Scope = UserScope | SessionScope | AgentScope

  // Internal filter shape (matches Mem0 1:1, renamed run_id → session_id):
  export interface Filters {
    readonly user_id?: string
    readonly agent_id?: string
    readonly session_id?: string
  }
  ```
- **Why session_id can include `userId?: string`.** A session belongs to a user; recall with `session_id` can optionally filter further by user. Same for agent.
- **`readonly` everywhere.** Scopes are immutable values; mutation belongs in the store.

#### Tasks
1. Write `docs/contract/scope.ts` with the four exports above.
2. Write `docs/contract/__tests__/scope.test-d.ts` with `expectTypeOf` assertions for narrowing and mutual exclusion.

#### TDD
```
RED:     scope_userScope_narrows_correctly — expectTypeOf<UserScope>().toMatchTypeOf<Scope>()
RED:     scope_kind_discriminator_works — given Scope, switch(s.kind) should narrow exhaustively (no `never` fall-through)
RED:     scope_filters_match_mem0_shape — assert keyof Filters === 'user_id' | 'agent_id' | 'session_id'
GREEN:   Write scope.ts
REFACTOR: None.
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] `docs/contract/scope.ts` exports `UserScope`, `SessionScope`, `AgentScope`, `Scope`, `Filters`
- [ ] `tsc --noEmit` passes
- [ ] All type-level tests in `scope.test-d.ts` pass
- [ ] Pass: lint — zero ESLint warnings
- [ ] Pass: size — `scope.ts` ≤ 60 lines, `scope.test-d.ts` ≤ 80 lines

#### DoD
- [ ] No `class` keyword in `scope.ts` (interface/type only)
- [ ] No `any`, no `unknown` without justification comment

---

### T2.2 — `docs/contract/memory-item.ts` (the persisted fact)

#### Objective
Define `MemoryItem` (a persisted fact) and `MemoryItemWithScore` (the recall result extension).

#### Evidence
Mem0-ts ships `MemoryItem` at `referencia/mem0/mem0-ts/src/oss/src/types/index.ts:74-82` — verified to exist. Our shape adds `scope` (typed) and removes `metadata: Record<string, any>` (replaced by typed payload at v1.4 ontologies, but v0.0 keeps `metadata: Readonly<Record<string, string | number | boolean | null>>` as a tightened shape).

#### Files to edit
```
docs/contract/memory-item.ts — (NEW)
docs/contract/__tests__/memory-item.test-d.ts — (NEW)
```

#### Deep file dependency analysis
- Depends on `scope.ts` (for `Scope` type).
- Imported by `memory-store.ts`, `options.ts`, error types.

#### Deep Dives
- **Shape:**
  ```ts
  export interface MemoryItem {
    readonly id: string                       // UUID v4
    readonly text: string                     // the fact, post-extraction
    readonly hash: string                     // MD5 of normalized text (dedup)
    readonly scope: Scope                     // typed scope reference
    readonly createdAt: Date                  // ISO 8601 from Postgres TIMESTAMPTZ
    readonly updatedAt: Date                  // for parity; ADD-only means it equals createdAt for new rows
    readonly metadata: Readonly<Record<string, string | number | boolean | null>>
    readonly tValid: Date | null              // bi-temporal column (D6)
    readonly tInvalid: Date | null            // bi-temporal column (D6); null = currently valid
  }

  export interface MemoryItemWithScore extends MemoryItem {
    readonly score: number                    // [0, 1] additive scoring result (D1)
  }
  ```
- **`metadata` shape is tightened** vs Mem0's `Record<string, any>` — passes ESLint `no-explicit-any` and lets consumers type-check their metadata at compile time.
- **`tValid` / `tInvalid` on the type** even though local v0.1 doesn't query them — they're part of the data model from D6. Reads always include them; writes default to `{ tValid: now, tInvalid: null }` until `forget()` sets `tInvalid`.
- **`metadata` limitation JSDoc (resolves EC-9).** The `Readonly<Record<string, string | number | boolean | null>>` shape is intentionally flat and primitive-only. It excludes `Date` (must serialize as ISO string), `bigint` (must serialize as string), nested objects (must flatten to `'parent.child'` keys), and arrays (must JSON-stringify). v1.4 typed-domain-ontologies (roadmap Item 15) opens a documented path to relax this constraint when shipped. Lock the JSDoc above the field:
  ```ts
  /**
   * Flat key-value payload. Primitives only (string/number/boolean/null).
   * Nested objects, `Date`, `bigint`, and arrays MUST be flattened or
   * serialized by the caller. v1.4 typed-domain-ontologies (Item 15) opens a documented path to relax this constraint when shipped.
   */
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>
  ```

#### Tasks
1. Write `memory-item.ts` with both interfaces.
2. Write the `.test-d.ts` with `expectTypeOf` assertions.

#### TDD
```
RED:     memory_item_has_required_fields — assert every readonly field present and typed
RED:     memory_item_metadata_rejects_any — `const m: MemoryItem = { metadata: { x: { nested: 1 } } }` should NOT compile (nested objects banned in v0.0)
RED:     memory_item_with_score_extends_memory_item — expectTypeOf<MemoryItemWithScore>().toMatchTypeOf<MemoryItem>()
GREEN:   Write memory-item.ts
REFACTOR: Add JSDoc-style /** one-liner */ comments above each field describing its semantic role (e.g., "MD5 of normalizedText; deduplication key"). Per `architecture.md` "Default to writing no comments. Only when WHY is non-obvious" — these qualify because hash semantics are non-obvious.
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] `MemoryItem` and `MemoryItemWithScore` exported with locked shape
- [ ] All `readonly`
- [ ] `metadata` rejects nested objects at compile time
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — `memory-item.ts` ≤ 60 lines

#### DoD
- [ ] One-line comment ONLY above non-obvious fields (`hash`, `tValid`, `tInvalid`)
- [ ] No `any`, no `unknown`

---

### T2.3 — `docs/contract/options.ts` (remember/recall/forget/reflect options)

#### Objective
Define the option-bag types: `RememberOptions`, `RecallOptions`, `ForgetOptions`, `ReflectOptions`, `GetAllOptions`. The five option types compose Scope, Filters, metadata, and v0.5+ asOf.

#### Evidence
Mem0-ts has `AddMemoryOptions / SearchMemoryOptions / GetAllMemoryOptions / DeleteAllMemoryOptions` at `referencia/mem0/mem0-ts/src/oss/src/memory/memory.types.ts:10-27` — verified. Our shape replaces these with the four verb-aligned types, reusing the inferred-fact escape hatch (`infer?: boolean`).

#### Files to edit
```
docs/contract/options.ts — (NEW)
docs/contract/__tests__/options.test-d.ts — (NEW)
```

#### Deep file dependency analysis
- Depends on `scope.ts`, `memory-item.ts`.
- Imported by `memory-store.ts`.

#### Deep Dives
- **Shape:**
  ```ts
  export interface RememberOptions {
    readonly metadata?: Readonly<Record<string, string | number | boolean | null>>
    readonly infer?: boolean   // default true; false = persist text as-is (no LLM extraction); D1
  }

  export interface RecallOptions {
    readonly topK?: number     // default 20 (Mem0 parity)
    readonly threshold?: number // default 0.1 (Mem0 parity); semantic gate (D1)
    readonly asOf?: Date       // OPTIONAL — local v0.1 throws BiTemporalNotSupportedLocally; cloud v0.5+ supports
  }

  export interface ForgetOptions {
    readonly hard?: boolean    // default false = soft delete via tInvalid; true = remove row entirely
  }

  export interface ReflectOptions {
    readonly maxIterations?: number  // default 10; v0.4a worker uses this as upper bound per cycle
  }

  export interface GetAllOptions {
    readonly topK?: number             // default 100
    readonly filters?: Filters         // raw filter access for advanced consumers
  }
  ```
- **`asOf` on `RecallOptions` is the DELIBERATE bridge** between D6's "schema yes, query-API-yes-but-runtime-errors-on-local-v0.1" decision. The type is uniform; the behavior diverges. Consumer code stays runtime-agnostic.
- **`infer: false` escape hatch** matches Mem0; lets callers supply pre-extracted facts (useful for migration / batch import scenarios).
- **`hard: boolean` on Forget** lets cloud consumers do GDPR-style hard deletes; local v0.1 supports both.

#### Tasks
1. Write `options.ts`.
2. Write `options.test-d.ts` asserting: all fields are optional, all readonly, all primitive types.

#### TDD
```
RED:     remember_options_metadata_optional — expectTypeOf<RememberOptions>().toEqualTypeOf<{ readonly metadata?: ...; readonly infer?: boolean }>()
RED:     recall_options_asOf_optional — expectTypeOf<RecallOptions>().toHaveProperty('asOf').toMatchTypeOf<Date | undefined>()
RED:     forget_options_hard_defaults_to_false — assert the optionality
GREEN:   Write options.ts
REFACTOR: None.
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] All five option types exported
- [ ] Every field readonly + optional
- [ ] `asOf?: Date` on RecallOptions (D6 bridge present)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — `options.ts` ≤ 50 lines

#### DoD
- [ ] No `any`, no `unknown`
- [ ] One-line comment above non-obvious fields (`infer`, `asOf`, `hard`)

---

### T2.4 — `docs/contract/errors.ts` (typed domain errors)

#### Objective
Define the typed error classes the contract surfaces: `MemoryNotFound`, `InvalidScope`, `EmbeddingMismatch`, `BiTemporalNotSupportedLocally`, `ReflectionNotConfigured`. Per `.claude/rules/architecture.md § 8 Error handling`.

#### Evidence
`architecture.md § 8` mandates: "Domain errors are typed classes: `MemoryNotFound`, `InvalidScope`, `EmbeddingMismatch`, etc. — exported from `src/core/errors.ts`." For v0.0 contract, these live at `docs/contract/errors.ts` (will move to `src/core/errors.ts` at v0.1).

#### Files to edit
```
docs/contract/errors.ts — (NEW)
docs/contract/__tests__/errors.test-d.ts — (NEW)
```

#### Deep file dependency analysis
- No imports from other contract files (errors are leaf).
- Imported by `memory-store.ts` (as part of method signatures for the rejected-promise types where applicable, though TS doesn't enforce throws — JSDoc `@throws` is informative).

#### Deep Dives
- **Each class is an `Error` subclass with `name` set + `cause` retained where applicable.** Per architecture.md §8.
- **`BiTemporalNotSupportedLocally` is the runtime-thrown error from D6** when local v0.1 caller passes `asOf`.
- **`ReflectionNotConfigured` is the runtime-thrown error from D5** when caller invokes `reflect()` but no `ReflectionPolicy` was configured.
- **Mandatory `Object.setPrototypeOf` template (resolves EC-2).** Every TypeScript `extends Error` subclass needs `Object.setPrototypeOf(this, X.prototype)` in its constructor to keep `instanceof` working across ESM/CJS boundaries, dynamic imports, and worker_threads — even when targeting ES2022. Without it, the v0.1 adapter's `catch (e) { if (e instanceof BiTemporalNotSupportedLocally) ... }` will silently fail. Lock the template:
  ```ts
  export class MemoryNotFound extends Error {
    readonly name = 'MemoryNotFound' as const
    constructor(memoryId: string, options?: ErrorOptions) {
      super(`Memory not found: ${memoryId}`, options)
      Object.setPrototypeOf(this, MemoryNotFound.prototype)
    }
  }
  ```
  Same shape for all five classes; only the `name` value and message string change.

#### Tasks
1. Write `errors.ts` with five error classes, each following the template above (constructor calls `super(message, options)` + `Object.setPrototypeOf(this, ClassName.prototype)`).
2. Write `errors.test-d.ts` asserting each error is an `Error` subtype AND, in a runtime test block, `new ClassName(...) instanceof ClassName === true` (EC-2 runtime verification).

#### TDD
```
RED:     errors_are_error_subtypes — expectTypeOf<MemoryNotFound>().toMatchTypeOf<Error>()
RED:     bitemporal_error_class_exists — assert BiTemporalNotSupportedLocally is exported as a class (not just type)
RED:     reflection_not_configured_error_class — same
RED:     instance_of_works_for_each_class — for each of the 5 classes: `expect(new C() instanceof C).toBe(true)` (EC-2 runtime verification — runs in vitest test block, not type-test)
GREEN:   Write errors.ts with the Object.setPrototypeOf template applied to every class
REFACTOR: Propagate `options?.cause` consistently. Confirm each class's `name` is `as const` for TS literal-type narrowing.
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] Five error classes exported
- [ ] Each extends `Error`
- [ ] Each has stable `name` field declared `as const`
- [ ] Each constructor calls `Object.setPrototypeOf(this, ClassName.prototype)` (EC-2 — verified via runtime `instanceof` test, not just compile-time)
- [ ] Pass: lint
- [ ] Pass: size — `errors.ts` ≤ 100 lines (raised from 80 to accommodate the prototype-chain plumbing per EC-2)

#### DoD
- [ ] No `any` in error constructors
- [ ] Runtime `instanceof` test passes for all five classes (EC-2)

---

### T2.5 — `docs/contract/memory-store.ts` (the headline `Memory` + `MemoryStore` shape)

#### Objective
Define the THREE central types: `MemoryStore` (the underlying primitive that adapters implement), `Memory` (the public-facing class signature with `.user(id)`, `.session(id)`, `.agent(id)` sub-objects), and `ScopedMemory` (the per-tier sub-object returned by `.user/.session/.agent`). The file is the contract's centerpiece.

#### Evidence
Roadmap Item 1 acceptance: "Type contract for `Memory`, `MemoryStore`". The task delivers both.

#### Files to edit
```
docs/contract/memory-store.ts — (NEW)
docs/contract/__tests__/memory-store.test-d.ts — (NEW)
```

#### Deep file dependency analysis
- Imports from `scope.ts`, `memory-item.ts`, `options.ts`, `errors.ts`, `dip/*.ts` (Phase 3 outputs — declared as type imports; Phase 3 task T3.x ships the files).
- This is the file that downstream items v0.1-v1.4 import against.

#### Deep Dives
- **Three interfaces (NOT class implementations — types only at v0.0):**
  ```ts
  // The low-level primitive adapters implement (local + cloud share this).
  export interface MemoryStore {
    remember(text: string, scope: Scope, options?: RememberOptions): Promise<ReadonlyArray<MemoryItem>>
    recall(query: string, scope: Scope, options?: RecallOptions): Promise<ReadonlyArray<MemoryItemWithScore>>
    forget(memoryId: string, options?: ForgetOptions): Promise<void>
    reflect(scope: Scope, options?: ReflectOptions): Promise<ReflectionResult>
    get(memoryId: string): Promise<MemoryItem | null>
    getAll(scope: Scope, options?: GetAllOptions): Promise<ReadonlyArray<MemoryItem>>
    history(memoryId: string): Promise<ReadonlyArray<HistoryEntry>>
    reset(scope: Scope): Promise<void>
  }

  // The scoped sub-object form (returned by Memory.user/.session/.agent).
  export interface ScopedMemory {
    remember(text: string, options?: RememberOptions): Promise<ReadonlyArray<MemoryItem>>
    recall(query: string, options?: RecallOptions): Promise<ReadonlyArray<MemoryItemWithScore>>
    reflect(options?: ReflectOptions): Promise<ReflectionResult>
    getAll(options?: GetAllOptions): Promise<ReadonlyArray<MemoryItem>>
  }

  // The headline public class signature.
  export interface Memory {
    user(userId: string): ScopedMemory
    session(sessionId: string): ScopedMemory
    agent(agentId: string): ScopedMemory
    forget(memoryId: string, options?: ForgetOptions): Promise<void>      // unscoped (id is globally unique)
    get(memoryId: string): Promise<MemoryItem | null>
    history(memoryId: string): Promise<ReadonlyArray<HistoryEntry>>
    reset(scope: Scope): Promise<void>                                    // explicit scope required
  }

  // Supporting:
  export interface ReflectionResult {
    readonly higherOrderMemories: ReadonlyArray<MemoryItem>   // new memories created during reflection
    readonly sourceIds: ReadonlyArray<string>                  // memoryIds the reflection drew from
  }

  export interface HistoryEntry {
    readonly action: 'remember' | 'forget' | 'reflect'
    readonly at: Date
    readonly previousValue: string | null
    readonly newValue: string | null
  }
  ```
- **Why `ScopedMemory` exists.** Without it, the public class would be `memory.remember(text, scope, options)` which loses TS narrowing. The sub-object form `memory.user('alice').remember(text)` makes the scope discoverable and type-safe.
- **Why `forget` is on `Memory` but NOT on `ScopedMemory`.** Memory IDs are globally unique (UUIDs); forget-by-id doesn't need a scope. Adding it to ScopedMemory would invite cross-scope footguns.
- **`reset(scope)` requires explicit scope.** Cross-scope reset is a separate (administrative) operation, not provided in v0.0.

- **`MemoryConfig` and `CloudMemoryConfig` (resolves EC-1).** The construction-time inputs that downstream items v0.1+ pass when wiring a Memory instance. Both runtimes share `MemoryConfig`; the cloud runtime extends it.
  ```ts
  export interface MemoryConfig {
    readonly embedder: Embedder
    readonly llm: LLM
    readonly vectorStore: VectorStore
    /** Optional. v0.1 ships `DummyHistoryManager` (no-op) by default; consumers wire SQLite/Supabase later. */
    readonly historyManager?: HistoryManager
    /** Optional. v0.0 ships `ManualReflectionPolicy` as the only built-in; v0.4a adds threshold + sleep-time. @see ADR-0005 */
    readonly reflectionPolicy?: ReflectionPolicy
    /** Default `true`. When `false`, no entity vector store is instantiated. @see ADR-0007 */
    readonly entityBoost?: boolean
    /** Optional system-prompt prefix injected into LLM extraction calls. Mem0 parity. */
    readonly customInstructions?: string
  }

  export interface CloudMemoryConfig extends MemoryConfig {
    /** Overrides `THEOKIT_API_KEY` env var when set. @see ADR-0009 */
    readonly apiKey?: string
    /** Cloud endpoint base URL. Defaults to TheoCloud production; override for dev/staging. */
    readonly baseUrl?: string
  }
  ```
  Notes: `MemoryConfig` is a TYPE, not a class — v0.0 ships no constructors. v0.1 introduces the runtime `createMemory(config: MemoryConfig): Memory` factory (cloud equivalent: `createCloudMemory(config: CloudMemoryConfig): Memory`).

- **`asOf` JSDoc requirement (resolves EC-5).** The type contract types `RecallOptions.asOf?: Date` uniformly, but the local v0.1 runtime throws `BiTemporalNotSupportedLocally` when receiving one. Document the divergence directly above the field in `options.ts` (annotated in T2.3 Deep Dive) so the IDE hover-tip surfaces the warning.

#### Tasks
1. Write `memory-store.ts` exporting the seven types above (`MemoryStore`, `Memory`, `ScopedMemory`, `ReflectionResult`, `HistoryEntry`, `MemoryConfig`, `CloudMemoryConfig`).
2. Write `memory-store.test-d.ts` with `expectTypeOf` assertions:
   - `Memory.user('x').remember('text')` returns `Promise<readonly MemoryItem[]>`
   - The four DIPs are NOT exposed on Memory (they're construction-time inputs, not public methods)
   - `MemoryStore.remember` returns the same shape as `ScopedMemory.remember`
   - `MemoryConfig` requires `embedder + llm + vectorStore`; the rest is optional
   - `CloudMemoryConfig` extends `MemoryConfig` and adds optional `apiKey + baseUrl`
   - **EC-5** — `expectTypeOf<RecallOptions>().toHaveProperty('asOf').toMatchTypeOf<Date | undefined>()` AND a regex test asserting the JSDoc `@throws BiTemporalNotSupportedLocally` annotation is present in `options.ts` above the `asOf` field.

#### TDD
```
RED:     memory_user_returns_scoped_memory — expectTypeOf<Memory['user']>().returns.toEqualTypeOf<ScopedMemory>()
RED:     scoped_remember_returns_memory_items — expectTypeOf<ScopedMemory['remember']>().returns.resolves.toMatchTypeOf<ReadonlyArray<MemoryItem>>()
RED:     no_public_update_method — // @ts-expect-error → `memory.update` should error (D3 invariant)
RED:     scoped_does_not_have_forget — // @ts-expect-error → `memory.user('x').forget(id)` should error
RED:     reflect_returns_reflection_result — expectTypeOf<ScopedMemory['reflect']>().returns.resolves.toEqualTypeOf<ReflectionResult>()
RED:     memory_config_requires_three_deps — `const c: MemoryConfig = {}` should NOT compile (missing required embedder/llm/vectorStore)
RED:     cloud_memory_config_extends_memory_config — expectTypeOf<CloudMemoryConfig>().toMatchTypeOf<MemoryConfig>()
RED:     cloud_memory_config_apiKey_optional — `const c: CloudMemoryConfig = { embedder, llm, vectorStore }` SHOULD compile (apiKey is optional, falls back to THEOKIT_API_KEY at runtime)
RED:     recall_asOf_jsdoc_present — read options.ts (T2.3 output) and assert /@throws BiTemporalNotSupportedLocally/ appears in the 5 lines immediately above the `asOf` declaration
GREEN:   Write memory-store.ts (and ensure T2.3 options.ts has the JSDoc above asOf)
REFACTOR: Cross-reference each method to its ADR (D3 for no-update, D5 for reflect, D6 for asOf, D7 for entityBoost, D9 for apiKey) via /** @see ADR-XXXX */ JSDoc.
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] `MemoryStore`, `Memory`, `ScopedMemory`, `ReflectionResult`, `HistoryEntry`, `MemoryConfig`, `CloudMemoryConfig` exported (seven types)
- [ ] No `update` method on `Memory` or `ScopedMemory` (D3)
- [ ] `forget` only on `Memory`, not on `ScopedMemory`
- [ ] `reflect` returns `Promise<ReflectionResult>` (D5)
- [ ] `RecallOptions.asOf` type is present (D6 bridge) AND the `@throws BiTemporalNotSupportedLocally` JSDoc is above the field in `options.ts` (EC-5)
- [ ] `MemoryConfig.embedder`, `.llm`, `.vectorStore` are required; the rest are optional (EC-1)
- [ ] `CloudMemoryConfig` extends `MemoryConfig` adding optional `apiKey + baseUrl` (D9 + EC-1)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — `memory-store.ts` ≤ 240 lines (raised from 200 to accommodate `MemoryConfig` + `CloudMemoryConfig` per EC-1)

#### DoD
- [ ] `@ts-expect-error` directives in test-d file are intentional (each accompanied by a one-line comment explaining what would compile incorrectly)
- [ ] No `any`

---

## Phase 3: DIP interfaces (VectorStore, LLM, Embedder, HistoryManager, ReflectionPolicy)

**Objective:** Lock the four D8 DIP shapes + the new `ReflectionPolicy` interface (D5). Each lives in `docs/contract/dip/`. Surface-verbatim from Mem0-ts where applicable; new ground for ReflectionPolicy.

### T3.1 — `docs/contract/dip/embedder.ts` + `dip/llm.ts`

#### Objective
Two smallest DIPs first (2 methods each). Used by every other DIP downstream, so they land first.

#### Evidence
Verified at `referencia/mem0/mem0-ts/src/oss/src/embeddings/base.ts` (5 lines) and `referencia/mem0/mem0-ts/src/oss/src/llms/base.ts` (20 lines). D8 locks the counts at 2 each.

#### Files to edit
```
docs/contract/dip/embedder.ts — (NEW)
docs/contract/dip/llm.ts — (NEW)
docs/contract/dip/__tests__/embedder.test-d.ts — (NEW)
docs/contract/dip/__tests__/llm.test-d.ts — (NEW)
```

#### Deep file dependency analysis
- `embedder.ts`: zero internal imports (leaf).
- `llm.ts`: imports `Message` type from `../message.ts` (created in this task as well — single Message type extracted from Mem0-ts's `Message` interface verbatim).

#### Deep Dives
- **`Embedder`:**
  ```ts
  export interface Embedder {
    embed(text: string): Promise<ReadonlyArray<number>>
    embedBatch(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>>
  }
  ```
  Identical to Mem0; types tightened to `ReadonlyArray`.
- **`LLM`:**
  ```ts
  export type Role = 'system' | 'user' | 'assistant'
  export interface Message { readonly role: Role; readonly content: string }

  export interface LLMResponse {
    readonly content: string
    readonly role: Role
    readonly toolCalls?: ReadonlyArray<{ readonly name: string; readonly arguments: string }>
  }

  export interface LLM {
    generateResponse(
      messages: ReadonlyArray<Message>,
      responseFormat?: { readonly type: 'json' | 'text' },
      tools?: ReadonlyArray<unknown>,    // tool shape locked at v0.3 agent-tools layer; v0.0 keeps it opaque
    ): Promise<unknown>
    generateChat(messages: ReadonlyArray<Message>): Promise<LLMResponse>
  }
  ```
  Notes: (a) Tighter `Role` than Mem0's `string`; (b) `tools` shape DELIBERATELY opaque at v0.0 — locked at v0.3; (c) `generateResponse` return is `unknown` because providers return varying shapes (the LLM adapter normalizes at v0.1).
- **`tools` opaque-shape JSDoc (resolves EC-10).** v0.3 (agent-tools layer, roadmap Item 4) will lock a typed tool schema and likely introduce a generic parameter `LLM<TToolShape>` — that IS a breaking type change for adapters that hardcode `tools?: ReadonlyArray<unknown>`. Document the forward-compat path directly above the field in `llm.ts`:
  ```ts
  /**
   * @see ADR-0008 + ADR-0004
   * `tools` is intentionally opaque (`unknown`) at v0.0.
   * v0.3 (agent-tools layer) will lock a typed schema; expect generic
   * `LLM<TToolSchema>` at that point. Adapters targeting v0.0 to v0.3
   * MUST type their tool shape locally (avoid `unknown[]` in adapter code).
   */
  tools?: ReadonlyArray<unknown>
  ```

#### Tasks
1. Write `docs/contract/message.ts` with `Role`, `Message`, `LLMResponse`.
2. Write `docs/contract/dip/embedder.ts`.
3. Write `docs/contract/dip/llm.ts`.
4. Write the two `.test-d.ts` files asserting structural compatibility with a synthetic implementation (stub class with method bodies returning typed dummies).

#### TDD
```
RED:     embedder_implements_2_methods — declare `class StubEmbedder implements Embedder { ... }`; tsc should accept it with exactly the two methods present
RED:     embedder_rejects_extra_method — declare a stub with a third method; structural typing should accept (this is informational, not a failure case)
RED:     llm_role_locked — assert Role is exactly 'system' | 'user' | 'assistant' (no 'function' / 'tool' yet — those land at v0.3)
RED:     llm_generates_response_with_format_optional — expectTypeOf<LLM['generateResponse']>().parameters.toMatchTypeOf<[ReadonlyArray<Message>, ...]>()
GREEN:   Write embedder.ts + llm.ts + message.ts
REFACTOR: None expected (small files).
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] Both DIPs export exactly the interfaces named in D8
- [ ] `Embedder` has exactly 2 methods
- [ ] `LLM` has exactly 2 methods
- [ ] No `any` (tools field uses `unknown` per D8)
- [ ] Pass: lint
- [ ] Pass: size — each file ≤ 40 lines

#### DoD
- [ ] Cross-reference D8 via JSDoc /** @see ADR-0008 */
- [ ] No `any`

---

### T3.2 — `docs/contract/dip/history-manager.ts` (4 required + 3 optional)

#### Objective
Lock the HistoryManager DIP shape with required vs optional methods clearly marked.

#### Evidence
Mem0-ts `referencia/mem0/mem0-ts/src/oss/src/storage/base.ts` (37 lines) — verified. D8 locks 4 required + 3 optional.

#### Files to edit
```
docs/contract/dip/history-manager.ts — (NEW)
docs/contract/dip/__tests__/history-manager.test-d.ts — (NEW)
```

#### Deep file dependency analysis
- Imports `Message` from `../message.ts`.
- Imported by `memory-store.ts` as part of MemoryStore construction config (Phase 4 wiring).

#### Deep Dives
- **Shape:**
  ```ts
  export interface HistoryManager {
    addHistory(
      memoryId: string,
      previousValue: string | null,
      newValue: string | null,
      action: 'remember' | 'forget' | 'reflect',
      createdAt?: Date,
      updatedAt?: Date,
      isDeleted?: boolean,
    ): Promise<void>
    getHistory(memoryId: string): Promise<ReadonlyArray<HistoryEntry>>
    reset(): Promise<void>
    close(): void

    // Optional (V3 messages — only if backend supports session-scoped chat log)
    saveMessages?(messages: ReadonlyArray<Message>, sessionScope: string): Promise<void>
    getLastMessages?(sessionScope: string, limit?: number): Promise<ReadonlyArray<Message & { readonly createdAt: Date }>>
    batchAddHistory?(records: ReadonlyArray<HistoryBatchRecord>): Promise<void>
  }

  export interface HistoryBatchRecord {
    readonly memoryId: string
    readonly previousValue: string | null
    readonly newValue: string | null
    readonly action: 'remember' | 'forget' | 'reflect'
    readonly createdAt?: Date
    readonly updatedAt?: Date
    readonly isDeleted?: boolean
  }
  ```
- **Improvements over Mem0:**
  - `action` is a string-union, not `string` (tighter at compile time)
  - `isDeleted: boolean` not `number`
  - `createdAt`/`updatedAt` are `Date` not `string` (parsed at the adapter boundary)
- **Optional-method shape:** `?` on the property = the implementer can either supply it or omit it. Consumers must check `if (h.saveMessages)` before calling.

#### Tasks
1. Write `history-manager.ts`.
2. Write `.test-d.ts`: declare a "minimal" stub implementing only the 4 required methods (must compile); declare a "full" stub implementing all 7 (must compile); declare a "broken" stub missing one required method (must NOT compile — `@ts-expect-error`).

#### TDD
```
RED:     history_minimal_impl_compiles — class StubMinimal implements HistoryManager { 4 required methods }; tsc accepts
RED:     history_full_impl_compiles — class StubFull implements HistoryManager { all 7 }; tsc accepts
RED:     history_missing_required_fails — // @ts-expect-error → class StubBroken { only 3 of 4 required }
RED:     batch_record_action_is_string_union — expectTypeOf<HistoryBatchRecord['action']>().toEqualTypeOf<'remember' | 'forget' | 'reflect'>()
GREEN:   Write history-manager.ts
REFACTOR: None.
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] `HistoryManager` exported with 4 required + 3 optional methods
- [ ] `HistoryBatchRecord` exported
- [ ] `action` is string-union (not `string`)
- [ ] Pass: lint
- [ ] Pass: size — `history-manager.ts` ≤ 80 lines

#### DoD
- [ ] @see ADR-0008 JSDoc on the interface

---

### T3.3 — `docs/contract/dip/vector-store.ts` (11 methods)

#### Objective
Lock the VectorStore DIP shape. Largest of the four; locks the surface adapters in v0.1+ implement.

#### Evidence
Mem0-ts `referencia/mem0/mem0-ts/src/oss/src/vector_stores/base.ts` (35 lines) — verified. D8 locks 11 methods.

#### Files to edit
```
docs/contract/dip/vector-store.ts — (NEW)
docs/contract/dip/__tests__/vector-store.test-d.ts — (NEW)
```

#### Deep file dependency analysis
- Imports `Filters` from `../scope.ts`.
- Imported by `memory-store.ts` as adapter input.

#### Deep Dives
- **Shape:**
  ```ts
  export interface VectorStoreResult {
    readonly id: string
    readonly payload: Readonly<Record<string, string | number | boolean | null>>
    readonly score?: number
  }

  export interface VectorStore {
    initialize(): Promise<void>
    insert(
      vectors: ReadonlyArray<ReadonlyArray<number>>,
      ids: ReadonlyArray<string>,
      payloads: ReadonlyArray<Record<string, string | number | boolean | null>>,
    ): Promise<void>
    search(
      query: ReadonlyArray<number>,
      topK?: number,
      filters?: Filters,
    ): Promise<ReadonlyArray<VectorStoreResult>>
    keywordSearch(
      query: string,
      topK?: number,
      filters?: Filters,
    ): Promise<ReadonlyArray<VectorStoreResult> | null>
    get(vectorId: string): Promise<VectorStoreResult | null>
    update(
      vectorId: string,
      vector: ReadonlyArray<number>,
      payload: Record<string, string | number | boolean | null>,
    ): Promise<void>
    delete(vectorId: string): Promise<void>
    deleteCol(): Promise<void>
    list(
      filters?: Filters,
      topK?: number,
    ): Promise<readonly [ReadonlyArray<VectorStoreResult>, number]>
    getUserId(): Promise<string>
    setUserId(userId: string): Promise<void>
  }
  ```
- **`keywordSearch` is REQUIRED** in our contract (Mem0 makes it optional). Rationale: BM25 fallback is part of the nine-step search (D1); any v0.1+ adapter MUST support it. If a future adapter can't, it can return `null` to signal "not implemented; skip BM25 component" — but the METHOD must be present.
- **`payload` type tightened** from `Record<string, any>` to typed primitives (matches MemoryItem.metadata).
- **`update` exists on VectorStore but NOT on Memory** (D3) — internal-only; used by reflection / consolidation paths to refresh vectors.
- **`getUserId()` / `setUserId()` are SESSION METADATA, not tenant isolation (resolves EC-6).** Mem0's pgvector adapter uses these as a single-client telemetry hook (the adapter remembers "which client process am I serving"). Our domain expresses tenants via `Scope` (D2). **The two are NOT alternatives.** Tenant isolation in `@usetheo/memory` ALWAYS uses `Filters` (passed through every `insert`/`search`/`list`/`update`/`delete` call); `getUserId`/`setUserId` are kept for Mem0-port parity and adapter-side observability ONLY. JSDoc on each method MUST say so:
  ```ts
  /**
   * @see ADR-0002 — tenant isolation uses `Filters` on every call, NOT this method.
   * This pair is preserved for Mem0-port parity (adapter-side observability / single-client telemetry).
   * Adapters SHALL NOT use `setUserId` to encode the active scope; the call MUST work for every tenant.
   */
  getUserId(): Promise<string>
  setUserId(userId: string): Promise<void>
  ```

#### Tasks
1. Write `vector-store.ts`.
2. Write `.test-d.ts` asserting: 11 methods present; 0 optional; `keywordSearch` returns nullable for opt-out semantics; EC-6 contract note present.

#### TDD
```
RED:     vector_store_has_11_methods — declare stub with all 11; tsc accepts
RED:     vector_store_missing_method_fails — // @ts-expect-error → stub with only 10
RED:     keyword_search_required — assert keyword_search has no `?` on the property (not optional)
RED:     keyword_search_returns_nullable — assert return type is `Promise<... | null>` (opt-out via null)
RED:     vector_store_userId_is_session_metadata_not_isolation_key (EC-6) — read vector-store.ts and assert the JSDoc above `getUserId` matches /tenant isolation uses .*Filters/ AND /SHALL NOT use .*setUserId.*to encode the active scope/
GREEN:   Write vector-store.ts
REFACTOR: None.
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] `VectorStore` exported with exactly 11 required methods
- [ ] `VectorStoreResult` exported
- [ ] `keywordSearch` is required (no `?`) but return is `Promise<... | null>`
- [ ] Pass: lint
- [ ] Pass: size — `vector-store.ts` ≤ 100 lines

#### DoD
- [ ] @see ADR-0008 JSDoc

---

### T3.4 — `docs/contract/dip/reflection-policy.ts` (new DIP for D5)

#### Objective
Lock the ReflectionPolicy DIP. Single implementation `ManualReflectionPolicy` is the only one shipped in v0.0; v0.4a adds `ThresholdReflectionPolicy` + `SleepTimeReflectionPolicy`.

#### Evidence
ADR-0005 (D5) — reflection trigger is explicit-only at v0.0 but the policy interface is locked NOW to avoid a contract change at v0.4a.

#### Files to edit
```
docs/contract/dip/reflection-policy.ts — (NEW)
docs/contract/dip/__tests__/reflection-policy.test-d.ts — (NEW)
```

#### Deep file dependency analysis
- Imports `Scope` from `../scope.ts`, `ReflectionResult` from `../memory-store.ts`, `MemoryStore` from `../memory-store.ts`.
- Imported by `memory-store.ts` as construction-time config.

#### Deep Dives
- **Shape:**
  ```ts
  export interface ReflectionTrigger {
    readonly kind: 'manual' | 'threshold' | 'sleep-time'
    readonly metadata?: Readonly<Record<string, string | number | boolean | null>>
  }

  export interface ReflectionPolicy {
    /** Called by the runtime to decide whether to start a reflection cycle for the given scope. */
    shouldReflect(scope: Scope, trigger: ReflectionTrigger): Promise<boolean>
    /** Called by the runtime when reflection is about to run; the policy can mutate options. */
    onReflectionStart?(scope: Scope, options: ReflectOptions): Promise<void>
    /** Called by the runtime after reflection completes (success or failure). */
    onReflectionEnd?(scope: Scope, result: ReflectionResult | Error): Promise<void>
  }
  ```
- **`ManualReflectionPolicy` (the only impl in v0.0):**
  ```ts
  // Type-only declaration in contract; v0.1 ships the class.
  export interface ManualReflectionPolicy extends ReflectionPolicy {
    readonly kind: 'manual'
  }
  ```
- **Why a DIP for something with only one implementation at v0.0.** Per `architecture.md § 3 Dependency direction` + `global CLAUDE.md PARTE II § 13.5 DIP` — abstractions only when "there is variation real or necessity of testability". Variation is real (v0.4a adds two more implementations). Testability is also real (v0.1's `Memory` constructor accepts any `ReflectionPolicy`).

#### Tasks
1. Write `reflection-policy.ts`.
2. Write `.test-d.ts`: assert structural compatibility of `ManualReflectionPolicy` with `ReflectionPolicy`; assert `shouldReflect` is required; `onReflectionStart` and `onReflectionEnd` are optional.

#### TDD
```
RED:     reflection_policy_required_method — assert `shouldReflect` has no `?` on the property
RED:     manual_policy_extends_reflection_policy — expectTypeOf<ManualReflectionPolicy>().toMatchTypeOf<ReflectionPolicy>()
RED:     reflection_trigger_kind_locked — assert kind is exactly 'manual' | 'threshold' | 'sleep-time'
GREEN:   Write reflection-policy.ts
REFACTOR: None.
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] `ReflectionPolicy`, `ReflectionTrigger`, `ManualReflectionPolicy` exported
- [ ] `shouldReflect` is required
- [ ] `onReflectionStart` / `onReflectionEnd` are optional
- [ ] Pass: lint
- [ ] Pass: size — `reflection-policy.ts` ≤ 60 lines

#### DoD
- [ ] @see ADR-0005 + ADR-0008 JSDoc

---

## Phase 4: Subpath exports + barrel `index.ts`

**Objective:** Wire the `docs/contract/` files into a single importable surface. v0.0 ships a barrel `docs/contract/index.ts` that re-exports everything. v0.1+ will move these files into `src/core/` and into `src/index.ts`; v0.0 keeps them under `docs/contract/` to signal "not yet released".

### T4.1 — `docs/contract/index.ts` barrel + `package.json#exports` map (preview)

#### Objective
Single barrel re-exporting all contract types. Update `package.json#exports` map with `"./contract"` (preview entry pointing at `docs/contract/index.ts`) — clearly NOT a release path, but lets consumers do `import type { Memory } from '@usetheo/memory/contract'` locally for design exploration.

#### Evidence
Roadmap Item 1 acceptance is satisfied without an exports map (only `tsc` passes is required). But adding the preview entry makes the v0.1 migration trivial — we already know the import paths.

#### Files to edit
```
docs/contract/index.ts — (NEW) — re-exports all types
package.json — (UPDATE) — exports map with "./contract" entry (preview)
```

#### Deep file dependency analysis
- `index.ts` imports + re-exports types from every Phase 2/3 file.
- `package.json` gains an `"exports"` block; the `"."` entry remains absent (no default; v0.1 introduces it).

#### Deep Dives
- **Barrel content shape:**
  ```ts
  export type { Scope, UserScope, SessionScope, AgentScope, Filters } from './scope'
  export type { MemoryItem, MemoryItemWithScore } from './memory-item'
  export type { RememberOptions, RecallOptions, ForgetOptions, ReflectOptions, GetAllOptions } from './options'
  export type {
    Memory, MemoryStore, ScopedMemory, ReflectionResult, HistoryEntry,
  } from './memory-store'
  export {
    MemoryNotFound, InvalidScope, EmbeddingMismatch,
    BiTemporalNotSupportedLocally, ReflectionNotConfigured,
  } from './errors'
  // DIPs
  export type { Embedder } from './dip/embedder'
  export type { LLM, LLMResponse, Role, Message } from './dip/llm'
  export type { VectorStore, VectorStoreResult } from './dip/vector-store'
  export type { HistoryManager, HistoryBatchRecord } from './dip/history-manager'
  export type { ReflectionPolicy, ReflectionTrigger, ManualReflectionPolicy } from './dip/reflection-policy'
  ```
- **`export type` vs `export`.** Almost everything is `export type` (interface re-export). Errors are real classes → `export` (no type prefix).
- **`package.json#exports` shape (resolves EC-3).** v1.0 originally proposed `"default": null` to block runtime imports of the preview path. Edge-case review surfaced two problems: (a) Node 20+ resolves `null` as `ERR_PACKAGE_PATH_NOT_EXPORTED`, which is intended but UNTESTED for TypeScript's `moduleResolution: "node20"` behavior with a sibling `types` key; (b) Sub-goal 6 ("compile-checks via `@usetheo/memory/contract`") requires type resolution to succeed via the package path. Trading the `null` block for an explicit path is safer:
  ```json
  {
    "exports": {
      "./contract": {
        "types": "./docs/contract/index.ts",
        "default": "./docs/contract/index.ts"
      }
    }
  }
  ```
  Runtime safety still holds via `"private": true` (set in T0.1) — no `npm publish` is possible before v0.1. If someone clones the repo and tries `import { Memory }` (without `type`) at the package path, Node will attempt to load the `.ts` file directly and fail with a parser error — that is acceptable runtime feedback, no worse than `ERR_PACKAGE_PATH_NOT_EXPORTED`.

#### Tasks
1. Write `docs/contract/index.ts`.
2. Update `package.json` with the exports map (only the `./contract` preview path; `default` points to the same TS file as `types`).
3. Add `_v0_0_exports_preview_only` sibling key in `package.json` with value `true` as a self-documenting flag explaining that this exports map is contract-preview-only until v0.1 lands `src/` + a real bundler config (JSON has no comments — sibling key is the convention).

#### TDD
```
RED:     barrel_re_exports_all — for each expected export name, write a test-d file that imports it from '../index' and asserts the type matches
RED:     types_resolve_via_package_path — write a test-d that does `import type { Memory } from '@usetheo/memory/contract'`; tsc must accept it WITHOUT a `paths` map workaround (asserts the `types` key in exports works) — note: this requires the repo's own package to be resolvable as `@usetheo/memory` locally; achieve via `npm link` in CI OR via tsconfig `paths` entry that mirrors the exports map (`paths: { "@usetheo/memory/contract": ["./docs/contract/index.ts"] }`)
RED:     no_default_export_path_collision — assert package.json has exactly one entry under `exports["./contract"]` (no `import` / `require` conditional split)
GREEN:   Write index.ts + update package.json (with the new exports map + `_v0_0_exports_preview_only` flag)
REFACTOR: Sort exports alphabetically within each section for stable diffs.
VERIFY:  npm run typecheck && npm test
```

#### Acceptance Criteria
- [ ] `docs/contract/index.ts` re-exports every interface/type/class from Phase 2/3
- [ ] `package.json#exports` has the `./contract` preview entry with `default` pointing to the same TS file as `types` (EC-3)
- [ ] `package.json._v0_0_exports_preview_only: true` flag present
- [ ] No `"."` entry in exports (locks v0.0 from accidental default import)
- [ ] A test-d file using `import type { Memory } from '@usetheo/memory/contract'` compiles via tsconfig `paths` map (EC-3)
- [ ] Pass: lint
- [ ] Pass: size — `index.ts` ≤ 100 lines (raised from 80 to accommodate `MemoryConfig` + `CloudMemoryConfig` exports added per EC-1)

#### DoD
- [ ] Importing via the package preview path (e.g., in a sibling test) compiles
- [ ] No emoji in index.ts

---

## Phase 5: Integration Validation (MANDATORY)

> Per `cycle-plan.md § Phase contracts` and the template's mandate. The phase confirms the entire chain compiles + tests pass.

**Objective:** Validate the implemented contract works end-to-end. Without it, the plan is not complete.

### T5.1 — Final validation chain + grep gates + reference-citation existence audit

#### Objective
Run the full validation chain (`npm install` → `npm run typecheck` → `npm test` → `npm run lint`) AND execute the three honesty grep gates (no `production-ready` claims, no emoji, all `referencia/` paths resolve). The gate that closes v0.0.

#### Evidence
`cycle-plan.md § Phase contracts` mandates an Integration Validation phase. Coverage Matrix gaps #12 (no production-ready token), #20 (plan compatible with v0.1-v1.4 — ADR consequences/reversibility verified), and #24 (refined Phase 5 grep gates with context-aware exclusions per EC-4) all depend on this task.

#### Files to edit
```
(no files edited — task is verification-only; produces the report consumed by /plan-confidence + /review)
```

#### Deep file dependency analysis
- Reads the full repo state produced by Phases 0-4.
- Writes no artifacts; emits stdout report.

#### Tasks
1. Run `npm install` (devDeps only resolve since no runtime deps).
2. Run `npm run typecheck` — `tsc --noEmit -p tsconfig.contract.json` returns 0.
3. Run `npm test` — vitest exit 0 with all type-level tests passing.
4. Run `npm run lint` — zero warnings on `docs/contract/**/*.ts`.
5. Execute the three grep gates (commands listed in `### Acceptance Criteria` below). Each must return empty stdout.

#### TDD
```
RED:     phase5_validation_chain_failing — before Phases 0-4 land, the chain MUST fail (no package.json yet)
GREEN:   Phases 0-4 ship; T5.1 chain executes successfully end-to-end
REFACTOR: None.
VERIFY:  cycle-implement.md /implement-validate gate
```

#### Acceptance Criteria
See `### Acceptance Criteria` block immediately below (shared across phase and task).

#### DoD
- [ ] All four validation commands return exit code 0
- [ ] All three grep gates return empty stdout
- [ ] Final report (stdout) attached to `cycle-implement.md` validate-report

### Execution

```bash
npm install                                     # baseline dep install
npm run typecheck                               # tsc --noEmit on docs/contract/
npm test                                        # vitest type-level tests
npm run lint                                    # zero warnings on docs/contract/**/*.ts
```

### Acceptance Criteria

- [ ] `npm install` exits 0 with zero errors
- [ ] `npm run typecheck` exits 0 with no diagnostics
- [ ] `npm test` exits 0 with all type-level tests passing
- [ ] `npm run lint` exits 0 with zero warnings on `docs/contract/**/*.ts`
- [ ] All four DIPs (+ ReflectionPolicy) verifiable via type-level synthetic implementations in `__tests__/`
- [ ] **No `production-ready` claim added by this plan (EC-4 — context-aware grep gate).** Run:
  ```bash
  grep -rnE "production[- ](ready|grade)" docs/contract/ docs/adrs/ package.json README.md CHANGELOG.md \
    | grep -v -E "CANNOT|MUST NOT|forbidden|locked|gate|never|ban|claim"
  ```
  Exit 0 with empty stdout = pass. The post-filter excludes occurrences where the phrase is the SUBJECT of a prohibition (e.g., ADR-0011-style "MUST NOT claim production-ready before v1.0"), which are intentional and required by the dogfood golden rule.
- [ ] **No emoji added by this plan (EC-4 — explicit Unicode ranges).** Run:
  ```bash
  grep -rnP "[\x{1F300}-\x{1FAFF}]|[\x{2600}-\x{27BF}]|[\x{1F000}-\x{1F2FF}]" docs/contract/ docs/adrs/ package.json README.md CHANGELOG.md
  ```
  Exit non-zero (no matches) = pass.
- [ ] **Every `referencia/` citation in ADRs and the plan resolves via `Path.exists()` check.** Run a helper:
  ```bash
  grep -roE "referencia/[a-zA-Z0-9/_.-]+" docs/adrs/ .claude/knowledge-base/plans/memory-contract-v0-0-plan.md \
    | awk -F: '{print $NF}' | sort -u \
    | while read p; do test -e "$p" || echo "MISSING: $p"; done
  ```
  Empty stdout = all paths exist.
- [ ] Runtime-metric proof — N/A (v0.0 is types-only; no runtime counters exist yet)

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing (greenfield; nothing pre-existing applies).
2. Fix all plan-caused failures before declaring the plan complete.
3. Re-run the validation chain to confirm fixes.
4. If a fix requires re-opening an ADR (e.g., a DIP method signature changes), bump the plan version (`Version 1.0 → 1.1`) and re-run `/edge-case-plan` + `/plan-confidence` before continuing.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `tsc --noEmit` passes on `docs/contract/*.ts` | T0.2, T2.1-T2.5, T3.1-T3.4, T4.1, Phase 5 | tsconfig.contract.json strict config + every file ships under `docs/contract/`; Phase 5 verifies via `npm run typecheck` |
| 2 | 4 DIP interfaces declared (`VectorStore`, `LLM`, `Embedder`, `HistoryManager`) | T3.1 (Embedder, LLM), T3.2 (HistoryManager), T3.3 (VectorStore) | Each DIP is its own file under `docs/contract/dip/` with method counts locked by D8 |
| 3 | ADR per locked decision: Mem0-shape, three-scope, ADD-only, API verbs | T1.1 | ADR-0001..0004 filed at `docs/adrs/` |
| 4 | Q2 — `update()` semantics inside ADD-only | T1.2 (ADR-0003 expanded by D3 + reaffirmed in D8), T2.5 (Memory interface has no `update`), T2.5 test-d (`@ts-expect-error`) | ADR-0003 + contract surface excludes `update` + type test asserts compile error |
| 5 | Q3 — Reflection trigger | T1.2 (ADR-0005), T3.4 (`ReflectionPolicy` DIP), T2.3 (`ReflectOptions`), T2.5 (`reflect` on ScopedMemory + Memory) | Explicit-method at v0.0 + DIP for future policies |
| 6 | Q4 — Bi-temporal `t_valid` / `t_invalid` columns | T1.2 (ADR-0006), T2.2 (MemoryItem has `tValid`/`tInvalid`), T2.3 (RecallOptions has `asOf?`), T2.4 (`BiTemporalNotSupportedLocally` error) | Type contract uniform across runtimes; runtime divergence via typed error |
| 7 | Q5 — Entity store opt-out via `entityBoost: false` | T1.2 (ADR-0007), T2.5 (`MemoryConfig.entityBoost?: boolean` defined in Deep Dive, EC-1 absorbed) | Constructor flag, default `true`; type defined in `memory-store.ts` |
| 8 | Q6 — `THEOKIT_API_KEY` reuse | T1.2 (ADR-0009), T2.5 (`CloudMemoryConfig.apiKey?: string` override defined in Deep Dive, EC-1 absorbed) | Reuse with optional override; type defined in `memory-store.ts` |
| 9 | TypeScript strict mode enforced | T0.2 (tsconfig flags) | strict + noUncheckedIndexedAccess + noImplicitAny + exactOptionalPropertyTypes |
| 10 | No `any` in contract | T0.3 (ESLint rules), every T2/T3 task review | typescript-eslint strict + manual review |
| 11 | No emoji anywhere (Inquebrável + architecture.md) | Phase 5 grep gate, T1.1/T1.2 ADR TDD | Validation gate fails if emoji present |
| 12 | No `production-ready` token (dogfood golden rule) | T5.1 | T5.1 grep gate fails if token present |
| 13 | Three-tier scope sub-objects with type narrowing | T2.1 (Scope union + narrow types), T2.5 (Memory.user/.session/.agent), T2.5 test-d (narrowing assertions) | Discriminated union + sub-object form |
| 14 | ADD-only invariant enforced at type level | T2.5 (no `update` method), T2.5 test-d (`@ts-expect-error`) | Method absent + compile error if attempted |
| 15 | Subpath exports preview for `@usetheo/memory/contract` | T4.1 | package.json#exports `./contract` entry |
| 16 | CHANGELOG.md `[Unreleased]` updated | T1.2 DoD + T0.1 DoD | One entry per phase touching public surface |
| 17 | Cycle-plan compliance: `## Dependencies` section with Rule 9 evaluation | T0.1 | T0.1 ships `package.json` consuming the deps declared in `## Dependencies` (six NEW with Rule 9 + version pin) |
| 18 | Type-level testing infrastructure (vitest `expectTypeOf`) | T0.3, every T2/T3 `.test-d.ts` | `test.typecheck.enabled: true` in vitest config |
| 19 | Mem0-ts citations resolve (every `referencia/` path verified) | T1.1, T1.2, T5.1 | T1.1+T1.2 cite `referencia/mem0/...` in ADR Evidence; T5.1 grep gate runs the `Path.exists()` audit script |
| 20 | Plan compatible with v0.1-v1.4 (no design that boxes out future items) | T1.1, T1.2 | T1.1+T1.2 ship ADRs D1-D9; each ADR includes a Consequences/Reversibility section documenting forward-compat cost (D6 bridges local/cloud asOf divergence; D7/D8 lock extensibility) |
| 21 | EC-1 — `MemoryConfig` + `CloudMemoryConfig` defined and exported | T2.5 (Deep Dive, Tasks, TDD, Acceptance, barrel export in T4.1) | Types declared in `memory-store.ts`; barrel re-exports them; TDD asserts required vs optional fields |
| 22 | EC-2 — Error subclasses survive cross-module `instanceof` | T2.4 (Deep Dive template + runtime TDD + Acceptance) | `Object.setPrototypeOf(this, ClassName.prototype)` in every error constructor; vitest runtime `instanceof` test asserts behavior |
| 23 | EC-3 — `package.json#exports` default points to a real path (not `null`) | T4.1 (Deep Dive + Tasks + Acceptance) | `"default": "./docs/contract/index.ts"`; `private: true` blocks publish; sibling `_v0_0_exports_preview_only: true` flag |
| 24 | EC-4 — Phase 5 grep gates use context-aware exclusions | T5.1 | T5.1 acceptance ships the three refined grep commands: `grep -v -E "CANNOT\|MUST NOT\|forbidden..."` post-filter for production-ready scan; explicit Unicode ranges for emoji scan; `Path.exists()` audit helper for citations |
| 25 | EC-5 — `asOf` JSDoc divergence warning above field | T2.5 TDD `recall_asOf_jsdoc_present` + T2.3 ships the JSDoc | Regex test asserts `@throws BiTemporalNotSupportedLocally` is in `options.ts` above `asOf` |
| 26 | EC-6 — VectorStore.getUserId/setUserId are session metadata, NOT tenant isolation | T3.3 (Deep Dive + TDD `vector_store_userId_is_session_metadata_not_isolation_key`) | JSDoc on the methods explicitly states tenant isolation uses `Filters`; adapter contract clarified |
| 27 | EC-7 — ESLint v9 flat config + typescript-eslint v7 + `eslint-plugin-import` smoke-test | T0.3 Acceptance + `## Dependencies` (added eslint-plugin-import) | `npx eslint --print-config docs/contract/index.ts` exits 0; plugin dep declared with Rule 9 |
| 28 | EC-8 — CLAUDE.md edits to § Open questions are additive-only (audit trail) | T1.2 Deep Dive (additive-only constraint) | Question text preserved verbatim; only RESOLVED annotation appended below |
| 29 | EC-9 — `MemoryItem.metadata` flat-primitives-only JSDoc | T2.2 Deep Dive (locked JSDoc above field) | JSDoc states "Flat key-value payload. Primitives only..."; v1.4 ontologies path documented for forward-compat |
| 30 | EC-10 — `LLM.tools` opaque-shape v0.0→v0.3 forward-compat JSDoc | T3.1 Deep Dive (locked JSDoc above field) | JSDoc references ADR-0008 + ADR-0004 + v0.3 generic plan; adapters warned to type tool shape locally |
| 31 | EC-11 — npm name reservation v0.1 readiness check | T0.1 DoD (CHANGELOG `Known issues` note) | One-line CHANGELOG entry under `Known issues`; deferred to v0.1 kickoff; v0.0 `"private": true` blocks accidental publish |

**Coverage: 31/31 gaps covered (100%).**

## Global Definition of Done

- [ ] All phases completed (Phase 0 → 5)
- [ ] All tests passing — `npm test` green
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected — every `.ts` ≤ 200 lines, every ADR ≤ 200 lines (per `.claude/rules/architecture.md § Module hygiene`; ADRs use the same budget for consistency)
- [ ] CHANGELOG.md updated under `[Unreleased]` — one `Added` entry referencing plan slug `memory-contract-v0-0` for the contract files and one `Added` entry for ADR-0001..0009
- [ ] Backward compatibility preserved — N/A (greenfield; no prior public API to break)
- [ ] No `production-ready` token added by this plan (grep gate)
- [ ] No emoji added by this plan (grep gate)
- [ ] Every `referencia/` path cited in the plan and ADRs resolves via `Path.exists()` — verified by `/discover-confidence`-style check (manual at v0.0; automated at v0.1+ via the symbol-fabrication detector from `/code-quality` D2)
- [ ] All five open questions Q2-Q6 from `CLAUDE.md § Open questions` are annotated RESOLVED with ADR cross-links
- [ ] Runtime-metric proof — N/A (no runtime code at v0.0; metric requirement re-enters at v0.1)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has been merged to `main`, move `.claude/knowledge-base/plans/memory-contract-v0-0-plan.md` to `.claude/knowledge-base/plans/completed/memory-contract-v0-0-plan.md` per `.claude/rules/audit-trail-rotation.md § KEEP forever` (active vs completed lifecycle).

## Final Phase: Integration Validation (MANDATORY)

> See Phase 5 above — the integration validation phase is structured as a normal phase for fidelity to the cycle-plan contract, but its acceptance criteria + DoD are the entire plan's final gate, not just a phase's gate.
