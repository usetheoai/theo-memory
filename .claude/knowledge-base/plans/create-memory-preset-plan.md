---
slug: create-memory-preset
created_at: 2026-07-12
goal: Add a zero-config preset overload to createMemory so an in-process consumer boots a working Memory from a Postgres URL + OpenAI key
---

# Plan: Zero-config `createMemory` preset overload

> **Version 1.1** (2026-07-12 — absorbed 3 MUST FIX + 3 SHOULD TEST from `knowledge-base/reviews/create-memory-preset-edge-cases-2026-07-12.md`: EC-1 pool-leak-on-failure, EC-2 corrected GOAL-TEST assertion, EC-3 dropped unhonorable `embeddingDim` override, EC-4/5/6 added negative tests). — Today the only in-process entry point, `createMemory`, is a byte-identical alias of `createLocalMemory` (`factory.ts:287`) and requires the consumer to hand-construct three adapters (`embedder`, `llm`, `vectorStore`), open a `pg.Pool`, call `runMigrations`, and keep `embeddingDim` consistent across all three (a documented footgun guarded by `EmbeddingMismatch` / `InvalidCacheConfig`). This plan adds a **non-breaking preset overload** so `createMemory({ postgres, openai })` wires `OpenAIEmbedder` + `OpenAILLM` + `PgvectorStore` + `pg.Pool`, auto-runs migrations by default (opt-out `{ migrate: false }`), owns the pool lifecycle, and returns a working `DisposableMemory`. Existing callers and `createLocalMemory` are untouched. The expected outcome: in-process onboarding drops from ~12 lines + 3 adapter decisions to one call, closing the biggest in-process DX gap (P0 hardening sub-goal 2 — "SDKs 100% functional").

## Goal

> "Enable an in-process `@usetheo/memory` consumer to boot a working `Memory` from just a Postgres URL and OpenAI key via `createMemory({ postgres, openai })`, measured by the integration test `create-memory preset wires pool + migrations + store and round-trips remember+recall in top-k` (`tests/integration/create-memory-preset.test.ts`) returning green against real `ankane/pgvector:v0.5.1`."

## Context

The prior conversation established (verified by grep, not docs) that TheMemory ships a mature in-process SDK but the entry point does not reduce any wiring: `createMemory` is `export { createLocalMemory as createMemory }` (`packages/core/src/infrastructure/db/factory.ts:287`, re-exported at `packages/core/src/index.ts:61`). A consumer integrating in-process must construct `OpenAIEmbedder`, `OpenAILLM`, a `pg.Pool`, a `PgvectorStore(pool, { embeddingDim })`, and call `runMigrations(pool, { embeddingDim })` — with `embeddingDim` (1536 for OpenAI `text-embedding-3-small`) threaded identically through embedder ↔ store ↔ migrations or the boot fails via a dim-mismatch guard.

The project owner chose (this session) the "preset factory zero-config" DX lever, non-breaking via an overload on `createMemory`, with auto-migrate as an opt-out default. This plan implements exactly that scope — no new capability, only a convenience constructor over the existing `createLocalMemory` contract. The freeze on features is lifted (CLAUDE.md Amendment 2026-06-21) and this work qualifies as P0 hardening regardless.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/infrastructure/db/factory.ts` | 287 | `147001d` (2026-06-23) | Holds `createLocalMemory` (the real factory) + cache/embedding helpers; re-exports `createLocalMemory as createMemory` at line 287 | `createLocalMemory(config: LocalMemoryConfig)` signature + behavior UNCHANGED; must stay ≤ 500 LoC (`architecture.md`); the `createMemory` export name MUST remain (`matrix.test.ts:106`) |
| `packages/core/src/infrastructure/db/preset.ts` (NEW) | 0 | — | (file to be created) — preset resolver + pool-owning assembly | — |
| `packages/core/src/infrastructure/db/config.ts` | 204 | `69927b2` (2026-07-12) | `LocalMemoryConfig` type + `EvictionNotSupported` | Existing `LocalMemoryConfig` shape unchanged; new preset type is additive |
| `packages/core/src/index.ts` | 210 | `b0de550` (2026-07-10) | Public barrel; exports `createMemory`, `createLocalMemory`, `runMigrations`, types | Every existing export stays; `createMemory` type must still accept `LocalMemoryConfig` (`index.test-d.ts:103`) |
| `packages/core/src/infrastructure/db/preset.test.ts` (NEW) | 0 | — | (file to be created) — unit tests for discrimination + env-set + migrate opt-out + dim default | — |
| `tests/integration/create-memory-preset.test.ts` (NEW) | 0 | — | (file to be created) — GOAL TEST: preset round-trip vs real pgvector | — |
| `CHANGELOG.md` | (large) | — | Public contract | Append under `[Unreleased] § Added` only (Unbreakable Rule 6) |

Every file listed in a task's `#### Files to edit` appears here.

### Current callers / dependents

- **Symbol:** `createMemory` — exported from `packages/core/src/index.ts:61` (re-export of `factory.ts:287`).
  - **Callers (production):** `packages/api/src/server/index.ts:5` — JSDoc reference only ("Caller wires `createMemory({ ... })`"), no runtime call (verified: only match is the doc comment).
  - **Callers (tests):** `packages/core/src/domain/index.test-d.ts:103` (type test — asserts `createMemory(config): Memory`); `tests/integration/p0-audit/matrix.test.ts:106` (asserts export name present); `tests/integration/p0-audit/full-public-surface.test.ts:93` (surface enumeration).
  - **External (public API consumed by other repos):** yes — `@usetheo/memory` is published; `createMemory` is a documented public export. The overload is **additive** (a new accepted input shape); the existing `LocalMemoryConfig` input path is byte-compatible, so no consumer breaks.
- **Symbol:** `createLocalMemory` — NOT modified by this plan (the preset delegates to it).
- **Symbol:** `OpenAIEmbedder` (`embedders/openai.ts:51`) / `OpenAILLM` (`llms/openai.ts`) — read `process.env['OPENAI_API_KEY']` lazily (`openai.ts:44`); no constructor `apiKey` param today. Not modified; the preset feeds the key via env (ADR D2).

### Domain glossary

- **`createLocalMemory`** — the ADR-0008 DIP-shaped factory; takes a fully-wired `LocalMemoryConfig` (`embedder` + `llm` + `vectorStore` required) and returns a `DisposableMemory`.
- **`DisposableMemory`** — the `Memory` interface plus a `dispose()` that releases resources; the preset extends `dispose()` to also `pool.end()` the pool it created.
- **`embeddingDim`** — the vector dimensionality that MUST match across embedder output, `PgvectorStore` HNSW column, and `runMigrations`. OpenAI `text-embedding-3-small` = 1536 = `MAX_EMBEDDING_DIM` (`constants.ts:21`).
- **`runMigrations(pool, { embeddingDim })`** — Drizzle migration runner; must run once per fresh DB before the store is used.
- **preset shape** — the new zero-config input `{ postgres: string, openai?: string, migrate?: boolean }`, distinct from `LocalMemoryConfig` (no `embeddingDim` — fixed at 1536 per D4).

### Architecture boundaries affected

- Per `architecture.md § 2` (Dependency Inversion): the preset lives in the **infrastructure** layer (`infrastructure/db/preset.ts`) — it is a composition-root convenience that wires concrete adapters (`OpenAIEmbedder`, `PgvectorStore`) into the `createLocalMemory` port. It does NOT add a domain dependency on a concrete driver; the domain (`Memory` interface) is untouched. The `pg` driver + OpenAI HTTP client are already declared deps (rung 4 of the parsimony ladder — reuse, no new dependency).
- No new public DIP interface is introduced (the preset is a factory, not a port), so ADR-0008 method-count caps are not engaged.

## Prior Art & Related Work

- **Internal precedent — env-shift for adapter keys:** `examples/chat-with-memory/lib/memory.ts:189` (`adaptOpenrouterEnvForDemo`) sets `process.env.OPENAI_API_KEY` from a caller-supplied key before constructing `OpenAILLM`, because the OpenAI SDK reads the key from env. This plan reuses that established in-repo pattern (ADR D2), scoped to the SDK factory instead of the demo.
- **Internal precedent — factory default injection:** `factory.ts:155` `createLocalMemory` already defaults optional collaborators (reflection policy, entity ports) when omitted — the preset extends the same "sane default" philosophy one level up.
- **Internal precedent — exported test seams:** `examples/chat-with-memory/lib/memory.ts` exports internal helpers (`resolveBackendMode`, `warnIfLocalOpenrouterMissingBaseUrl`) `@internal` for unit-testing without booting the full singleton; the preset applies the same seam (`assemblePresetMemory`) so the deterministic GOAL TEST does not require a live OpenAI key.
- **Patterns skills:** (none — no `skills/*-patterns/` exist in this repo; verified `ls .claude/skills/ | grep -i pattern` → none).
- **External literature:** (none required — this is an in-repo convenience constructor over an existing factory.)

## Objective

- [ ] `createMemory` accepts the preset shape `{ postgres, openai?, migrate? }` (NO `embeddingDim` — D4/EC-3) in addition to `LocalMemoryConfig`, discriminated at runtime + at the type level.
- [ ] The preset opens a `pg.Pool` from `postgres`, wires `OpenAIEmbedder` + `OpenAILLM` (key via env per ADR D2) + `PgvectorStore(pool, { embeddingDim: 1536 })`, and returns a working `DisposableMemory`.
- [ ] By default the preset runs `runMigrations(pool, { embeddingDim })`; `{ migrate: false }` skips it.
- [ ] The returned `DisposableMemory.dispose()` also `pool.end()`s the pool the preset created (no leak).
- [ ] `createLocalMemory` and every existing `createMemory` caller/type-test remain green (non-breaking).
- [ ] GOAL TEST green: preset round-trips remember+recall in top-k against real `ankane/pgvector:v0.5.1`.

## ADRs

### D1 — Non-breaking discriminated-union overload on `createMemory`

- **Decision:** `createMemory` accepts `LocalMemoryConfig | CreateMemoryPresetConfig`. Discrimination is by the presence of the `postgres` field (preset) vs `embedder`/`llm`/`vectorStore` (full config). If `postgres` is present, dispatch to the preset resolver; otherwise dispatch to `createLocalMemory` verbatim.
- **Rationale:** Preserves the public export name (`matrix.test.ts:106`) and the full-config type path (`index.test-d.ts:103`) while adding the zero-config shape — the project-owner's chosen non-breaking approach. Keeps a single well-known entry point (KISS) rather than growing the ~60-symbol barrel.
- **Alternatives considered:** (a) New symbol `createMemoryFromEnv` — rejected: adds a barrel symbol and a second "how do I start" answer, worsening discoverability. (b) Breaking replacement of `createMemory` with preset-only semantics — rejected: breaks the example + the intent behind `matrix.test.ts`, and forces existing consumers to migrate for no benefit (pre-release makes it *allowed*, not *desirable*).
- **Consequences:** Enables one-call boot; constrains the discriminator field name (`postgres`) to never collide with a `LocalMemoryConfig` field (it does not — `LocalMemoryConfig` has no `postgres` key, verified against `config.ts` + `MemoryConfig`).

### D2 — Feed the OpenAI key to the adapters via `process.env`, key optional

- **Decision:** When `openai` is provided, the preset sets `process.env.OPENAI_API_KEY = openai` **before** constructing `OpenAIEmbedder` / `OpenAILLM`. When `openai` is omitted, the adapters fall back to the existing `process.env.OPENAI_API_KEY` (today's behavior).
- **Rationale:** `OpenAIEmbedder` (`openai.ts:44`) and `OpenAILLM` read the key lazily from `process.env['OPENAI_API_KEY']` and expose no constructor `apiKey` param. Setting env mirrors the established in-repo pattern (`adaptOpenrouterEnvForDemo`, Prior Art) and keeps the change surface to the new preset file only (KISS + parsimony rung 5).
- **Alternatives considered:** Extend `OpenAIEmbedder` + `OpenAILLM` constructors to accept `{ apiKey }` — rejected for THIS plan: it widens two public class constructors (P0 "all public APIs correct" review surface) for marginal gain, and can be a clean follow-up if a consumer needs multiple keys per process. Recorded as a Drawback (global-env side-effect) with mitigation.
- **Consequences:** Enables zero-config with a passed key; constrains: the preset mutates process-global `OPENAI_API_KEY` (documented + mitigated in Drawbacks; omit `openai` to avoid the mutation and use ambient env).

### D3 — Auto-migrate by default, opt-out via `{ migrate: false }`; preset owns the pool

- **Decision:** The preset calls `runMigrations(pool, { embeddingDim })` by default; `migrate: false` skips it. The returned `DisposableMemory.dispose()` wraps `createLocalMemory`'s dispose to also `await pool.end()`.
- **Rationale:** Auto-migrate kills the "forgot to migrate" + dim-mismatch footgun the plan exists to solve, and aligns with the migrate-on-startup discipline of `themory server` (CLAUDE.md Item 18). The preset creates the pool, so by RAII it must close it (no leak — Unbreakable Rule 8 resource discipline).
- **Alternatives considered:** No auto-migrate (consumer calls `runMigrations`) — rejected: leaves the primary footgun open, defeating the plan's purpose. Always-migrate with no opt-out — rejected: some consumers run migrations out-of-band (CI/ops), so the escape hatch is required.
- **Consequences:** Enables true one-call boot on a fresh DB; constrains: dispose semantics now differ between preset (ends pool) and full-config (does not own pool) — documented in the preset's JSDoc.

### D4 — Fix `embeddingDim` at 1536; NO override on the preset (revised v1.1 per EC-3)

- **Decision:** The preset hard-fixes `embeddingDim = MAX_EMBEDDING_DIM` (1536) and does NOT expose an `embeddingDim` field. The preset always constructs `OpenAIEmbedder` (`text-embedding-3-small`, 1536-dim output).
- **Rationale:** The preset's embedder is fixed, so any override could ONLY ever mismatch the embedder's 1536 output → `probeEmbedder` throws `EmbeddingMismatch` (`factory.ts`), making the field a guaranteed footgun (EC-3). Dropping it is the parsimony rung-1 call (YAGNI) and keeps the zero-config surface minimal + correct (P0 "all public APIs correct").
- **Alternatives considered:** Accept an optional `embeddingDim` override (v1.0 design) — rejected per EC-3: the preset cannot swap the embedder to honor a non-1536 dim, so the override can only break the boot. A consumer needing a different dim uses the full-config `createLocalMemory` path (which accepts a custom embedder + `embeddingDim`).
- **Consequences:** Enables dim-free boot with zero dim knowledge; constrains the preset to 1536 (the correct value for the fixed OpenAI embedder). Full-config path remains the escape hatch for custom dims.

### D5 — Preset logic lives in a NEW `preset.ts`, dispatched from `factory.ts`

- **Decision:** The preset resolver + pool-owning assembly go in `packages/core/src/infrastructure/db/preset.ts`. `factory.ts` gains a thin `createMemory` dispatcher (discriminate → delegate) replacing the current alias re-export.
- **Rationale:** `factory.ts` is 287 LoC; inlining the preset would crowd it toward the 500-LoC budget (`architecture.md`) and mix "the core factory" with "a convenience preset" (SRP). A dedicated file keeps each concern testable in isolation.
- **Alternatives considered:** Inline in `factory.ts` — rejected on SRP + budget grounds.
- **Consequences:** One new file; `factory.ts`'s `createMemory` export becomes a real function (not an alias), still exported through the same barrel path.
- **Seam export locus (SEPA brief absorbed):** `assemblePresetMemory` is `@internal` — NOT added to the `index.ts` barrel. The GOAL TEST deep-imports it from `packages/core/src/infrastructure/db/preset.js`, mirroring the `@internal` precedent `resolveChatModel` (`llms/openai.ts:76`). Only `createMemory`, `CreateMemoryPresetConfig`, and `InvalidPresetConfig` are public (barrel); the assembly seam stays internal to avoid widening the public surface for a test-only entry. The T2.1 commit body states this decision.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Preset mutates process-global `process.env.OPENAI_API_KEY` (D2) — could clobber other OpenAI usage in the consumer's process | Medium | Only set when `openai` is explicitly provided; document the side-effect in JSDoc + CHANGELOG; consumers who prefer ambient env omit `openai`. Follow-up ADR can thread the key via constructor if demand appears. | implementer |
| Dispose-semantics divergence: preset ends the pool, full-config does not (D3) — a consumer mixing shapes could double-close | Low | Preset owns ONLY the pool it created; `pool.end()` is idempotent-guarded (call once); documented in JSDoc + covered by a dispose unit test | implementer |
| Discriminator collision if `LocalMemoryConfig` ever gains a `postgres` field | Low | Add a type-level test (`index.test-d.ts`) asserting the two shapes are disjoint; a future `postgres` field on `LocalMemoryConfig` would fail that test loudly | implementer |
| GOAL TEST needs a real OpenAI key for a true end-to-end, unavailable in CI | Medium | Split: the CI-runnable GOAL TEST uses the internal `assemblePresetMemory` seam with `DeterministicStub{Embedder,LLM}` (deterministic round-trip proves the pool+migrations+store+dispose wiring); a separate `describe.skipIf(!OPENAI_API_KEY)` test covers the true zero-config real-OpenAI path | implementer |
| EC-7: single OpenAI key per process — `OpenAIEmbedder`/`OpenAILLM` use a module-global lazy singleton (`openai.ts:44`); the first key constructed wins, so a 2nd preset call with a different key is silently ignored | Medium | Document in preset JSDoc + CHANGELOG: "one OpenAI key per process; for multiple keys use the full-config path". Constructor-threading (D2 rejected-alt) is the clean follow-up if multi-key is ever needed | implementer |
| EC-8: two concurrent preset boots race `runMigrations` on the same fresh DB | Low | Document: boot the preset once per process (singleton), matching `examples/chat-with-memory/lib/memory.ts` `getSingleton`. Migration concurrency is a pre-existing concern (`migration-no-concurrently.test.ts`), out of scope | implementer |

## Unresolved Questions

- Q1 — Should the preset also accept a pre-built `pg.Pool` (not just a `postgres` URL string) for consumers who already own one? **Resolved (v1.1): no for v1** — YAGNI; the full-config `createLocalMemory` path already covers "I built my own store/pool".
- Q2 — Typed error for invalid preset config? **Resolved (v1.1, EC-4):** `InvalidPresetConfig` (colocated in `preset.ts`, `Object.setPrototypeOf` pattern) thrown fail-fast on empty `postgres` before any pool opens. Missing OpenAI key (openai omitted AND ambient unset) defers to the adapter's first-call error (EC-7 documents the single-key-per-process limitation) — not fail-fast, because the lazy singleton is constructed but not called until first `remember`.
- (none further — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (preset core: types + preset.ts + unit tests)
   │
   ▼
Phase 2 (public overload dispatch + barrel export + integration GOAL TEST + CHANGELOG)
   │
   ▼
Final Phase: Integration Validation
```

Phase 1 must complete before Phase 2 (the dispatcher in Phase 2 imports the resolver built in Phase 1). Tasks within a phase are sequential.

---

## Phase 1: Preset core

**Objective:** Build the preset config type and the pool-owning `assemblePresetMemory` + `resolvePreset` logic in a new file, proven by fast unit tests, without yet touching the public `createMemory` dispatch.

### T1.1 — Add `CreateMemoryPresetConfig` type + shape discriminator

#### Objective
Introduce the preset input type and a pure `isPresetConfig(input)` discriminator.

#### Why this step (action + reasoning — ReAct discipline)
This step adds the `CreateMemoryPresetConfig` type (`{ postgres: string; openai?: string; migrate?: boolean }` — NO `embeddingDim`, D4/EC-3) and a pure type-guard `isPresetConfig`.

It must come first because both the assembly (T1.2) and the public dispatcher (T2.1) depend on the type + the discriminator; per D1 the discriminator is the load-bearing mechanism that keeps the overload non-breaking, so it is defined and unit-tested in isolation before anything consumes it.

#### Evidence
`config.ts:33` (`LocalMemoryConfig`) + `memory-store.ts:224` (`MemoryConfig`) confirm no existing `postgres` field, so `postgres` is a safe discriminator (D1).

#### Files to edit
```
packages/core/src/infrastructure/db/preset.ts — (NEW) export CreateMemoryPresetConfig type + isPresetConfig guard
packages/core/src/infrastructure/db/preset.test.ts — (NEW) RED tests for isPresetConfig
```

#### Deep file dependency analysis
- `preset.ts` (NEW): declares `CreateMemoryPresetConfig` and `isPresetConfig(input: LocalMemoryConfig | CreateMemoryPresetConfig): input is CreateMemoryPresetConfig`. No downstream depends on it yet (T1.2/T2.1 will).

#### Deep Dives
- Invariant: `isPresetConfig` returns `true` iff `'postgres' in input` AND `typeof input.postgres === 'string'` — a non-string `postgres` on a full config (impossible per types, but defended) returns false.
- Edge cases: empty-string `postgres` → still a preset shape (validation of emptiness is T1.2's fail-fast, not the discriminator's job).

#### Pseudo-code / Signatures
```pseudocode
type CreateMemoryPresetConfig = {
  postgres: string
  openai?: string
  migrate?: boolean       // default true
  // NO embeddingDim — fixed at 1536 (D4, EC-3): the preset's OpenAIEmbedder is 1536-dim
}
function isPresetConfig(input): input is CreateMemoryPresetConfig
  return typeof (input as any).postgres === 'string'
```

#### Tasks
1. Create `preset.ts` with the type + guard.
2. Create `preset.test.ts` with RED tests.

#### TDD
```
RED:  test_isPresetConfig_true_for_postgres_shape — expect(isPresetConfig({ postgres: 'postgres://x' })).toBe(true)
RED:  test_isPresetConfig_false_for_full_config — expect(isPresetConfig({ embedder, llm, vectorStore } as LocalMemoryConfig)).toBe(false)
GREEN: implement the type + guard
REFACTOR: None expected
VERIFY: vitest run --config vitest.contract.config.ts packages/core/src/infrastructure/db/preset.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `isPresetConfig` correctly discriminates both shapes
- [ ] Pass: complexity — cyclomatic ≤ 10
- [ ] Pass: coverage — `vitest run --config vitest.contract.config.ts` ≥ 90% on `preset.ts`
- [ ] Pass: lint — `npm run lint` zero warnings on changed files
- [ ] Pass: size — `preset.ts` ≤ 500 lines

#### DoD
- [ ] Tests passing — `npm test` green
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected

### T1.2 — `assemblePresetMemory` + `resolvePreset` (pool-owning assembly, migrate opt-out, env-set)

#### Objective
Build the pool-owning assembly: open the pool, optionally migrate, wire the store, delegate to `createLocalMemory`, and wrap dispose to end the pool — with an internal seam for injecting stub adapters.

#### Why this step (action + reasoning — ReAct discipline)
This step implements `assemblePresetMemory({ pool, embedder, llm, migrate, embeddingDim })` (adapter-agnostic, pool-owning) and `resolvePreset(config)` (builds the OpenAI adapters per D2, opens the pool from `config.postgres`, delegates to `assemblePresetMemory`).

Splitting assembly from adapter-resolution is what makes the GOAL TEST CI-runnable (D2/Drawbacks): the deterministic integration test targets `assemblePresetMemory` with stub adapters + a real pool, exercising pool + migrations + store + dispose without a live OpenAI key, while `resolvePreset` is the thin real-adapter layer.

#### Evidence
`factory.ts:155` (`createLocalMemory` signature) + `factory.ts:130` (`validateEmbeddingDim`) + `migrations-runner.ts:16` (`runMigrations` contract) + `examples/chat-with-memory/lib/memory.ts:281` (`runMigrations(pgPool, { embeddingDim })` precedent) + `examples/chat-with-memory/lib/memory.ts:283` (`new PgvectorStore(pgPool, { embeddingDim })` precedent) + `pgvector-store.ts:264` (constructor).

#### Files to edit
```
packages/core/src/infrastructure/db/preset.ts — add assemblePresetMemory + resolvePreset (env-set per D2, migrate default per D3, dim default per D4, dispose wrap per D3)
packages/core/src/infrastructure/db/preset.test.ts — RED unit tests (migrate opt-out, dim default, env-set, dispose-ends-pool) with a mock pool + stub adapters
```

#### Deep file dependency analysis
- `preset.ts`: `assemblePresetMemory` imports `PgvectorStore` + `runMigrations` + `createLocalMemory` (all from `factory.ts`/local db module). `resolvePreset` imports `OpenAIEmbedder` (`embedders/openai`) + `OpenAILLM` (`llms/openai`) + `pg`. Downstream: T2.1 dispatcher imports `resolvePreset` + `isPresetConfig`.
- No change to `createLocalMemory`, `PgvectorStore`, `OpenAIEmbedder`, `OpenAILLM`, or `runMigrations` — they are consumed as-is (Don't-Reinvent, parsimony rung 4).

#### Deep Dives
- Data: `assemblePresetMemory` params `{ pool: pg.Pool; embedder: Embedder; llm: LLM; migrate: boolean }` — dim is the fixed module constant `MAX_EMBEDDING_DIM` (1536), not a param (D4/EC-3).
- Algorithm: wrap in try/catch (EC-1). (1) if `migrate` → `await runMigrations(pool, { embeddingDim: 1536 })`; (2) `store = new PgvectorStore(pool, { embeddingDim: 1536 })`; (3) `mem = await createLocalMemory({ embedder, llm, vectorStore: store, embeddingDim: 1536 })`; (4) return `{ ...mem, dispose: async () => { await mem.dispose?.(); await pool.end(); } }`. On any throw in (1)-(3): `await pool.end(); throw e`.
- Invariant preserved: `createLocalMemory` behavior untouched (Baseline invariant); 1536 threaded identically into `runMigrations` + `PgvectorStore` (kills the footgun).
- `resolvePreset` order (D2): set `process.env.OPENAI_API_KEY = config.openai` (only when truthy — EC-5) **before** `new OpenAIEmbedder()`/`new OpenAILLM()` (lazy singletons read env at first call, but setting before construction is the least-surprising order matching the demo precedent).
- Edge cases: empty/whitespace `postgres` → `InvalidPresetConfig` fail fast before opening a pool (EC-4); `openai: ''` → truthy guard skips env-set, ambient key untouched (EC-5); `openai` omitted + no ambient key → adapter throws on first `remember` (EC-7, documented); `migrate: false` → skip step (1); dispose called twice → `pool.end()` guarded so it runs once; migration failure → pool closed then rethrown (EC-1).

#### Pseudo-code / Signatures
```pseudocode
DIM = MAX_EMBEDDING_DIM   // 1536, fixed (D4)

async function assemblePresetMemory({ pool, embedder, llm, migrate }): DisposableMemory
  try:                                                    # EC-1: close the pool we opened on any failure
    if migrate: await runMigrations(pool, { embeddingDim: DIM })
    store = new PgvectorStore(pool, { embeddingDim: DIM })
    mem = await createLocalMemory({ embedder, llm, vectorStore: store, embeddingDim: DIM })
    return wrapDispose(mem, pool)                          # dispose() also pool.end(), once
  catch e:
    await pool.end(); throw e                              # EC-1: no leaked pool on failed boot

async function resolvePreset(config): DisposableMemory
  if not config.postgres or config.postgres.trim() === '':   # EC-4: fail fast, typed, BEFORE opening a pool
    throw new InvalidPresetConfig('postgres connection string is required and must be non-empty')
  if config.openai:                                          # EC-5: TRUTHY guard — empty/undefined never clobbers ambient key
    process.env.OPENAI_API_KEY = config.openai
  pool = new pg.Pool({ connectionString: config.postgres })
  return assemblePresetMemory({ pool, embedder: new OpenAIEmbedder(), llm: new OpenAILLM(),
                                migrate: config.migrate ?? true })

# Example
input:  { postgres: 'postgres://…/db', openai: 'sk-…' }
output: a DisposableMemory; recall(q, { threshold: 0 }) after remember(text) returns the extracted fact in top-k; dispose() closes the pool
```

> **Typed error (EC-4):** `InvalidPresetConfig extends Error` follows the `Object.setPrototypeOf` pattern from `src/core/errors.ts` (survives ESM/CJS + dynamic imports), colocated in `preset.ts`. Exact name confirmed here per Unresolved Question Q2.

#### Tasks
1. Implement `assemblePresetMemory` (pool-owning, dispose-wrap).
2. Implement `resolvePreset` (env-set, pool open, dim default, migrate default, delegate).
3. Add RED unit tests using a mock `pg.Pool` (spy on `end`) + `DeterministicStubEmbedder`/`DeterministicStubLLM` where a real DB is not needed; migrate/dim/env-set/dispose paths.

#### TDD
```
RED:  test_assemble_runs_migrations_by_default — expect(runMigrationsSpy).toHaveBeenCalledTimes(1) when migrate=true
RED:  test_assemble_skips_migrations_when_migrate_false — expect(runMigrationsSpy).not.toHaveBeenCalled()
RED:  test_assemble_dispose_ends_pool_once — call dispose twice; expect(poolEndSpy).toHaveBeenCalledTimes(1)
RED:  test_assemble_ends_pool_on_migration_failure — EC-1: runMigrations rejects; expect(poolEndSpy).toHaveBeenCalledTimes(1) and the error rethrown
RED:  test_resolvePreset_sets_openai_env_when_key_provided — expect(process.env.OPENAI_API_KEY).toBe('sk-passed')
RED:  test_resolvePreset_empty_openai_keeps_ambient_key — EC-5: ambient 'amb', openai:''; expect(process.env.OPENAI_API_KEY).toBe('amb')
RED:  test_resolvePreset_rejects_empty_postgres — EC-4: expect(() => resolvePreset({ postgres: '' })).rejects.toThrow(InvalidPresetConfig)
RED:  test_assemble_uses_dim_1536 — expect(pgStoreCtorArg.embeddingDim).toBe(1536) and migrations dim === 1536 (D4)
GREEN: implement assemblePresetMemory + resolvePreset + InvalidPresetConfig
REFACTOR: extract wrapDispose if it improves clarity; keep preset.ts ≤ 500 LoC
VERIFY: vitest run --config vitest.contract.config.ts packages/core/src/infrastructure/db/preset.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded)
> Note: `createLocalMemory` may wire concurrent eviction internally, but the preset adds NO new concurrent state — it is a single-shot boot sequence. The eviction concurrency invariants are already covered by `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` and are out of scope here.

#### Acceptance Criteria
- [ ] Migrate default ON; opt-out OFF works
- [ ] `embeddingDim` defaults to 1536 and threads identically to store + migrations
- [ ] `dispose()` ends the pool exactly once
- [ ] env-set happens only when `openai` provided
- [ ] Pass: complexity ≤ 10; coverage ≥ 90% on `preset.ts`; lint zero; size ≤ 500

#### DoD
- [ ] `npm test` green; `npm run typecheck` zero; `npm run lint` zero; size budget respected

---

## Phase 2: Public overload + integration proof

**Objective:** Wire `createMemory` to dispatch on the discriminator, export the new type, prove the round-trip against real pgvector, and update the CHANGELOG.

### T2.1 — Dispatch `createMemory` on the discriminator (non-breaking overload)

#### Objective
Replace the `createLocalMemory as createMemory` alias with a real `createMemory` that dispatches preset vs full config.

#### Why this step (action + reasoning — ReAct discipline)
This step makes `createMemory` a function: `isPresetConfig(input) ? resolvePreset(input) : createLocalMemory(input)`, with an overload signature so both input types are accepted and the return stays `Promise<DisposableMemory>`.

It comes after Phase 1 because it imports `resolvePreset`/`isPresetConfig`; per D1 this is the single change that exposes the preset publicly while keeping the full-config path (and its type test `index.test-d.ts:103`) byte-compatible.

#### Evidence
`factory.ts:287` (current alias), `index.ts:61` (barrel re-export), `matrix.test.ts:106` (name-present invariant), `index.test-d.ts:103` (type invariant).

#### Files to edit
```
packages/core/src/infrastructure/db/factory.ts — replace `export { createLocalMemory as createMemory }` with a dispatching createMemory (imports resolvePreset + isPresetConfig from preset.js)
packages/core/src/index.ts — export CreateMemoryPresetConfig type + InvalidPresetConfig error (EC-4 — public so consumers can catch it) alongside existing barrel exports
packages/core/src/domain/index.test-d.ts — add RED type test: createMemory accepts BOTH the preset shape AND LocalMemoryConfig; shapes are disjoint
```

#### Deep file dependency analysis
- `factory.ts`: gains `createMemory` (overloaded). Keeps `createLocalMemory` unchanged. Stays ≤ 500 LoC (adds ~15 lines).
- `index.ts`: adds `export type { CreateMemoryPresetConfig }`; all existing exports preserved (invariant).
- `index.test-d.ts`: extends the existing type test (line 103) to cover the preset shape — proves non-breaking at the type level.

#### Deep Dives
- Invariant: `matrix.test.ts:106` (`names.has('createMemory')`) still passes — the export name is unchanged. `index.test-d.ts:103` still passes — `createMemory(fullConfig): Memory` remains valid.
- Overload shape: `function createMemory(config: CreateMemoryPresetConfig | LocalMemoryConfig): Promise<DisposableMemory>` (a single union signature is sufficient; TS overload declarations optional).
- Edge case: an object that is BOTH (has `postgres` and `embedder`) — the discriminator prefers preset (documented); such a mixed object is a caller error, not a supported shape.

#### Tasks
1. Add `createMemory` dispatcher in `factory.ts`.
2. Export `CreateMemoryPresetConfig` from `index.ts`.
3. Extend `index.test-d.ts` type test (RED first).

#### TDD
```
RED:  test_createMemory_accepts_preset_shape() => expectTypeOf(createMemory).toBeCallableWith({ postgres: 'postgres://x', openai: 'sk-x' })
RED:  test_createMemory_accepts_full_config() => expectTypeOf(createMemory).toBeCallableWith(fullLocalMemoryConfig)
RED:  test_matrix_still_exports_createMemory — expect(names.has('createMemory')).toBe(true) (invariant preserved)
GREEN: implement the dispatcher + barrel export
REFACTOR: None expected
VERIFY: npm run typecheck && vitest run --config vitest.contract.config.ts tests/integration/p0-audit/matrix.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `createMemory({ postgres, openai })` and `createMemory(fullConfig)` both type-check and dispatch correctly
- [ ] `matrix.test.ts` + `full-public-surface.test.ts` stay green (name + surface unchanged)
- [ ] Pass: complexity ≤ 10; lint zero; `factory.ts` ≤ 500 lines

#### DoD
- [ ] `npm test` green; `npm run typecheck` zero; `npm run lint` zero

### T2.2 — GOAL TEST: preset round-trip vs real pgvector + real-OpenAI gated test + CHANGELOG

#### Objective
Prove the preset boots a working Memory against real `ankane/pgvector` and round-trips remember+recall in top-k; record the change.

#### Why this step (action + reasoning — ReAct discipline)
This step adds the integration GOAL TEST: using the `assemblePresetMemory` seam with `DeterministicStub{Embedder,LLM}` against the real pgvector container, it remembers a fact and asserts recall returns it in top-k, then asserts `dispose()` closes the pool. A separate `describe.skipIf(!process.env.OPENAI_API_KEY)` block calls the true public `createMemory({ postgres, openai })` for the real-OpenAI path.

It is the last step because it validates the whole chain end-to-end; the deterministic seam keeps it CI-runnable (Drawbacks mitigation) while the gated block preserves an honest real-key proof. CHANGELOG update satisfies Unbreakable Rule 6.

#### Evidence
`vitest.integration.config.ts:66` (`include: tests/integration/**/*.test.ts`), `:61` (`globalSetup` provides the container), gated by `THEOMEM_PG_URI`. `tests/integration/local-runtime.test.ts` + `tests/integration/history-manager.test.ts` are precedent round-trip integration tests against the shared pool.

#### Files to edit
```
tests/integration/create-memory-preset.test.ts — (NEW) GOAL TEST (deterministic seam) + skipIf real-OpenAI block
CHANGELOG.md — [Unreleased] § Added: zero-config createMemory({ postgres, openai }) preset (auto-migrate opt-out)
```

#### Deep file dependency analysis
- New integration test imports `assemblePresetMemory` (seam) + `createMemory` (public) + `DeterministicStubEmbedder`/`DeterministicStubLLM` + `pg`. Uses `THEOMEM_PG_URI` from the shared container (per config).
- CHANGELOG: additive entry only; never edits released sections.

#### Deep Dives
- Round-trip determinism: `DeterministicStubEmbedder` maps identical text → identical vector, so `remember('needle in a haystack')` then `recall('needle in a haystack')` yields cosine 1.0 → top-1 (proves store + migrations + query path). This is the CI-runnable metric.
- Migrations proof: the test uses a fresh scope; if `runMigrations` had not run, `recall` would error on missing tables — so a green round-trip proves auto-migrate fired.
- Dispose proof: after `dispose()`, a subsequent query on the same pool rejects (pool ended) — asserted.
- Real-OpenAI block: `describe.skipIf(!process.env.OPENAI_API_KEY)` calls `createMemory({ postgres: THEOMEM_PG_URI, openai: process.env.OPENAI_API_KEY })` and round-trips a semantically-related recall (proves the real adapters wire).

#### Pseudo-code / Signatures
```pseudocode
test('create-memory preset wires pool + migrations + store and round-trips remember+recall in top-k')
  mem = await assemblePresetMemory({ pool: new pg.Pool({ connectionString: THEOMEM_PG_URI }),
                                     embedder: new DeterministicStubEmbedder(),
                                     llm: new DeterministicStubLLM(),
                                     migrate: true })                       // dim fixed 1536 (D4)
  await mem.user('u1').remember('Paulo likes coffee')
  // EC-2: the STORED item is the LLM-extracted fact (not the raw text); a stub embedder
  // gives low cross-text cosine → use threshold:0 and assert non-empty (mirror local-runtime.test.ts:99).
  results = await mem.user('u1').recall('coffee', { topK: 3, threshold: 0 })
  expect(results.length).toBeGreaterThan(0)                                // migrations fired + store queried
  await mem.dispose()                                                      // asserts pool ended
```

#### Tasks
1. Write the deterministic GOAL TEST (round-trip + migrations-fired + dispose-ends-pool).
2. Write the `skipIf(!OPENAI_API_KEY)` real-adapter round-trip.
3. Append the CHANGELOG entry.

#### TDD
```
RED:  create-memory preset wires pool + migrations + store and round-trips remember+recall in top-k — assert results.length>0 with threshold:0 (EC-2); fails before Phase 1/2 land
RED:  preset dispose ends the pool — a query on the pool after dispose rejects
RED:  preset migrate:false on un-migrated schema surfaces a clear missing-relation error (EC-6)
GREEN: (already implemented in Phase 1/2) — test turns green against real pgvector
REFACTOR: None expected
VERIFY: npm run test:integration -- tests/integration/create-memory-preset.test.ts
```

#### Failure-scenario tests
See `## Failure scenarios` — bad `postgres` URI (fail fast), `migrate:false` on empty DB (recall errors clearly), missing OpenAI key (fail fast / typed) exercised here.

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] GOAL TEST green against real `ankane/pgvector:v0.5.1`
- [ ] Real-OpenAI block runs (not error) when `OPENAI_API_KEY` present; skips cleanly otherwise
- [ ] CHANGELOG `[Unreleased] § Added` updated
- [ ] Pass: lint zero; test file ≤ 500 lines

#### DoD
- [ ] `npm run test:integration` green (preset test); `npm run typecheck` zero; `npm run lint` zero; CHANGELOG updated

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `createMemory` accepts preset shape in addition to full config (non-breaking) | T1.1, T2.1 | Discriminated union + dispatcher (D1) |
| 2 | Preset wires OpenAIEmbedder + OpenAILLM + PgvectorStore + pg.Pool | T1.2 | `resolvePreset` + `assemblePresetMemory` |
| 3 | OpenAI key fed to adapters | T1.2 | env-set per D2 |
| 4 | Auto-migrate by default, opt-out `{ migrate: false }` | T1.2 | `migrate ?? true` (D3) |
| 5 | `embeddingDim` fixed 1536, no consumer burden, no unhonorable override | T1.2 (D4) | Hard-fixed `MAX_EMBEDDING_DIM`; field dropped from preset shape (EC-3) |
| 6 | Pool lifecycle owned (no leak) incl. failed boot | T1.2 | dispose-wrap ends pool once (D3) + try/catch pool.end() on failure (EC-1) |
| 7 | Existing consumers + type tests remain green | T2.1 | non-breaking overload; `index.test-d.ts` + `matrix.test.ts` invariants |
| 8 | Round-trip proof vs real pgvector | T2.2 | GOAL TEST (deterministic seam, threshold:0, results>0 per EC-2) + gated real-OpenAI test |
| 9 | Change recorded | T2.2 | CHANGELOG `[Unreleased] § Added` |
| 10 | Fail-fast on empty `postgres` | T1.2 | `InvalidPresetConfig` typed error (EC-4) |
| 11 | Empty `openai` never clobbers ambient key | T1.2 | truthy guard + negative test (EC-5) |
| 12 | `migrate:false` surfaces clear error on un-migrated DB | T2.2 | negative test asserts missing-relation error (EC-6) |

**Coverage: 12/12 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npm test` + `npm run test:integration` green
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (per `rules/architecture.md`) — `factory.ts` + `preset.ts` ≤ 500 LoC
- [ ] CHANGELOG.md updated under `[Unreleased] § Added` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — `createMemory` full-config path + `createLocalMemory` unchanged; `matrix.test.ts` + `full-public-surface.test.ts` + `index.test-d.ts` green
- [ ] Plan-specific: preset round-trips remember+recall in top-k against real pgvector; dispose ends the pool; auto-migrate opt-out works
- [ ] No paper/marketing names in `src/**` (`rules/no-paper-names-in-code.md`)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios (external I/O touched: pg driver + OpenAI HTTP)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres` (pg driver) | invalid/unreachable connection string | preset called with a bogus `postgres://` URI | fail fast: `runMigrations`/pool connect rejects with a clear error; no partial Memory returned; no leaked open pool |
| `postgres` (pg driver) | `migrate: false` against an un-migrated (empty) DB | preset with `migrate:false` on a fresh schema, then `recall` | recall errors clearly (missing table) — the opt-out is the consumer's explicit choice; documented, not silently swallowed |
| OpenAI (HTTP, lazy) | missing key: `openai` omitted AND ambient `OPENAI_API_KEY` unset | real-OpenAI path with no key | fail fast at assembly with a typed error (Q2 — exact type resolved in `/edge-case-plan`), not a deferred opaque 401 mid-`remember` |
| OpenAI (HTTP, lazy) | bad key → 401 on first `remember` | real-OpenAI gated test with an invalid key (local only) | error surfaces from the adapter on first call; preset does not swallow it (Rule 8) |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the preset works in a real workload, not just isolated unit tests.

### Execution
```
npm test                                   # unit + contract
npm run test:integration -- tests/integration/create-memory-preset.test.ts
npm run typecheck                          # zero type errors
npm run lint                               # zero warnings
```

### Acceptance Criteria
- [ ] All test suites green (unit/contract + the preset integration test)
- [ ] Coverage ≥ 90% on `preset.ts` (critical paths 100%)
- [ ] Zero type errors; zero lint warnings
- [ ] Failure scenarios green — bad-URI fail-fast + missing-key fail-fast + dispose-ends-pool observed
- [ ] `matrix.test.ts` + `full-public-surface.test.ts` + `index.test-d.ts` still green (non-breaking proof)

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description (do not block on them).
