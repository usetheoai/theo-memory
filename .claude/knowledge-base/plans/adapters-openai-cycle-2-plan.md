# Plan: Adapters portfolio Cycle 2 — extract OpenAI adapters from demo to SDK

> **Version 1.1** (2026-06-01) — Absorbs ALL 10 edge cases from `/edge-case-plan` review at `.claude/knowledge-base/reviews/adapters-openai-cycle-2-edge-cases-2026-06-01.md`. 0 MUST FIX (MOVE-only scope bounds risk). **4 SHOULD TEST absorbed as sub-steps**: EC-1 demo-wide grep before T3.2 (catch orphan importers); EC-2 smoke tests NEVER call `.embed()`/`.embedBatch()` (would hit live API); EC-3 extend `src/__tests__/no-root-reexport.test.ts` to assert OpenAI classes undefined at root barrel; EC-4 T1.2 pre-flight verifies `src/core/dip/llm.ts:LLM.generateResponse` actually has `tools?` 3rd param. **6 DOCUMENT absorbed as JSDoc notes**: EC-5 plan-text correction (no MAX_EMBEDDING_DIM reference — 1536 dim is implicit via OpenAI model); EC-6 `optionalDependencies` + `--no-optional` consumer guidance; EC-7 hard-coded models deferred to Cycle 2.X; EC-8 lazy singleton = one client per process; EC-9 `OPENAI_API_KEY` late-set env hazard; EC-10 opaque JSON-parse error shape `{error:'non_json_response', raw}` preserved per ADR D3. **ALSO absorbs `/deps-audit` advisory**: openai pin bumped `^4.50.0` → `^4.77.0` to MATCH demo's existing pin in `examples/chat-with-memory/package.json` (prevents silent demo regression on `npm install` resolution). Plan dep audit verdict: PASS_WITH_CAVEATS (zero CVE on openai; 4 pre-existing MODERATE allowlisted unchanged; ADR D3 MOVE-only correctly defers major bumps to Cycle 2.X so `soft_floor_plan_dep_major_outdated_unpinned` does NOT fire).
>
> **Version 1.0** (2026-06-01) — Cycle 2 of the adapters-portfolio-roadmap (`.claude/knowledge-base/plans/adapters-portfolio-roadmap.md` § Cycle 2). Cycle 1 (stub adapters) shipped in PR #25 and proved out the subpath layout `@usetheo/memory/embedders/*` + `@usetheo/memory/llms/*`. This cycle MOVES the existing OpenAI implementations from `examples/chat-with-memory/lib/openai-adapters.ts` (~92 LoC) to the SDK at `@usetheo/memory/embedders/openai` + `@usetheo/memory/llms/openai`, scope locked to **MOVE-only** (zero behavioral change). Unblocks (a) other consumers of the SDK from instantiating OpenAI adapters without copy-pasting the demo code, (b) empirical validation of F-T4.1-2's hotfix-lift risk envelope with real OpenAI (PR #26).

## Goal

Ship `OpenAIEmbedder` + `OpenAILLM` adapters at `@usetheo/memory/embedders/openai` + `@usetheo/memory/llms/openai` by MOVING (not refactoring) the existing implementation from `examples/chat-with-memory/lib/openai-adapters.ts`, measured by `npm test` contract suite passing + `npm pack --dry-run` listing the 2 new subpath source files + the demo importing from the SDK paths instead of its local file + `npm run build` of demo PASS.

The action verb is **extract**; the named observable metric is `npm pack --dry-run --json | grep -E 'src/(embedders|llms)/openai\.ts' | wc -l === 2` AND `grep -E "from .*openai-adapters" examples/chat-with-memory/lib/*.ts === 0` (no consumer of the legacy demo path remains).

## Context

### What exists today

- **`examples/chat-with-memory/lib/openai-adapters.ts`** (~92 LoC): exports `OpenAIEmbedder` + `OpenAILLM` implementing `@usetheo/memory/contract` DIPs. Models: `text-embedding-3-small` (1536 dims; matches `pgvector(1536)` schema cap), `gpt-4o-mini` (chat + extraction). Lazy-singleton client pattern (`_openai: OpenAI | null` guard for build-time page-data collection without runtime env).
- **`examples/chat-with-memory/lib/memory.ts:resolveAdapters`** at line 157-161 picks between `DeterministicStubEmbedder` (PR #25) or `OpenAIEmbedder` (this cycle's surface) via `THEOMEM_USE_STUB_ADAPTERS=1` env.
- **`examples/chat-with-memory/package.json`** already has `"openai": "^X.Y.Z"` as a regular dep (demo-scoped).
- **`@usetheo/memory` (root SDK) `package.json#dependencies`**: zero LLM provider SDKs today. `optionalDependencies` already used for `natural: "^8.1.0"` (per v0.6.1 voyager precedent + Inquebrável Rule 9 discipline).
- **Subpath exports established by Cycle 1** in root `package.json#exports`: `./embedders` + `./embedders/stub` + `./llms` + `./llms/stub` (4 new entries from PR #25). Pattern is locked.
- **`vitest.contract.config.ts` + `tsconfig.contract.json` + `tsconfig.build.json`**: all already cover `src/embedders/**/*.ts` + `src/llms/**/*.ts` (per PR #25 T0.1 + PR #25-fixes `T0.2` widening).

### Why this matters NOW

1. **Cycle 1 (stubs) is the proving harness.** With the layout shape proved out, Cycle 2 unlocks REAL adapters. Without an SDK OpenAI adapter, every consumer copy-pastes the demo's `openai-adapters.ts` — that's the anti-pattern Cycle 2 closes.
2. **F-T4.1-2 hotfix-lift risk envelope (PR #26 F1)** says: "if F-T4.1-2 resurfaces with real OpenAI: re-apply hotfix + file follow-up cycle". The SDK's regression test currently uses deterministic stubs only; surfacing the OpenAI adapter as a first-class SDK export makes follow-up cycles easier (no demo dependency to debug eviction with real OpenAI).
3. **Adapters portfolio roadmap (`adapters-portfolio-roadmap.md`) Cycle 2 P0** explicitly lists OpenAI extract as the natural next step.

### Accepted risks (declared upfront)

- **EC-A — Demo's `package.json` retains `openai` as a regular dep** even though the SDK now imports it via `optionalDependencies`. This is correct (the demo runtime requires openai unconditionally if `THEOMEM_USE_STUB_ADAPTERS !== '1'`). Mitigation: SDK guards with dynamic import-style or optional peer pattern; demo continues to load openai eagerly.
- **EC-B — `optionalDependencies` semantics under npm**: optional deps install by default; consumers opt OUT via `npm install --no-optional`. Per Inquebrável Rule 9 + v0.6.1 `natural` precedent. Consumers who use ONLY stubs from `@usetheo/memory/embedders/stub` can `npm install --no-optional` to avoid the openai package weight.
- **EC-C — MOVE-only scope discipline**: zero behavioral change from current demo file. Same models, same lazy client, same JSON-extraction error path. Future cycles (Cycle 2.X if needed) add retry/backoff + structured error types. This cycle is JUST the lift.
- **EC-D — `npm test` baseline preserved**: 573 PASS / 2 skipped / 0 type errors must not regress. The new SDK files require minimal contract tests (smoke + import surface) but NO new integration tests (real OpenAI calls require live API key + cost; deferred to consumer dogfood per ADR D6 of Cycle 1's `examples/chat-with-memory` opt-in pattern).
- **EC-E — File-size budgets**: `src/embedders/openai.ts` ≤ 60 LoC (move from ~20 LoC demo source); `src/llms/openai.ts` ≤ 80 LoC (move from ~45 LoC demo source). Well under `architecture.md § Module hygiene` 500 LoC cap.

### Compliance scope

Honors `architecture.md § 3 DIP` — adapters live OUTSIDE `src/core/`; `src/core/` does NOT import from `src/embedders/openai.ts` or `src/llms/openai.ts`. Honors `§ 6 Naming` (kebab-case files, PascalCase classes, camelCase functions). Honors `§ 7 Module hygiene` (ES modules, no `any`, no `console.log`). Honors `§ 9 Public API surface` — 2 new subpath exports declared in `package.json#exports`. Honors `testing.md § Pyramid` (contract-level smoke tests; integration deferred). Honors `no-paper-names-in-code.md`. Honors `dogfood-golden-rule.md` (no `production-ready` claim). Honors Inquebrável Rule 9 (`openai` SDK is the canonical TypeScript client for OpenAI's API; `optionalDependencies` keeps stub-only consumers free of the install). Honors Inquebrável Rule 5 (TDD — smoke test before move; new package.json exports asserted via existing `tests/integration/publish-readiness.test.ts` precedent).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@usetheo/memory/contract` | (workspace) | npm | DIP imports (`Embedder`, `LLM`, `LLMResponse`, `Message`); same as demo file uses today |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `openai` (NEW; `optionalDependencies`) | `^4.77.0` | npm | Evaluated: (a) `openai` (official, this) — official SDK from OpenAI, maintained by them, ~50KB minified; (b) `@anthropic-ai/sdk` — wrong vendor; (c) raw `fetch` against API — would reinvent error handling, retry logic, types, streaming. Per Inquebrável Rule 9 + the existing demo already pinning `openai ^4.x`. | Official OpenAI TypeScript SDK; demo already uses it; lift = move not rewrite |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Objective

- [ ] T0.1 — Add `openai: ^4.77.0` to root `package.json#optionalDependencies` (same tier as `natural`); verify `npm install` resolves without error; confirm `tsconfig.contract.json` already covers `src/embedders/openai.ts` + `src/llms/openai.ts` paths (per PR #25 T0.1 widening, no further config change needed).
- [ ] T1.1 — Create `src/embedders/openai.ts` with `OpenAIEmbedder` class implementing `Embedder` DIP. Lift verbatim from `examples/chat-with-memory/lib/openai-adapters.ts:28-47`. Lazy-singleton client retained. `EMBED_MODEL = 'text-embedding-3-small'`, 1536 dims. Empty-batch guard (`if (texts.length === 0) return []`) retained.
- [ ] T1.2 — Create `src/llms/openai.ts` with `OpenAILLM` class implementing `LLM` DIP. Lift verbatim from `examples/chat-with-memory/lib/openai-adapters.ts:49-92`. `CHAT_MODEL = 'gpt-4o-mini'`. JSON-parse error path returns `{ error: 'non_json_response', raw: content }` (UNCHANGED — explicit per ADR D3). `_tools?: readonly unknown[]` 3rd param on `generateResponse` to match the Cycle 1 stub's DIP shape (per `src/core/dip/llm.ts:22-26`).
- [ ] T2.1 — Add `OpenAIEmbedder` to `src/embedders/index.ts` barrel + `OpenAILLM` to `src/llms/index.ts` barrel. Declare new subpath exports `./embedders/openai` + `./llms/openai` in root `package.json#exports`. Root `src/index.ts` does NOT re-export the OpenAI classes (per ADR D4 of Cycle 1 — consumer-opt-in via subpath only).
- [ ] T3.1 — Update `examples/chat-with-memory/lib/memory.ts:resolveAdapters` to import `OpenAIEmbedder` + `OpenAILLM` from `@usetheo/memory/embedders/openai` + `@usetheo/memory/llms/openai` (matching the stub-import pattern at line 54-55).
- [ ] T3.2 — Delete `examples/chat-with-memory/lib/openai-adapters.ts` (zero remaining importers post-T3.1). Demo's `package.json` keeps `openai` dep (the demo still loads it eagerly via SDK transitive).
- [ ] T4.1 — Integration validation gate: `npm test` baseline 573/2-skip preserved + typecheck + lint clean + `npm pack --dry-run` lists 2 new subpath files + demo `npm run build` PASS + CHANGELOG `[Unreleased] § Added` entry + push to `origin/develop`.

## ADRs

### D1 — Subpath shape mirrors Cycle 1 stub layout

**Decision:** new exports use `@usetheo/memory/embedders/openai` + `@usetheo/memory/llms/openai` (contract-first nested). Symmetric with `@usetheo/memory/embedders/stub` + `/llms/stub` from Cycle 1.

**Alternatives considered:**
- (A) Single subpath `@usetheo/memory/openai` exporting both classes — REJECTED: breaks symmetry with Cycle 1; one provider has TWO contracts (Embedder + LLM); contract-first scales better for the 52-adapter portfolio.
- (B) Provider-first 2-level `@usetheo/memory/openai/embedder` + `/openai/llm` — REJECTED: would force breaking change to Cycle 1's `/embedders/stub` layout OR create inconsistent topology. Inconsistent topology is anti-FAANG per modern OSS convention (LangChain, LlamaIndex Mem0 all keep one direction within a package).
- (C) Mirror Cycle 1 layout `/embedders/openai` + `/llms/openai` — CHOSEN. Matches both internal Cycle 1 precedent + Mem0's contract-first convention (the source of truth per CLAUDE.md "Mem0-shape").

**Rationale:** consistency > novelty. Cycle 1 ADR D4 locked the layout; Cycle 2 honors it. The 52-adapter portfolio + 12 embedders + 20 LLMs scale naturally — each adapter is a file in the existing dirs.

**Consequences:** consumers import via `@usetheo/memory/embedders/openai` + `@usetheo/memory/llms/openai`. Future Cycles 3-7 add adapters as new files in the same dirs. Zero breaking changes to PR #25's layout.

### D2 — `openai` SDK added as `optionalDependencies` (Inquebrável Rule 9)

**Decision:** `openai: ^4.77.0` added to root `package.json#optionalDependencies` (not `dependencies`). Pin matches the demo's existing pin in `examples/chat-with-memory/package.json` to prevent silent regression on `npm install` resolution (per `/deps-audit` advisory absorbed in plan v1.1).

**Alternatives considered:**
- (A) Regular `dependencies` — REJECTED: forces stub-only consumers to install the openai package weight (~50KB minified) they don't need. Violates the spirit of the stub adapters' design intent ("offline + deterministic + no external API").
- (B) `peerDependencies` — REJECTED: requires consumers to install openai manually; awkward DX. `optionalDependencies` installs by default but allows `npm install --no-optional` opt-out.
- (C) `optionalDependencies` (CHOSEN) — matches the `natural` precedent from v0.6.1 voyager-skill-library; same DX pattern; consumers can opt out.

**Rationale:** Inquebrável Rule 9 (Não Reinvente) — official SDK is the source of truth for OpenAI's API. `optionalDependencies` keeps the install footprint lean for stub-only consumers.

**Consequences:** consumers who use ONLY stubs from `/embedders/stub` + `/llms/stub` can run `npm install --no-optional` to skip the openai download. Consumers using `OpenAIEmbedder` + `OpenAILLM` get it transparently via default `npm install`. The SDK code at `src/embedders/openai.ts` + `src/llms/openai.ts` uses `import OpenAI from 'openai'` directly (NOT dynamic import — TypeScript types are static + the consumer's tree-shaker handles the lazy load).

### D3 — MOVE-only scope discipline (Cycle 2 ships ZERO behavioral change)

**Decision:** Cycle 2 lifts the existing OpenAI implementations VERBATIM from the demo. Zero refactor, zero new features, zero error-handling additions. The JSON-parse error path that returns `{ error: 'non_json_response', raw: content }` is PRESERVED (NOT changed to throw a structured error).

**Alternatives considered:**
- (A) MOVE + harden (retry/backoff + structured errors) — REJECTED: scope creep. The hardening belongs in Cycle 2.1 (separate cycle) so the move is auditable atomically.
- (B) MOVE + add OpenRouter compatibility — REJECTED: large new feature surface; orthogonal to F-T4.1-2 risk envelope; defer to Cycle 2.2 if multi-provider is needed.
- (C) MOVE only (CHOSEN) — atomic lift; behavioral diff = zero; easy revert; clear narrative.

**Rationale:** YAGNI + Single Responsibility for Cycle 2 = "extract". Hardening is a separate concern that can land as Cycle 2.1 after Cycle 2 closes. Atomic moves are easier to review + revert if a downstream cycle surfaces a regression.

**Consequences:** the OpenAI adapter is feature-parity with the demo's current behavior. Any consumer hitting OpenAI rate limits + needing retry logic gets the same UX as the demo today (no retry). Filing of Cycle 2.1 (harden) is the natural follow-up if dogfood surfaces a retry need.

### D4 — Demo file deleted, NOT kept as 1-line re-export

**Decision:** `examples/chat-with-memory/lib/openai-adapters.ts` is DELETED in T3.2 after T3.1 updates the only consumer (`lib/memory.ts:resolveAdapters`). No 1-line re-export legacy file is retained.

**Alternatives considered:**
- (A) Keep `lib/openai-adapters.ts` as `export { OpenAIEmbedder, OpenAILLM } from '@usetheo/memory/embedders/openai'` (1-line re-export) — REJECTED: dead file with no purpose; future contributors confused which path to use.
- (B) Delete the file (CHOSEN) — cleaner; single source of truth (the SDK).
- (C) Delete the file AND deprecate any other demo files importing it — verified: ONLY `lib/memory.ts` imports `./openai-adapters`. Safe to delete.

**Rationale:** Inquebrável Rule 3 (extreme honesty) + Clean Code (no dead files).

**Consequences:** the demo's `lib/openai-adapters.ts` ceases to exist. Demo `npm run build` validates the cleanup at integration validation gate.

### D5 — Contract tests only; integration tests deferred to consumer dogfood

**Decision:** Cycle 2 ships smoke unit tests at `src/embedders/__tests__/openai.test.ts` + `src/llms/__tests__/openai.test.ts` asserting (a) class exports, (b) DIP shape compliance (method signatures match), (c) lazy-client semantics (import doesn't throw without `OPENAI_API_KEY`). NO new integration tests that hit real OpenAI (cost + flakiness + CI secret management).

**Alternatives considered:**
- (A) Add `tests/integration/openai-adapter.test.ts` with real API call gated by `CI_OPENAI_API_KEY` — REJECTED: introduces CI cost + flakiness + secret management overhead for a MOVE that doesn't change behavior.
- (B) Smoke tests only + defer real-API tests to consumer dogfood (the chat-with-memory demo IS the real-API dogfood; `/test-chat-with-memory` Group B-G already exercises OpenAI today) — CHOSEN.
- (C) No tests at all (lift is trivial) — REJECTED: Inquebrável Rule 5 (TDD) + ADR D4 EC-6 of Cycle 1 (root-no-reexport test) precedent says contract surfaces deserve a smoke test.

**Rationale:** matches Cycle 1's testing posture (contract suite covers determinism; integration tier deferred to the F-T4.1-2 debug cycle that consumed the stubs). For OpenAI, the demo IS the integration test.

**Consequences:** post-Cycle-2 the OpenAI adapter has unit-level smoke coverage. Future Cycle 2.1 (harden) can add integration tests gated by `process.env.CI_OPENAI_API_KEY` if production-grade signals are needed.

### D6 — No new `console.log` outside JSDoc — match Cycle 1 hygiene

**Decision:** the OpenAI adapter source files honor `architecture.md § 7 Module hygiene` (no `console.log` in production paths). Existing demo file already complies; verify at lift.

**Alternatives considered:**
- (A) Add `console.warn` on retry/error scenarios — REJECTED: scope creep (would add retry per ADR D3); production warning channel = structured logger per `src/core/dip/logger.ts` (planned, not shipped).
- (B) Mirror demo's existing zero-console pattern (CHOSEN) — clean lift.

**Rationale:** match Cycle 1 module hygiene precedent.

**Consequences:** `npm run lint` PASS on the new files. No `no-console` rule violations.

## Dependency Graph

```
T0.1 (add openai to optionalDependencies)
  ↓
T1.1 (create src/embedders/openai.ts)         T1.2 (create src/llms/openai.ts)
  ↓                                              ↓
  └──────────────────────┬───────────────────────┘
                         ↓
                   T2.1 (barrels + package.json#exports)
                         ↓
                   T3.1 (update demo lib/memory.ts imports)
                         ↓
                   T3.2 (delete demo openai-adapters.ts)
                         ↓
                   T4.1 (validation gate + push)
```

T1.1 + T1.2 parallelizable. T3.1 + T3.2 sequential (T3.2 requires T3.1's import update to be the only remaining consumer).

## Phases

### T0.1 — `optionalDependencies` + verify config coverage

**Plan reference:** ADR D2.

**Files to edit:**
- `package.json` (UPDATE — add `"openai": "^4.77.0"` to `optionalDependencies` block)

**TDD:**
- **RED:** `npm ls openai` returns 0 results in root (only demo has it).
- **GREEN:** add to root `optionalDependencies`; `npm install` succeeds; `npm ls openai` shows ^4.77.0 in root.
- **REFACTOR:** none.

**Acceptance criteria:**
- [ ] `npm ls openai` from repo root returns 1+ result
- [ ] `tsconfig.contract.json` + `tsconfig.build.json` already include `src/embedders/**/*.ts` + `src/llms/**/*.ts` (no edit needed — verified per PR #25 widening)

**COMMIT:** `chore(deps)(adapters-cycle-2): add openai SDK as optionalDependencies (T0.1 / ADR D2)`

### T1.1 — `src/embedders/openai.ts` (extract OpenAIEmbedder)

**Plan reference:** ADR D1 + ADR D3.

**Files to edit:**
- `src/embedders/openai.ts` (NEW — lifted from demo's `openai-adapters.ts:1-47`)
- `src/embedders/__tests__/openai.test.ts` (NEW — smoke + DIP shape)

**Deep file dependency analysis:**
- Demo file imports `OpenAI` from `openai` SDK and `Embedder` from `@usetheo/memory/contract`. SDK file imports `OpenAI` directly (now via `optionalDependencies`) + `Embedder` from `../core/index.js` (internal relative path; matches Cycle 1 stub pattern).
- `EMBED_MODEL = 'text-embedding-3-small'` (1536 dims, implicit via the model name — the OpenAI API determines the dimension). **EC-5 absorption:** the file does NOT import `MAX_EMBEDDING_DIM` from `src/core/constants.ts` (unlike the stub adapter); the dim is model-implicit. Plan v1.0 misstated this; corrected in v1.1.
- Lazy singleton client (`_openai: OpenAI | null`) retained verbatim. Build-time page-data collection without runtime env is the documented reason (per demo JSDoc).

**TDD:**
- **RED:** smoke test `expect(OpenAIEmbedder).toBeDefined()` + DIP shape `expect(typeof embedder.embed).toBe('function')` + `expect(typeof embedder.embedBatch).toBe('function')` — fails because file doesn't exist.
- **GREEN:** create file with lifted code; tests PASS.
- **EC-2 absorption (smoke tests NEVER hit network):** the smoke test asserts ONLY (a) class defined, (b) method types are `'function'`. It DOES NOT call `.embed()` or `.embedBatch()` (would hit live OpenAI API → cost + 401 + flakiness in CI). Add explicit JSDoc above the test block: `// DO NOT call .embed() / .embedBatch() in this smoke test — it would hit the live OpenAI API.`
- **REFACTOR:** verify zero behavioral diff via `git diff examples/chat-with-memory/lib/openai-adapters.ts src/embedders/openai.ts` (only headers + import paths differ).

**JSDoc requirements on the new file (EC-6, EC-7, EC-8, EC-9 absorption):** the class-level JSDoc MUST document:
1. **EC-6 — `optionalDependencies` consumer guidance:** "Requires `openai` SDK as an `optionalDependency`. Consumers using `npm install --no-optional` will get TS compile errors if they import this module; use `@usetheo/memory/embedders/stub` instead for offline / deterministic dev."
2. **EC-7 — model parameterization deferred:** `@todo Cycle 2.X — accept model name via constructor param (today hard-coded to text-embedding-3-small per MOVE-only ADR D3).`
3. **EC-8 — one client per process:** `@remarks Lazy module-level singleton — ONE OpenAI client shared across all OpenAIEmbedder + OpenAILLM instances in the process. Multi-account support deferred to Cycle 2.X.`
4. **EC-9 — env timing:** "process.env.OPENAI_API_KEY MUST be set BEFORE the first .embed() call. If using dotenv, ensure `import 'dotenv/config'` runs before any import of this module — the singleton captures the env at first .embed() invocation."

**Acceptance criteria:**
- [ ] `src/embedders/openai.ts` exists with `OpenAIEmbedder` class
- [ ] Class implements `Embedder` DIP (compile-time check via TS)
- [ ] Smoke test PASSes; smoke test does NOT call `.embed()` / `.embedBatch()` (EC-2)
- [ ] LoC ≤ 60 (excluding JSDoc lines added per EC-6/7/8/9; ≤ 80 with JSDoc)
- [ ] JSDoc carries the 4 absorption notes above

**COMMIT:** `feat(embedders)(adapters-cycle-2): extract OpenAIEmbedder from demo (T1.1 / ADR D3)`

### T1.2 — `src/llms/openai.ts` (extract OpenAILLM)

**Plan reference:** ADR D1 + ADR D3.

**Files to edit:**
- `src/llms/openai.ts` (NEW — lifted from demo's `openai-adapters.ts:49-92`)
- `src/llms/__tests__/openai.test.ts` (NEW — smoke + DIP shape)

**Deep file dependency analysis:**
- Demo file's `generateResponse` signature `(messages, responseFormat?) → unknown` matches `src/core/dip/llm.ts:LLM.generateResponse` shape. SDK file adds the 3rd param `_tools?: readonly unknown[]` to match the FULL DIP signature per PR #25 fix-up cycle (Cycle 1 SEPA pre-RED brief locked this).
- `CHAT_MODEL = 'gpt-4o-mini'` retained.
- JSON-parse error path `{ error: 'non_json_response', raw: content }` PRESERVED verbatim per ADR D3.

**EC-4 absorption — PRE-FLIGHT VERIFICATION before T1.2 GREEN:**

```bash
grep -A6 "generateResponse" src/core/dip/llm.ts | head -10
```

MUST confirm the LLM DIP signature actually includes `tools?: readonly unknown[]` (or equivalent) as the 3rd parameter. If absent, the `_tools` addition in this task is NOT MOVE-only (it would deviate from current DIP) — ESCALATE to plan revision before GREEN. This guards against the same gotcha that PR #25 fix-up SEPA pre-RED brief caught (plan ADR D3 of source cycle assumed `{facts: [...]}` schema but real schema was `{memory: [...]}`).

**TDD:**
- **RED:** smoke test + DIP shape — fails.
- **GREEN:** create file with lifted code (plus `_tools` 3rd param to match DIP confirmed by EC-4 pre-flight); tests PASS.
- **EC-2 absorption** (same as T1.1): smoke test asserts class defined + method types are `'function'`; does NOT call `.generateChat()` / `.generateResponse()`. Explicit JSDoc note in test file.
- **REFACTOR:** verify behavioral diff is ONLY the `_tools` param addition (matches stub's pattern).

**JSDoc requirements on the new file (EC-6, EC-7, EC-8, EC-9, EC-10 absorption):** the class-level JSDoc MUST document:
1-4. Same as T1.1 EC-6/7/8/9 (one-client-per-process + env-timing + model-parameterization-deferred + optionalDependencies guidance).
5. **EC-10 — opaque JSON-parse error shape:** `@remarks On JSON parse failure of generateResponse({type:'json'}), returns { error: 'non_json_response', raw: <content> } INSTEAD of throwing. Caller MUST check result.error before processing. Future Cycle 2.X may throw a typed OpenAIJsonParseError; current behavior preserved per ADR D3 MOVE-only.`

**Acceptance criteria:**
- [ ] `src/llms/openai.ts` exists with `OpenAILLM` class
- [ ] **EC-4 pre-flight gate:** `src/core/dip/llm.ts:LLM.generateResponse` confirmed to have `tools?` 3rd parameter; otherwise plan revision triggered
- [ ] `generateResponse` signature includes `_tools?: readonly unknown[]` 3rd param (per stub precedent)
- [ ] `generateChat` signature matches DIP
- [ ] Smoke test PASSes; does NOT call `.generateChat()` / `.generateResponse()` (EC-2)
- [ ] LoC ≤ 80 (excluding JSDoc; ≤ 110 with JSDoc)
- [ ] JSDoc carries the 5 absorption notes above

**COMMIT:** `feat(llms)(adapters-cycle-2): extract OpenAILLM from demo (T1.2 / ADR D3)`

### T2.1 — Barrel re-exports + `package.json#exports`

**Plan reference:** ADR D1.

**Files to edit:**
- `src/embedders/index.ts` (UPDATE — add `OpenAIEmbedder` re-export)
- `src/llms/index.ts` (UPDATE — add `OpenAILLM` re-export)
- `package.json` (UPDATE `#exports` — add `./embedders/openai` + `./llms/openai` entries)

**TDD:**
- **RED:** subpath import `@usetheo/memory/embedders/openai` fails (not declared).
- **GREEN:** add 2 new exports entries; subpath imports resolve.
- **REFACTOR:** verify root `src/index.ts` does NOT re-export `OpenAIEmbedder` / `OpenAILLM` (ADR D4 of Cycle 1 — opt-in via subpath only).

**EC-3 absorption — extend `src/__tests__/no-root-reexport.test.ts`:** add 2 new assertions to the existing test (Cycle 1 EC-6 file) verifying root barrel does NOT expose OpenAI classes:

```ts
expect(root.OpenAIEmbedder).toBeUndefined();
expect(root.OpenAILLM).toBeUndefined();
```

The 2 assertions live in the same `it()` block (or sibling `it()` block) as the existing `DeterministicStubEmbedder`/`DeterministicStubLLM` undefined assertions. Preserves the regression guard discipline established by PR #25 fix-up cycle.

**Acceptance criteria:**
- [ ] `package.json#exports` has 2 new entries (`./embedders/openai` + `./llms/openai`) ON TOP of the 4 existing from Cycle 1 = 6 subpath exports total for embedders+llms
- [ ] Barrels re-export 2 stubs + 2 OpenAI = 4 classes total per barrel-set
- [ ] **EC-3 absorption:** `src/__tests__/no-root-reexport.test.ts` extended with `expect(root.OpenAIEmbedder).toBeUndefined()` + `expect(root.OpenAILLM).toBeUndefined()` assertions
- [ ] Root index NOT re-exporting OpenAI classes (verified by the EC-3 extension above)

**COMMIT:** `feat(public-api)(adapters-cycle-2): subpath exports embedders/openai + llms/openai + EC-3 root-no-reexport guard (T2.1 / ADR D1 + EC-3)`

### T3.1 — Update demo to import from SDK

**Plan reference:** ADR D4.

**Files to edit:**
- `examples/chat-with-memory/lib/memory.ts` (UPDATE — change `import ... from "./openai-adapters"` to `import ... from "@usetheo/memory/embedders/openai"` + `... from "@usetheo/memory/llms/openai"`)
- (EC-1 absorption — any OTHER demo files surfaced by the pre-flight grep below get their imports updated atomically in this task)

**EC-1 absorption — PRE-FLIGHT GREP across ALL demo paths BEFORE T3.1 GREEN:**

```bash
find examples/chat-with-memory -name '*.ts' -o -name '*.tsx' | xargs grep -lE 'from .*openai-adapters'
```

MUST return exactly **1 path** (`examples/chat-with-memory/lib/memory.ts`). If returns:
- **> 1 path**: update ALL importers atomically in T3.1 (extend "Files to edit" list); do NOT proceed to T3.2 delete until all consumers redirected.
- **0 paths**: abort — plan's claim about the only importer was wrong; investigate before continuing.

This guards against silent CI break by orphan importers (Inquebrável Rule 3 honesty).

**TDD:**
- **RED:** demo `npm run build` PASSes (current state with old import). Pre-flight grep returns ≥ 1.
- **GREEN:** update ALL imports surfaced by the pre-flight; demo build still PASSes; pre-flight grep returns 0.
- **REFACTOR:** none.

**Acceptance criteria:**
- [ ] **EC-1 absorption:** pre-flight grep returned exactly 1 path before changes (plan claim verified) OR all surfaced importers updated atomically
- [ ] Post-T3.1: `grep -E "from .*openai-adapters" examples/chat-with-memory/lib/*.ts examples/chat-with-memory/app/**/*.ts examples/chat-with-memory/components/**/*.tsx` returns 0 (zero remaining consumers across all demo paths, not just lib/)
- [ ] Demo `npm run build` PASS
- [ ] Demo's `THEOMEM_USE_STUB_ADAPTERS=1` env path still works

**COMMIT:** `refactor(examples)(adapters-cycle-2): import OpenAI adapters from SDK (T3.1 / EC-1)`

### T3.2 — Delete demo's legacy `openai-adapters.ts`

**Plan reference:** ADR D4.

**Files to edit:**
- `examples/chat-with-memory/lib/openai-adapters.ts` (DELETE)

**TDD:**
- **RED:** file exists.
- **GREEN:** delete file; demo `npm run build` still PASS (per T3.1 verification that imports redirect to SDK).
- **REFACTOR:** none.

**Acceptance criteria:**
- [ ] `test ! -f examples/chat-with-memory/lib/openai-adapters.ts`
- [ ] Demo `npm run build` PASS
- [ ] `npm test` PASS (no test references the demo file)

**COMMIT:** `chore(examples)(adapters-cycle-2): delete legacy openai-adapters.ts — SDK is single source of truth (T3.2)`

### T4.1 — Integration validation gate + push

**Plan reference:** standard /implement T4.1 pattern.

**Tasks:**
1. `npm test` exit 0 (baseline 573/2-skip + small delta for new smoke tests)
2. `npm run typecheck` exit 0
3. `npm run lint` exit 0
4. `npm run build` PASS
5. `npm pack --dry-run --json | python3 -c "..."` lists `src/embedders/openai.ts` + `src/llms/openai.ts`
6. Demo `npm run build` PASS
7. CHANGELOG `[Unreleased] § Added` entry for Cycle 2 OpenAI adapters
8. No `production-ready` / `production-grade` / `v1.0 ready` token introduced
9. Commit + push to `origin/develop`

**Acceptance criteria:**
- [ ] All 9 checks PASS
- [ ] Validation report written at `.claude/knowledge-base/reviews/adapters-openai-cycle-2-implement-validate-2026-06-01.md`

**COMMIT:** `chore(implement)(adapters-cycle-2): validation gate + push (T4.1)`

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | SDK exposes OpenAI adapters at canonical subpath | T1.1 + T1.2 + T2.1 | 2 new files + barrel re-exports + package.json#exports |
| 2 | `openai` SDK introduced per Rule 9 with rejected alternatives documented | T0.1 | `optionalDependencies` per ADR D2 |
| 3 | Demo migrated to SDK paths; no copy-paste residue | T3.1 + T3.2 | Update imports + delete legacy file |
| 4 | Zero behavioral change (MOVE-only) | T1.1 + T1.2 ADR D3 | Verbatim lift with only the `_tools` DIP param addition |
| 5 | Subpath shape symmetric with Cycle 1 | T2.1 (declares exports per ADR D1) | `/embedders/openai` + `/llms/openai` mirror `/embedders/stub` + `/llms/stub` |
| 6 | Smoke tests assert DIP shape compliance | T1.1 + T1.2 | New `__tests__/openai.test.ts` per dir |
| 7 | Root index does NOT re-export OpenAI classes (ADR D4 of Cycle 1) | T2.1 | Regression guard via existing `src/__tests__/no-root-reexport.test.ts` |
| 8 | Validation gate verifies all the above | T4.1 | 9-check validation gate |

8 / 8 mapped. Coverage Matrix: 100%.

### Edge-case absorption matrix (v1.1)

| # | Severity | Resolved by | Mechanism |
|---|---|---|---|
| EC-1 | SHOULD TEST | T3.1 pre-flight grep | Atomic update of ALL demo importers (catch orphan files) |
| EC-2 | SHOULD TEST | T1.1 + T1.2 smoke tests | Explicit JSDoc note "DO NOT call .embed()/.generateChat() — would hit live API" |
| EC-3 | SHOULD TEST | T2.1 | Extend `src/__tests__/no-root-reexport.test.ts` with OpenAI undefined assertions |
| EC-4 | SHOULD TEST | T1.2 pre-flight gate | grep `src/core/dip/llm.ts:LLM.generateResponse` for `tools?` 3rd param |
| EC-5 | DOCUMENT (locked) | T1.1 plan-text correction | Removed misleading MAX_EMBEDDING_DIM claim; 1536 dim is model-implicit |
| EC-6 | DOCUMENT | T1.1 + T1.2 JSDoc | optionalDependencies + --no-optional consumer guidance |
| EC-7 | DOCUMENT | T1.1 + T1.2 JSDoc | `@todo Cycle 2.X — model parameterization via constructor param` |
| EC-8 | DOCUMENT | T1.1 + T1.2 JSDoc | `@remarks` lazy singleton = ONE client per process |
| EC-9 | DOCUMENT | T1.1 + T1.2 JSDoc | OPENAI_API_KEY must be set BEFORE first .embed() call |
| EC-10 | DOCUMENT | T1.2 JSDoc | `@remarks` opaque `{error:'non_json_response', raw}` shape preserved per ADR D3 |

10 / 10 edge cases absorbed. EC absorption Coverage: 100%.

## Global Definition of Done

- [ ] All 7 task groups committed (T0.1, T1.1, T1.2, T2.1, T3.1, T3.2, T4.1)
- [ ] `npm test` exit 0 (baseline 573/2-skip + ~2-4 new smoke tests)
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] `npm run build` PASS — `dist/embedders/openai.js` + `dist/llms/openai.js` present
- [ ] `npm pack --dry-run` lists `src/embedders/openai.ts` + `src/llms/openai.ts`
- [ ] Demo `npm run build` PASS post-import-redirect + post-legacy-delete
- [ ] CHANGELOG `[Unreleased] § Added` entry mentions OpenAI adapter extract + plan slug
- [ ] No vocab-lock violations
- [ ] No paper names in src/test code
- [ ] File-size budgets respected (`src/embedders/openai.ts` ≤ 80 with EC-6/7/8/9 JSDoc; `src/llms/openai.ts` ≤ 110 with EC-6/7/8/9/10 JSDoc)
- [ ] **EC-1 absorption:** demo-wide pre-flight grep returned 1 path BEFORE T3.1 (plan claim verified) OR all surfaced importers updated atomically
- [ ] **EC-2 absorption:** smoke tests at `src/{embedders,llms}/__tests__/openai.test.ts` DO NOT call `.embed()`/`.embedBatch()`/`.generateChat()`/`.generateResponse()` (explicit JSDoc warning per file)
- [ ] **EC-3 absorption:** `src/__tests__/no-root-reexport.test.ts` extended with `expect(root.OpenAIEmbedder).toBeUndefined()` + `expect(root.OpenAILLM).toBeUndefined()`
- [ ] **EC-4 absorption:** T1.2 pre-flight gate verified `src/core/dip/llm.ts:LLM.generateResponse` has `tools?` 3rd param BEFORE GREEN
- [ ] **EC-5/6/7/8/9/10 absorption:** JSDoc notes per the absorption matrix above present in `src/embedders/openai.ts` + `src/llms/openai.ts`
- [ ] DIP boundaries preserved (no `src/core/` → `src/local|cloud/` reverse imports)
- [ ] Pushed to origin/develop
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/` AFTER /review READY_TO_MERGE + PR merged

## Final Phase: Integration Validation (T4.1)

`npm test && npm run typecheck && npm run lint && npm run build && (cd examples/chat-with-memory && npm run build) && npm pack --dry-run --json | grep -cE '(src/(embedders|llms)/openai\.ts)' === 2 && grep -cE 'OpenAIEmbedder|OpenAILLM|adapters-cycle-2' CHANGELOG.md >= 2` returns exit 0.

Re-run of `/review adapters-openai-cycle-2` OPTIONAL if BLOCKER=0 + zero new architectural change; mandatory otherwise.
