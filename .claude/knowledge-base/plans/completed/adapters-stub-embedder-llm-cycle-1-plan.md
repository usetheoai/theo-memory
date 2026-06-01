# Plan: Adapters portfolio Cycle 1 — deterministic StubEmbedder + StubLLM via subpath exports

> **Version 1.2** (2026-06-01) — HONESTY correction (NOT scope drift per `cycle-review.md § Hard gates #2`) absorbing F-arch-2 + F-arch-3 from the `/review` report at `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-review-2026-06-01.md`. ADR D2 Deep Dive "Collision analysis" math corrected: original `~2^32 inputs` was inaccurate. The `seed % LCG_MODULUS` step collapses MD5's 8-byte raw `~2^64` seed space to the LCG modulus `~2^31`, so birthday-50% lands at `sqrt(2^31 * pi / 2) ≈ 46k` distinct inputs. Range claim `[-1, 1]` similarly corrected to `[-1, 1+~2e-9]` (Mersenne prime odd modulus asymmetry; L2-norm absorbs). NO behavior change; documentation alignment with reality. Triggered by adapters-stub-embedder-llm-cycle-1-fixes T1.2.
>
> **Version 1.1** (2026-06-01) — Absorbs MUST FIX EC-1 from `/edge-case-plan` review at `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-edge-cases-2026-06-01.md`: `l2Normalize` MUST guard `if (norm < 1e-30) return zero-vector` to prevent NaN-vector when MD5 + LCG produce a degenerate zero-magnitude pre-norm vector (probability ~2^-128 per input but defensive code is 1 line and prevents pgvector INSERT crash).
>
> **Version 1.0** (2026-06-01) — First concrete plan from the adapters-portfolio-roadmap (`.claude/knowledge-base/plans/adapters-portfolio-roadmap.md`). Closes the immediate F-T4.1-2 debug blocker (OpenAI quota exhaust) by shipping **deterministic** stub adapters at `@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub`. The pre-existing zero-vector stubs at `src/local/stubs.ts` stay intact (probe-safe boot per ADR D8 of v0-2-theokit-binding); this plan ADDS reproducible-debug stubs at NEW subpath locations.

## Goal

Ship deterministic StubEmbedder + StubLLM adapters at the new subpath exports `@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub`, measured by the contract-test `tests run: passed === 100% AND determinism assertion holds: embed(t)===embed(t) AND embed(t1)!==embed(t2) AND llm.generate(p)===llm.generate(p)`.

The action verb is **ship**; the named observable metric is `npm test` contract suite passing with the new adapter test files included AND the deterministic invariants asserted on green.

## Context

### What exists today

- **Pre-existing zero-vector stubs** at `src/local/stubs.ts` (lines 24-99) shipped at v0.2 `T4.5` per ADR D8 of `v0-2-theokit-binding-plan.md`. `StubEmbedder.embed()` returns `MAX_EMBEDDING_DIM` zeros for ANY input. `StubLLM.generateChat()` returns a fixed `"OK"` text. Purpose: pass the dimension probe in `createLocalMemory` so scaffold demos boot probe-safely. **Not fit for F-T4.1-2 debug** because zero-vectors collapse all memories into a single retrieval bucket and identical LLM output erases the extraction signal.
- **DIPs to implement**: `src/core/dip/embedder.ts` (`Embedder.embed(text): Promise<readonly number[]>` + `embedBatch(texts): Promise<readonly (readonly number[])[]>`). `src/core/dip/llm.ts` (`LLM.generateChat(messages): Promise<LLMResponse>` + `LLM.generateResponse(messages, responseFormat?): Promise<unknown>`). Method counts locked at ADR-0008.
- **Subpath exports today** in `package.json#exports`: `.`, `./theokit`, `./agent-tools`. No `./embedders/*` or `./llms/*` declared yet.
- **vitest.contract.config.ts include**: `src/{core,theokit,agent-tools}/**/__tests__/**/*.test.ts` (per Step 0 pre-flight grep). Does NOT cover `src/embedders/` or `src/llms/` yet — Step 0 path validation flags this; the plan T0.1 widens the include.
- **Demo's adapter pattern** at `examples/chat-with-memory/lib/openai-adapters.ts` (~92 LoC) uses OpenAI SDK directly. No mechanism today to swap for stubs without code change.
- **Schema dim constraint** `vector(1536)` in `0000_initial.sql` (per ADR D1.7 of v0.1). Stubs MUST produce 1536-dim vectors to match pgvector column.
- **MAX_EMBEDDING_DIM** constant exported from `src/core/constants.ts` (1536 per ADR D1.7 cap).

### Why this matters NOW

1. **F-T4.1-2 debug is BLOCKED by OpenAI quota exhaust** (audited 2026-06-01). The user_id-NULL race condition cannot be re-isolated empirically because the demo's `probeEmbedder` boot fails with HTTP 429 `insufficient_quota`. Deterministic stub adapters unblock the debug **today** with zero external dep.
2. **Adapters portfolio roadmap (`adapters-portfolio-roadmap.md`) Cycle 1 P0 entries** explicitly list this as the first concrete step. The roadmap was written 2026-06-01 and committed at `7bacee9`.
3. **Determinism makes the F-T4.1-2 isolation 100% reproducible** — same input → same embeddings → same hash → same DB outcome. Eliminates LLM variance as a confound; isolates the postRememberHook + Promise.all race vs the schema's UNIQUE(hash) constraint.
4. **Subpath export precedent** — `@usetheo/memory/theokit` + `@usetheo/memory/agent-tools` already established the pattern. Adding `@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub` is a natural extension that does not break any existing consumer.

### Accepted risks (declared upfront)

- **EC-A — Pre-existing `src/local/stubs.ts` stubs stay intact.** Zero-vector StubEmbedder + fixed-text StubLLM continue to exist for probe-safe boot per ADR D8. This plan does NOT modify or deprecate them. Two stub flavors coexist: probe-safe (existing) vs deterministic-debug (new). Risk: consumer confusion which to pick. Mitigation: distinct names + JSDoc + README disambiguation table.
- **EC-B — Hash-based deterministic embedder is NOT semantically meaningful.** It produces unique-but-arbitrary vectors per text — useful for race/dedup debug, useless for actual recall quality. Documented as `@experimental — debug only` in JSDoc.
- **EC-C — LLM stub canned-response strategy.** For the JSON-extraction path, we cannot truly synthesize "extracted facts" from arbitrary input — we ship a deterministic pseudo-extraction (extract first N sentences as "facts", up to 3). Good enough for F-T4.1-2 debug; explicit `@experimental` flag.
- **EC-D — Demo `THEOMEM_USE_STUB_ADAPTERS=1` env wiring is opt-in.** Default demo behavior unchanged. Existing tutorials/screenshots stay valid. Reduces blast radius.
- **EC-E — File-size budgets**: `src/embedders/stub.ts` ≤ 150 LoC; `src/llms/stub.ts` ≤ 200 LoC (LLM has more methods). Well under `architecture.md § Module hygiene` 500 LoC budget.

### Compliance scope

Honors `architecture.md § 3 DIP` — adapters live OUTSIDE `src/core/`; `src/core/` does NOT import from `src/embedders/` or `src/llms/`. Honors `architecture.md § 9 Public API surface` — new subpath exports declared in `src/index.ts` (re-exports) AND `package.json#exports`. Honors `architecture.md § 6 Naming conventions` — kebab-case files (`stub.ts`), PascalCase class names (`DeterministicStubEmbedder`, `DeterministicStubLLM`), camelCase functions. Honors `architecture.md § 7 Module hygiene` — ES modules only, no `any`, no `console.log` in non-stub code paths (stubs themselves carry the same ADR D8 exception with eslint-disable comments). Honors `testing.md § Pyramid` — unit tests under `src/embedders/__tests__/` + `src/llms/__tests__/` for the deterministic invariants. Honors `testing.md § Determinism` — these adapters are FOR determinism by definition. Honors `no-paper-names-in-code.md` — neutral names (`hash`, `seed`, `deterministic`) not `Mem0-style stub`. Honors `dogfood-golden-rule.md` — no `production-ready` claim. Honors Inquebrável Rule 9 (Não Reinvente) — uses Node `crypto.createHash('md5')` (built-in), seedable LCG (textbook formula); no new npm dep introduced. Honors Inquebrável Rule 5 (TDD) — every task has RED tests authored before GREEN code.

## Objective

- [ ] T0.1 — Widen `vitest.contract.config.ts` include glob to cover `src/embedders/**/__tests__/**/*.test.ts` + `src/llms/**/__tests__/**/*.test.ts` AND `tsconfig.contract.json` to include `src/embedders/**/*.ts` + `src/llms/**/*.ts`. Verified via Step 0 pre-flight (current include lists `src/{core,theokit,agent-tools}/**/__tests__/**/*.test.ts`, missing the new dirs). RED runs `npm test -- src/embedders` returns "no test files found" exit 1; GREEN runs same and finds new tests.
- [ ] T1.1 — Create `src/embedders/stub.ts` exporting `DeterministicStubEmbedder` class implementing `Embedder` DIP. Hash-based 1536-dim vector per text: MD5 of UTF-8 bytes → 16-byte seed → seeded LCG fills 1536 floats → L2-normalize to unit vector. `embed(t)` is pure: same input → same output. `embed(t1) !== embed(t2)` for distinct texts (collision probability < 2^-64 per text).
- [ ] T1.2 — Create `src/llms/stub.ts` exporting `DeterministicStubLLM` class implementing `LLM` DIP. `generateChat(messages)` returns deterministic response: MD5(stringify(messages)) → seed → canned response template fill. `generateResponse(messages, {type:'json'})` returns deterministic fact-extraction JSON: split first 3 sentences from concatenated user-content as `{facts:[...]}`. Both methods pure: same input → same output.
- [ ] T2.1 — Add `src/embedders/index.ts` barrel re-exporting `DeterministicStubEmbedder` from `./stub.js`. Add `src/llms/index.ts` barrel re-exporting `DeterministicStubLLM`. Declare subpath exports `./embedders/stub` + `./llms/stub` (and barrels `./embedders` + `./llms`) in `package.json#exports`. Update `src/index.ts` re-export block to NOT re-export the new deterministic classes from the root (consumer MUST go through subpath — establishes the discipline).
- [ ] T3.1 — Wire `THEOMEM_USE_STUB_ADAPTERS=1` env var into `examples/chat-with-memory/lib/memory.ts`. When set, swap `OpenAIEmbedder` + `OpenAILLM` for `DeterministicStubEmbedder` + `DeterministicStubLLM`. Default unchanged. README "Optional env" table row added documenting the var (per the existing pattern from `THEOMEM_EVICTION_DEMO` row).
- [ ] T4.1 — Final validation: `npm test` PASS (contract suite green; new tests included), `npm run typecheck` exit 0, `npm run lint` exit 0, demo `npm run build` PASS. Commit + push.

## ADRs

### D1 — Pre-existing zero-vector stubs stay intact at `src/local/stubs.ts`

**Decision:** keep `src/local/stubs.ts` `StubEmbedder` (zero-vectors) + `StubLLM` (fixed `"OK"`) unchanged. ADD new deterministic stubs at NEW paths `src/embedders/stub.ts` + `src/llms/stub.ts`. Different purposes: probe-safe boot (existing — ADR D8 of v0-2-theokit-binding) vs reproducible debug (new — this plan).

**Rationale:** the existing stubs ARE working for their purpose (`createLocalMemory` boot probe in scaffolded apps). Modifying them to make them deterministic would either (a) break the probe-safe contract (zero-vector is canonical) or (b) require dual-mode logic inside one class (complexity). Two distinct classes at distinct subpaths preserves SRP.

**Alternatives considered:**
- (A) **Replace existing stubs with deterministic variants** — REJECTED. Breaks ADR D8 probe-safe contract; existing `tests/integration/theokit-binding.test.ts` may depend on zero-vector behavior; backward-compat risk.
- (B) **Add `mode: 'probe'|'deterministic'` constructor option to existing class** — REJECTED. Violates SRP; one class with two contracts is fertile ground for subtle bugs.
- (C) **Selected: two distinct classes at distinct subpaths** — clean separation, JSDoc disambiguation, README table row to guide consumer choice.

**Consequences:** README "Stub adapters disambiguation" subsection added under "Foundation". `src/local/stubs.ts` JSDoc updated to cross-reference the new deterministic variant. No deprecation of the existing stubs.

### D2 — Determinism algorithm for embedder: MD5 seed → LCG fill → L2 normalize

**Decision:** `DeterministicStubEmbedder.embed(text)` computes vector via: `seed = MD5(utf8(text)).slice(0,16)` → `lcg = seedLCG(seed)` (Lehmer LCG, modulus 2^31-1, multiplier 48271) → fill 1536 floats in `[-1, 1]` → L2-normalize (so cosine distance is well-defined) → return.

**Rationale:** simplest possible algorithm that satisfies the three invariants: deterministic (pure function), distinct-input → distinct-output (collision < 2^-128 from MD5 hash space), correct shape (1536 dim matching pgvector schema). Inquebrável Rule 9 — uses Node built-in `crypto.createHash('md5')` + textbook Lehmer LCG, no new npm dep.

**Alternatives considered:**
- (A) **SHA-256 instead of MD5** — REJECTED. MD5 is faster and the collision-attack weakness is irrelevant (we're not authenticating); the entropy we need (16-byte seed) fits cleanly in MD5's 128-bit digest.
- (B) **Use `Math.random()` seeded somehow** — REJECTED. `Math.random()` is non-deterministic and not seedable in Node. Would require importing a PRNG library (Rule 9 violation when LCG fits in 10 lines).
- (C) **Selected: MD5 seed + Lehmer LCG + L2 normalize** — minimum dep, well-understood algorithm, correct invariants.

**Consequences:** `embedBatch(texts)` iterates `embed(t)` per text — no SIMD optimization needed for stub. Determinism test asserts `embed(t) === embed(t)` AND `embed(t1) !== embed(t2)` for random text pairs. L2 normalization documented inline.

### D3 — Determinism algorithm for LLM: MD5 prompt seed + deterministic fact-extraction

**Decision:** `DeterministicStubLLM.generateChat(messages)` returns `{ content: "stub-response:" + hex(MD5(stringify(messages)).slice(0,4)), role: "assistant" }`. `generateResponse(messages, {type:'json'})` returns `{ facts: extractFirstNSentences(concatUserContent(messages), 3) }`. `generateResponse(messages, {type:'text'})` mirrors `generateChat`.

**Rationale:** the LLM stub serves TWO contract surfaces — chat-completion (for `/api/chat` SSE round-trip) AND fact-extraction JSON (for the Mem0-shape two-stage write pipeline). Both must be deterministic. Chat-completion path produces unique-but-deterministic tag per prompt. Extraction path produces unique-but-deterministic fact list. Together they let `rememberTurn` + the write pipeline complete reproducibly.

**Alternatives considered:**
- (A) **Hardcoded "OK" responses (like existing stub)** — REJECTED. Would make `rememberTurn`'s extraction phase produce 0 facts (the extraction prompt would not parse "OK" as facts). F-T4.1-2 debug requires N≥1 facts to land in DB.
- (B) **Seeded random text generation with vocabulary** — REJECTED. Over-engineering. We only need DETERMINISM and DISTINCT-PER-PROMPT; meaningful text is not required.
- (C) **Selected: MD5-tagged chat responses + sentence-split extraction** — minimum complexity, both invariants held, F-T4.1-2 debuggable.

**Consequences:** the extraction JSON shape MUST match what the core write pipeline expects (`{ facts: [{ text: string }] }` or similar). T1.2 RED tests assert against the actual extraction-pipeline contract by reading `src/core/extraction/` shape.

### D4 — Subpath exports: `./embedders/stub` + `./llms/stub` NOT re-exported from root

**Decision:** new subpath exports declared in `package.json#exports`: `./embedders` (barrel index), `./embedders/stub`, `./llms` (barrel index), `./llms/stub`. The root `src/index.ts` does NOT re-export `DeterministicStubEmbedder` or `DeterministicStubLLM`. Consumer MUST import via `@usetheo/memory/embedders/stub` explicitly.

**Rationale:** establishes the discipline declared in `adapters-portfolio-roadmap.md` § Architectural shape. Future adapters (`./embedders/openai`, `./llms/anthropic`, etc.) will follow the same pattern with their SDKs in `optionalDependencies`. Root re-export would couple every new adapter to the main bundle entry — wrong for opt-in design.

**Alternatives considered:**
- (A) **Re-export from root for convenience** — REJECTED. Defeats the opt-in discipline; first slip leads to all 52 future adapters bloating the root.
- (B) **Only declare barrels (`./embedders`, `./llms`), no `./embedders/stub`** — REJECTED. Roadmap explicitly says per-adapter subpath. Treats stub specially is inconsistent.
- (C) **Selected: barrels + per-adapter subpaths, no root re-export** — matches roadmap, scales to 52 adapters, opt-in discipline preserved.

**Consequences:** consumer documentation in README must show `import { DeterministicStubEmbedder } from "@usetheo/memory/embedders/stub"`. The existing zero-vector stubs at `src/index.ts:21` keep their root re-export (backward compat — they shipped at v0.2 from root).

### D5 — Demo opt-in via `THEOMEM_USE_STUB_ADAPTERS=1` env var

**Decision:** `examples/chat-with-memory/lib/memory.ts` reads `THEOMEM_USE_STUB_ADAPTERS` env. When `=== "1"`, instantiate `DeterministicStubEmbedder` + `DeterministicStubLLM` instead of `OpenAIEmbedder` + `OpenAILLM`. Otherwise behavior unchanged.

**Rationale:** parallel to the existing `THEOMEM_EVICTION_DEMO=1` opt-in pattern from the previous cycle. Strict equality with `"1"` per POSIX convention (consistent with EC-6 of the previous cycle). Default-off preserves existing demo workflows.

**Alternatives considered:**
- (A) **Auto-switch when no `OPENAI_API_KEY` set** — REJECTED. Silent fallback hides config errors; demo user wonders why facts are "random gibberish" when they meant to use OpenAI.
- (B) **CLI flag to `npm run dev`** — REJECTED. Next.js doesn't propagate CLI args at runtime.
- (C) **Selected: explicit env var, opt-in** — matches existing pattern, clear failure mode, no surprise.

**Consequences:** demo's `lib/memory.ts` grows by ~15 LoC (env check + branch). Console log adds `adapters=stub` or `adapters=openai` line. README "Optional env" table gains a row.

### D6 — Stub embedder dim hardcoded to 1536 (Phase A of adapters roadmap)

**Decision:** `DeterministicStubEmbedder` always returns 1536-dim vectors. No constructor parameter for dim. Aligned with current pgvector schema `vector(1536)` constraint per ADR D1.7 of v0.1.

**Rationale:** Phase A of the adapters portfolio roadmap explicitly defers schema dim flexibility to Phase B (v1.x BREAKING). Stub adapter inherits the same constraint. Adding a runtime dim parameter now would invite consumer error and add API surface that Phase B will rework anyway.

**Alternatives considered:**
- (A) **Constructor parameter `dim: number`** — REJECTED. Phase A constraint says no; user can construct `new DeterministicStubEmbedder({ dim: 384 })` and demo crashes at INSERT.
- (B) **Read `MAX_EMBEDDING_DIM` constant from core** — selected internally; the value happens to be 1536 but reading it explicitly future-proofs against the constant changing in Phase B.
- (C) **Selected: read `MAX_EMBEDDING_DIM` from `src/core/constants.ts`** — single source of truth, Phase B migration touches one constant.

**Consequences:** when Phase B lands and `MAX_EMBEDDING_DIM` becomes runtime-resolved, the stub adapter automatically tracks. Documented in JSDoc.

## Dependency Graph

```
T0.1 (config widening — vitest + tsconfig)
  ↓
T1.1 (embedder stub) ──┐
                       ├─→ T2.1 (barrels + subpath exports)
T1.2 (llm stub)      ──┘             ↓
                                   T3.1 (demo env wiring)
                                       ↓
                                   T4.1 (final validation gate)
```

T0.1 is the gate — config must include new dirs before any RED test can fail meaningfully (otherwise tests are silently not picked up). T1.1 + T1.2 can parallelize (different files, different DIPs). T2.1 depends on both (barrels re-export both classes). T3.1 depends on T2.1 (demo imports through the new subpath). T4.1 is the final gate.

---

## Phase T0: Test runner config gate

### T0.1 — Widen `vitest.contract.config.ts` + `tsconfig.contract.json` to include `src/embedders/` + `src/llms/`

#### Objective

Make new test paths reachable so RED tests in T1.1 + T1.2 actually fail rather than being silently skipped. Closes Stop-Condition #4 plan-defect risk.

#### Evidence

Current `vitest.contract.config.ts` include glob (per Step 0 grep): `src/{core,theokit,agent-tools}/**/__tests__/**/*.test.ts`. Does NOT cover `src/embedders/` or `src/llms/`. Current `tsconfig.contract.json` include (per `testing.md § Typecheck scope`): `src/core/**/*.ts`, `src/theokit/**/*.ts`, `src/agent-tools/**/*.ts`. Does NOT cover `src/embedders/` or `src/llms/`.

#### Files to edit

```
vitest.contract.config.ts — UPDATE: extend include glob to add src/{embedders,llms}/**/__tests__/**/*.test.ts
tsconfig.contract.json     — UPDATE: extend include array to add src/embedders/**/*.ts + src/llms/**/*.ts
```

#### Deep file dependency analysis

- `vitest.contract.config.ts` consumed by `npm test` script. Widening the include glob does not affect other test runners (`vitest.integration.config.ts`, `vitest.e2e.config.ts` are separate).
- `tsconfig.contract.json` consumed by `npm run typecheck`. tsc transitively expands per `testing.md § Typecheck scope gotcha` — but since new files in `src/embedders/`/`src/llms/` only import from `src/core/`, transitive expansion is bounded.
- No other consumers — these configs are project-local.

#### TDD

```
RED:      run `npx vitest run --config vitest.contract.config.ts src/embedders` → "no test files found" exit 1
GREEN:    apply config widening; re-run → finds no tests yet (dir empty) but EXITS 0 (no-tests-but-config-valid)
REFACTOR: none
VERIFY:   `grep -E "src/embedders" vitest.contract.config.ts tsconfig.contract.json` returns ≥ 2 matches
```

#### Acceptance Criteria

- [ ] `vitest.contract.config.ts` include glob covers `src/embedders/**/__tests__/**/*.test.ts` AND `src/llms/**/__tests__/**/*.test.ts`.
- [ ] `tsconfig.contract.json` include array covers `src/embedders/**/*.ts` AND `src/llms/**/*.ts`.
- [ ] `npx tsc --noEmit -p tsconfig.contract.json` exit 0 against current repo (no new code yet → must stay green).
- [ ] `npm test` exit 0 (no regressions to existing 544/2-skip suite).

#### DoD

- [ ] Both config files updated.
- [ ] `npm test` shows the new include patterns in startup banner.
- [ ] Commit: `chore(config)(adapters): widen vitest + tsconfig to include src/{embedders,llms} (T0.1)`.

---

## Phase T1: Deterministic stub adapter implementations

### T1.1 — `DeterministicStubEmbedder` at `src/embedders/stub.ts`

#### Objective

Ship a pure function `embed(text)` that returns a deterministic 1536-dim L2-normalized vector via MD5 seed → Lehmer LCG → fill → normalize.

#### Evidence

Existing zero-vector `StubEmbedder` at `src/local/stubs.ts:37-99` shows the DIP shape: `Embedder` from `src/core/dip/embedder.ts` declares `embed(text): Promise<readonly number[]>` + `embedBatch(texts): Promise<readonly (readonly number[])[]>`. `MAX_EMBEDDING_DIM` constant exported from `src/core/constants.ts` per the existing stub's import (line 19).

#### Files to edit

```
src/embedders/stub.ts                       — NEW: DeterministicStubEmbedder class (~120 LoC; ≤ 150 LoC budget)
src/embedders/__tests__/stub.test.ts        — NEW: determinism + dim + L2 norm tests
```

#### Deep file dependency analysis

- `src/embedders/stub.ts` imports: `crypto.createHash` from `node:crypto` (built-in); `Embedder` type from `../core/dip/embedder.js`; `MAX_EMBEDDING_DIM` from `../core/constants.js`. No new npm dep (Rule 9 honored).
- DIP boundary: `src/embedders/` is a NEW dir at the same hierarchical level as `src/local/`, `src/cloud/`. Per `architecture.md § 3`, it MUST NOT import from `src/local/` or `src/cloud/`. Only `src/core/` allowed upward.
- Embedder DIP method count: 2 methods (`embed` + `embedBatch`) per ADR-0008 — implementation honors both, with `embedBatch` calling `embed` per element (no perf concern for stub).

#### Deep Dives

- **Algorithm specifics**: MD5 digest is 16 bytes; we treat first 8 bytes as `BigInt` seed for Lehmer LCG (`x_{n+1} = (a × x_n) mod m` with `a = 48271, m = 2^31 - 1`). Generate 1536 outputs in `[0, m)`, map to `[-1, 1]` via `(x - m/2) / (m/2)`, then L2-normalize the full 1536-vector.
- **Why L2-normalize**: pgvector cosine distance assumes unit vectors for correctness. Without normalization, magnitude variance pollutes the distance metric. Stub vectors might land arbitrary magnitudes; explicit normalization fixes them on the unit hypersphere.
- **EC-1 absorption — NaN-vector guard in `l2Normalize`**: if for any input the computed pre-normalization L2 norm is below `1e-30` (degenerate near-zero magnitude), `l2Normalize` returns the all-zeros 1536-vector instead of dividing by ~0 and producing NaN. Probability of natural occurrence is ~2^-128 per input (requires MD5 first 8 bytes all-zero AND LCG output zero-sum), but defensive code is 1 line and prevents the catastrophic failure mode (pgvector `vector(1536)` column REJECTS NaN with `ERROR: NaN not allowed in vector`). Test asserts no NaN in output for empty string + 1000 random texts.
- **Collision analysis (corrected v1.2 — F-arch-3 absorption)**: MD5's first 8 bytes give a raw seed space of `~2^64`, BUT the `seed % LCG_MODULUS` step at the LCG boundary collapses the EFFECTIVE seed space to `~2^31` (the Mersenne prime modulus `2^31-1`). Per the birthday paradox, 50% collision probability lands at `sqrt(2^31 * pi / 2) ≈ 46k` distinct inputs — NOT `~2^32 inputs` as originally claimed. For demo / test workloads (≤ 10k distinct texts), collision probability is still negligible (well below 50% threshold). The corrected math is documentation-honesty rather than a capability change.

#### TDD

```
RED:      tests assert determinism (embed(t)===embed(t)), distinctness (embed(t1)!==embed(t2)), dim===1536, L2-norm===1.0 ± 1e-6 — class does not exist yet → tests fail with "Cannot find module" / "DeterministicStubEmbedder is not a constructor"
GREEN:    implement class; tests pass
REFACTOR: extract `seedFromText`, `lcgGenerate`, `l2Normalize` as private helpers if cohesion improves
VERIFY:   `npm test -- src/embedders/__tests__/stub.test.ts` PASS
```

#### Acceptance Criteria

- [ ] `embed(t)` returns same array for repeated calls with same `t` (deep equality).
- [ ] `embed("a")` !== `embed("b")` (any 2 distinct strings).
- [ ] Returned array length === `MAX_EMBEDDING_DIM` === 1536.
- [ ] Returned array L2 norm === 1.0 within `1e-6` tolerance OR all-zeros (EC-1 fallback).
- [ ] **EC-1 absorption**: NO `NaN` in the returned array for: empty string input AND 1000 random-string inputs.
- [ ] `embedBatch([t1, t2])` returns `[embed(t1), embed(t2)]` (same shape, same determinism).
- [ ] File ≤ 150 LoC.
- [ ] No `any`, no `console.log` outside an ADR-D8-style scoped eslint-disable (consistent with existing stub pattern).
- [ ] No paper names in JSDoc (neutral terms only).

#### DoD

- [ ] Class shipped + tests pass.
- [ ] `npx tsc --noEmit -p tsconfig.contract.json` exit 0.
- [ ] `npm run lint` exit 0.

### T1.2 — `DeterministicStubLLM` at `src/llms/stub.ts`

#### Objective

Ship a pure `LLM` implementation with deterministic chat responses (`generateChat`) AND deterministic JSON fact-extraction (`generateResponse` with `{type:'json'}`).

#### Evidence

Existing stub `StubLLM` at `src/local/stubs.ts:62-99`. DIP shape from `src/core/dip/llm.ts`: `LLM.generateChat(messages): Promise<LLMResponse>` + `LLM.generateResponse(messages, responseFormat?): Promise<unknown>`. `LLMResponse` shape from `src/core/message.ts`. The extraction-pipeline contract expects `{ facts: [{ text: string, ... }] }` JSON shape — to be verified at RED test authorship by reading `src/core/extraction/`.

#### Files to edit

```
src/llms/stub.ts                       — NEW: DeterministicStubLLM class (~160 LoC; ≤ 200 LoC budget)
src/llms/__tests__/stub.test.ts        — NEW: determinism + fact-extraction shape tests
```

#### Deep file dependency analysis

- `src/llms/stub.ts` imports: `crypto.createHash` from `node:crypto`; `LLM` type from `../core/dip/llm.js`; `LLMResponse`, `Message` types from `../core/message.js`. No new npm dep.
- DIP boundary same as T1.1: `src/llms/` is sibling of `src/embedders/`. Allowed to import only from `src/core/`.
- LLM DIP method count: 2 methods per ADR-0008. Implementation honors both. `generateResponse` returns `{ facts: string[] }`-shaped object when `responseFormat.type === 'json'`; mirrors `generateChat` for text.

#### Deep Dives

- **Chat response shape**: `{ content: "stub-response:<hex>", role: "assistant" }` where `<hex>` is 4-hex-char tag derived from MD5(stringify(messages)).slice(0,2). Same input → same tag.
- **Extraction JSON shape**: concatenate all `user`-role message content; split on sentence boundaries (regex `/[.!?]+\s+/`); take first 3 non-empty sentences; wrap each as `{ text: sentence.trim() }`; return `{ facts: [...] }`. If the regex extraction-pipeline expects a different field name (e.g., `extractedFacts` vs `facts`), the RED test will catch it at authorship.
- **Verifying extraction contract**: T1.2 RED test step MUST read `src/core/extraction/*.ts` to confirm the JSON shape expected. If the shape is `{ facts: [{ text: string }] }`, GREEN matches. If different (e.g., `{ memory: [...] }` like Mem0), the GREEN must match what core actually expects.

#### TDD

```
RED:      tests assert generateChat determinism + generateResponse({type:'json'}) returns the extraction-pipeline-compatible shape — file does not exist → fail
GREEN:    implement class; tests pass
REFACTOR: split internal helpers (`tagFromMessages`, `extractSentences`) for clarity
VERIFY:   `npm test -- src/llms/__tests__/stub.test.ts` PASS
```

#### Acceptance Criteria

- [ ] `generateChat(msgs)` returns same `LLMResponse` for repeated calls.
- [ ] `generateChat(msgs1) !== generateChat(msgs2)` for distinct `msgs1`/`msgs2`.
- [ ] `generateResponse(msgs, {type:'json'})` returns `{ facts: [{text:string}, ...] }` with up to 3 facts derived from concatenated user content.
- [ ] `generateResponse(msgs, {type:'text'})` matches `generateChat` shape.
- [ ] File ≤ 200 LoC.
- [ ] No `any`, no paper names, no `console.log` outside scoped eslint-disable.

#### DoD

- [ ] Class shipped + tests pass.
- [ ] Typecheck + lint green.

---

## Phase T2: Subpath exports + barrels

### T2.1 — Barrels + `package.json#exports` for `./embedders/*` + `./llms/*`

#### Objective

Make `@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub` resolvable from external consumers. Add barrels for future-adapter aggregation.

#### Evidence

Current `package.json#exports` shape (per Step 1 grep) includes `.`, `./theokit`, `./agent-tools`. Pattern established at v0.2 (theokit) and v0.3 (agent-tools). New subpaths follow same shape (`types` + `default` to source `.ts` for development; build pipeline emits `.d.ts` + `.js` to `dist/` per `architecture.md § 10`).

#### Files to edit

```
src/embedders/index.ts            — NEW: barrel re-exports DeterministicStubEmbedder from './stub.js'
src/llms/index.ts                 — NEW: barrel re-exports DeterministicStubLLM from './llms/stub.js'
package.json                      — UPDATE: add 4 new entries to exports — ./embedders, ./embedders/stub, ./llms, ./llms/stub
src/embedders/__tests__/exports.test.ts  — NEW: smoke test importing through the new subpath via dynamic import resolves
src/llms/__tests__/exports.test.ts       — NEW: same for llms subpath
```

#### Deep file dependency analysis

- `src/embedders/index.ts` MUST NOT re-export anything beyond the deterministic stub in this cycle — keeps the barrel small. Future cycles (OpenAI, Ollama, etc.) extend it.
- `package.json#exports` new entries:
  - `"./embedders": { "types": "./src/embedders/index.ts", "default": "./src/embedders/index.ts" }`
  - `"./embedders/stub": { "types": "./src/embedders/stub.ts", "default": "./src/embedders/stub.ts" }`
  - `"./llms": { "types": "./src/llms/index.ts", "default": "./src/llms/index.ts" }`
  - `"./llms/stub": { "types": "./src/llms/stub.ts", "default": "./src/llms/stub.ts" }`
- `src/index.ts` does NOT gain a re-export of the deterministic classes (per ADR D4). Existing zero-vector stub re-export at `src/index.ts:21` stays.
- Smoke test pattern: `import("./../stub.js").then(m => expect(m.DeterministicStubEmbedder).toBeDefined())` — uses relative path within `src/` (the package.json `exports` map is for external consumers; internal tests use relative paths).

#### TDD

```
RED:      import smoke tests fail because barrel files don't exist
GREEN:    create barrels; tests pass
REFACTOR: none
VERIFY:   `npm pack --dry-run | grep embedders/stub` shows the file in the published surface
```

#### Acceptance Criteria

- [ ] `src/embedders/index.ts` + `src/llms/index.ts` exist + barrel-re-export only the deterministic stub classes from this cycle.
- [ ] `package.json#exports` lists 4 new entries.
- [ ] Smoke tests verify both subpath resolves are importable.
- [ ] `src/index.ts` is UNCHANGED (no root re-export of deterministic classes per ADR D4).

#### DoD

- [ ] All files committed + tests pass.
- [ ] `npm publish --dry-run` lists the new paths in the tarball.

---

## Phase T3: Demo wiring (opt-in)

### T3.1 — Demo `lib/memory.ts` swaps to stubs when `THEOMEM_USE_STUB_ADAPTERS=1`

#### Objective

Demo boots with deterministic stubs when env var set, enabling F-T4.1-2 reproducible debug without OpenAI.

#### Evidence

Demo's `examples/chat-with-memory/lib/memory.ts:127-130` currently constructs `new OpenAIEmbedder()` + `new OpenAILLM()` unconditionally. Pre-existing pattern from previous cycle (`resolveEviction`) for env-var-based conditional wiring at the same file. Demo's existing structural typing means swapping adapter is safe (DIP boundary).

#### Files to edit

```
examples/chat-with-memory/lib/memory.ts   — UPDATE: branch on THEOMEM_USE_STUB_ADAPTERS env; add ~20 LoC
examples/chat-with-memory/README.md       — UPDATE: add row to "Optional env" table documenting the var
```

#### Deep file dependency analysis

- Demo imports `DeterministicStubEmbedder` from `@usetheo/memory/embedders/stub` (subpath shipped at T2.1) and `DeterministicStubLLM` from `@usetheo/memory/llms/stub`. NO root-level import (per ADR D4).
- Demo file currently 175 LoC (per pre-flight check post-hotfix). Adding ~20 LoC for env branching keeps it ≤ 200 LoC AC + ≤ 500 LoC architecture budget.
- Console log gains an `adapters=stub` OR `adapters=openai` line analogous to existing `eviction=` line.

#### TDD

```
RED:      n/a (ADR D5 of previous cycle — demo has no unit-test infra; manual boot verification)
GREEN:    boot with THEOMEM_USE_STUB_ADAPTERS=1 → console shows `adapters=stub`; POST /api/chat returns 200; raw SQL shows deterministic facts persisted (same input → same rows on multiple runs)
REFACTOR: minor — small diff
VERIFY:   manual smoke test post-boot
```

#### Acceptance Criteria

- [ ] Console log shows `adapters=stub` when env var = `"1"`.
- [ ] Console log shows `adapters=openai` otherwise (default unchanged).
- [ ] POST /api/chat with stubs active returns 200 + SSE stream completes.
- [ ] Raw SQL shows facts persisted with deterministic content (e.g., `User: Hello\nAssistant: stub-response:abcd` parses into 1 fact reliably).
- [ ] Demo `npm run build` PASS.
- [ ] README "Optional env" table row added.

#### DoD

- [ ] Demo file ≤ 200 LoC.
- [ ] README documents the var.

---

## Phase T4: Final validation gate + commit

### T4.1 — Validation gate + push

#### Objective

Run standard project gates + push to origin/develop.

#### Files to edit

```
(none — pure validation + git commit)
```

#### Tasks

1. `npm test` → PASS expected (544/2-skip baseline + new contract tests).
2. `npm run typecheck` → exit 0.
3. `npm run lint` → exit 0 (no warnings, no errors).
4. `cd examples/chat-with-memory && npm run build` → demo Next.js build PASS.
5. `npm publish --dry-run` → confirm new subpath entries present in the tarball.
6. Optional manual smoke: boot demo with `THEOMEM_USE_STUB_ADAPTERS=1` and confirm `/api/chat` round-trip works without OpenAI.
7. Commit each task's atomic changes.
8. `git push origin develop`.

#### TDD

```
RED:      n/a (final gate task)
GREEN:    all 5 gates PASS
REFACTOR: address any failures
VERIFY:   `git log origin/develop -5` shows the new commits
```

#### Acceptance Criteria

- [ ] All 5 gates PASS.
- [ ] Atomic commits on develop with conventional-commits format.
- [ ] Pushed to origin/develop.

#### DoD

- [ ] `git log origin/develop -3` shows the new commits.
- [ ] No regressions in pre-existing test suite (544/2-skip preserved + N new added).

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | F-T4.1-2 debug blocked by OpenAI quota — need offline reproducibility | T1.1 + T1.2 + T3.1 | Deterministic stubs + demo opt-in wire-up; F-T4.1-2 re-isolation possible without OpenAI |
| 2 | Adapters portfolio Cycle 1 P0 (stub embedder + stub LLM at subpath) | T1.1 + T1.2 + T2.1 | Two new classes + four new subpath exports established as portfolio precedent |
| 3 | Pre-existing zero-vector stubs at `src/local/stubs.ts` must NOT regress (ADR D8 contract) | T1.1 + T1.2 (NEW files, no overwrite) | New classes at NEW paths; existing stubs untouched |
| 4 | Test runner config gate prevents Stop-Condition #4 plan-defect | T0.1 | `vitest.contract.config.ts` + `tsconfig.contract.json` widened before T1 starts |
| 5 | Demo opt-in pattern parallel to existing `THEOMEM_EVICTION_DEMO` | T3.1 | Same env-var-strict-equality pattern reused for consistency |
| 6 | Schema dim constraint Phase A (1536-dim only) | T1.1 (uses `MAX_EMBEDDING_DIM` constant) | Stub adapter inherits the constant; Phase B migration future will adjust automatically |
| 7 | Final validation: lint/typecheck/build/test all PASS + npm publish dry-run includes new paths | T4.1 | Five-gate chain executed; commits pushed |

**Coverage: 7/7 gaps covered (100%)**

---

## Global Definition of Done

- [ ] All 5 tasks (T0.1 → T4.1) committed and validated.
- [ ] `npm test` PASS (no regressions; new contract tests included).
- [ ] `npm run typecheck` exit 0 (tsc-checked against widened `tsconfig.contract.json`).
- [ ] `npm run lint` exit 0 (no warnings, no errors).
- [ ] Demo `npm run build` PASS.
- [ ] `npm publish --dry-run` lists `src/embedders/` + `src/llms/` files in the tarball.
- [ ] No `production-ready` / `production-grade` / `v1.0 ready` token introduced (vocabulary lock per `dogfood-golden-rule.md` + `public-copy.md` preserved).
- [ ] No paper names in new src/test code (`no-paper-names-in-code.md` honored).
- [ ] File-size budgets respected: `src/embedders/stub.ts` ≤ 150 LoC; `src/llms/stub.ts` ≤ 200 LoC; demo `lib/memory.ts` ≤ 200 LoC; barrels ≤ 30 LoC each (small re-export files).
- [ ] DIP boundaries preserved: `src/embedders/` + `src/llms/` import ONLY from `src/core/` (per `architecture.md § 3`).
- [ ] CHANGELOG.md `[Unreleased]` entry under `Added` documenting new subpath exports + opt-in env var.
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/adapters-stub-embedder-llm-cycle-1-plan.md` AFTER /review verdict ≥ READY_TO_MERGE OR after merge to main.

## Final Phase: Integration Validation (MANDATORY)

### Execution

```
npm test                                                    # contract suite green; new tests included
npm run typecheck                                           # zero TS errors against widened tsconfig
npm run lint                                                # zero lint warnings
cd examples/chat-with-memory && npm run build && cd -       # demo Next.js build PASS
npm publish --dry-run                                       # confirm new subpaths present in tarball
THEOMEM_USE_STUB_ADAPTERS=1 [boot demo manually]            # smoke test: facts persist deterministically
```

### Acceptance Criteria

- [ ] All 6 chain steps PASS in order.
- [ ] Optional smoke: F-T4.1-2 re-isolation now reproducible (same input → same DB state every run).

### If Validation Fails

1. Identify which failures are caused by this plan vs pre-existing artifacts.
2. Fix plan-caused failures before declaring complete.
3. Re-run the full validation chain to confirm fixes.
4. NEW BLOCKER/CRITICAL surface → draft `adapters-stub-embedder-llm-cycle-1-plan v1.1` and re-loop; do NOT merge.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none — uses Node built-ins only) | — | — | `node:crypto` is built-in; Lehmer LCG is textbook code; no new npm dep needed. Inquebrável Rule 9 (Não Reinvente) — Crypto MD5 is canonical, LCG is 10 LoC. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | — | — | — | Zero new deps — by design. Future adapter cycles (Ollama, OpenAI extract, etc.) WILL introduce optionalDependencies per the roadmap. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Goal recap (machine-readable)

```
verb: ship
metric: npm test contract suite passes 100% AND new deterministic adapter tests assert: embed(t)===embed(t) AND embed(t1)!==embed(t2) AND llm.generate(p)===llm.generate(p)
gate_artifact: .claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-implement-validate-2026-06-01.md (created by /implement T4.1)
absolute_thresholds:
  - contract_tests_passed: 100%
  - new_adapter_tests_added: ≥ 6 (3 embedder determinism + 3 llm determinism)
  - npm_publish_dryrun_contains_embedders_stub: true
  - npm_publish_dryrun_contains_llms_stub: true
  - existing_stubs_unchanged: true (src/local/stubs.ts byte-identical pre/post)
  - production_ready_vocabulary_introduced: false
deliverable_count: ≤ 6 atomic commits on develop (T0.1 config gate; T1.1 embedder; T1.2 llm; T2.1 barrels+exports; T3.1 demo wiring; T4.1 validation+push)
unblocks: F-T4.1-2 root-cause re-isolation cycle (next-after-this)
addresses_gaps_from: adapters portfolio roadmap (commit 7bacee9) Cycle 1 P0 entries
```
