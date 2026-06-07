# Plan: v0-9-vendor-client-impls — concrete `Mem0OfficialClient` + `ZepOfficialClient` + `LettaOfficialClient` for benchmark adapters

> **Version 1.1** (2026-06-07) — Absorbs 14 edge cases from `/edge-case-plan` review at [`.claude/knowledge-base/reviews/v0-9-vendor-client-impls-edge-cases-2026-06-07.md`](../reviews/v0-9-vendor-client-impls-edge-cases-2026-06-07.md) (3 MUST FIX + 8 SHOULD TEST + 3 DOCUMENT). Key absorptions: EC-1 ADR D1 § Decision corrected to acknowledge 3 distinct pre-existing parameter names (`userId` / `sessionId` / `agentId`) → uniform `scopeKey`. EC-2 typed error `VendorSynthesizeUnsupportedError` added to `src/core/errors.ts` (new T0.3 task) — replaces `Error` generic per Inquebrável Rule 8. EC-3 Mem0 v3 response field corrected to `memory` (NOT `text`) — Sub-goal 1 maps `{ text: r.memory, score: r.score }`. EC-7 bundle isolation regression check added to `tests/integration/public-paths.test.ts`. EC-13 CHANGELOG `BREAKING:` prefix for semver bump. Grounded in blueprint [`v0-8-vendor-cells-mem0-zep-letta-blueprint.md`](../discoveries/blueprints/v0-8-vendor-cells-mem0-zep-letta-blueprint.md) (SHIPPABLE_WITH_CAVEATS 70/100; 14 verified citations; 6 actionable recommendations). Closes the second-half blocker of Roadmap Item 11 (production-ready label). The `BenchmarkAdapter` DIP + 3 vendor adapter shells with `VendorClient` interface seams shipped via Drift-T6.x-1 (2026-06-02); this plan ships the concrete `*OfficialClient` impl classes wrapping each vendor's official npm SDK. Per `/dogfood` already cleared on 2026-06-07 (commit `7000147`), this plan is the parallel-half unblock. PRIORITY 0 sub-goal 2 (SDKs functional) hardening per CLAUDE.md — NOT a new feature; closes a documented Drift-T6.x-1 deferral.

## Goal

> "Ship `Mem0OfficialClient`, `ZepOfficialClient`, `LettaOfficialClient` classes implementing `Mem0VendorClient` / `ZepVendorClient` / `LettaVendorClient` interfaces respectively, by composing the official `mem0ai@^3.0.6`, `@getzep/zep-cloud@^3.23.0`, `@letta-ai/letta-client@^1.12.1` npm SDKs, so that `tests/integration/benchmarks/vendor-{mem0,zep,letta}.test.ts` round-trips 1 add + 1 search per vendor against real SaaS APIs gated by `{MEM0,ZEP,LETTA}_API_KEY` env vars, measured by all 3 integration tests passing GREEN (or skipping cleanly without keys) AND the existing `BenchmarkAdapter` contract tests at `src/benchmarks/{mem0,zep,letta}/__tests__/adapter.test.ts` continuing to pass unchanged."

## Context

### What shipped before this plan

- `BenchmarkAdapter` DIP at `src/core/dip/benchmark-adapter.ts` (ADR D5+D6 of v0.8 plan; 10th DIP)
- 3 vendor adapter shells at `src/benchmarks/{mem0,zep,letta}/adapter.ts` — each declares its own `VendorClient` interface (`Mem0VendorClient`, `ZepVendorClient`, `LettaVendorClient`) consumed via DI
- v0.8 GOAL TEST: smoke-validated TheMemory cells only; vendor cells DEFERRED per Drift-T6.x-1
- `/dogfood` gate cleared on 2026-06-07 (`7000147`): S1 anchor scenario `running`, EVIDENCE_SUFFICIENT — first half of Roadmap Item 11 unblocked

### What this plan adds

| Surface | New / Modified | Notes |
|---|---|---|
| `src/benchmarks/mem0/vendor-client.ts` | NEW | `Mem0OfficialClient implements Mem0VendorClient` wrapping `mem0ai` SDK |
| `src/benchmarks/zep/vendor-client.ts` | NEW | `ZepOfficialClient implements ZepVendorClient` wrapping `@getzep/zep-cloud` (incl. session lifecycle) |
| `src/benchmarks/letta/vendor-client.ts` | NEW | `LettaOfficialClient implements LettaVendorClient` wrapping `@letta-ai/letta-client` (agent-scoped) |
| `src/benchmarks/{mem0,zep,letta}/adapter.ts` | MODIFIED | Each interface adopts `scopeKey: string` rename (ADR D1 — per-vendor pre-existing names `userId`/`sessionId`/`agentId` unified per EC-1) |
| `src/benchmarks/{mem0,zep,letta}/__tests__/adapter.test.ts` | MODIFIED | Stub clients updated to use renamed param |
| `src/benchmarks/{mem0,zep,letta}/__tests__/vendor-client.test.ts` | NEW | Unit tests for each OfficialClient — mock SDK + assert method delegation + edge tests EC-4/5/6/9/10/11 |
| `src/core/errors.ts` | MODIFIED | NEW `VendorSynthesizeUnsupportedError` typed class (per ADR D2 + EC-2 — replaces generic `Error` throw) |
| `tests/integration/benchmarks/_helpers.ts` | NEW | `describeMem0` / `describeZep` / `describeLetta` env-gate helpers per blueprint R4 + EC-8 vitest 4 `describe.skipIf` API verified |
| `tests/integration/benchmarks/vendor-{mem0,zep,letta}.test.ts` | NEW | 1 add + 1 search round-trip per vendor against real SaaS (gated) |
| `tests/integration/public-paths.test.ts` | MODIFIED | EC-7 bundle isolation regression — assert default barrel does NOT pull `Mem0OfficialClient`/`ZepOfficialClient`/`LettaOfficialClient` (~5-15MB transitive) |
| `package.json#dependencies` | MODIFIED | Add `mem0ai@^3.0.6` + `@getzep/zep-cloud@^3.23.0` + `@letta-ai/letta-client@^1.12.1` |
| `package.json#optionalDependencies` (CONSIDER) | proposal | These are HEAVY transitively; consider optionalDependencies + dynamic-import pattern (precedent: `@usetheo/memory/cache-pg` per EC-26 bundle isolation from semantic-recall-cache cycle) |
| `CHANGELOG.md` `[Unreleased]` | MODIFIED | Entry in `Changed` with `BREAKING:` prefix (per EC-13 — `cycle-release.md § Bump-level derivation` mandates BREAKING prefix for major bump; rename is breaking but pre-release per CLAUDE.md Status so no consumer impact) |

## Objective

- [ ] Sub-goal 1 (Mem0): `Mem0OfficialClient.add(scopeKey, text)` calls `client.add(text, { user_id: scopeKey, infer: true })`; `.search(scopeKey, query, topK)` calls `client.search(query, { user_id: scopeKey, top_k: topK })` and maps result to `{ text: r.memory, score: r.score }[]` (**EC-3**: mem0-ts v3.0.6 response field is `memory` — verified via `.claude/knowledge-base/references/mem0/mem0-ts/src/client/mem0.types.ts:89` + `tests/helpers.ts:67` — NOT `text`. Empty SDK result `[]` → `[]` propagated upstream)
- [ ] Sub-goal 2 (Zep): `ZepOfficialClient.add(scopeKey, text)` idempotently ensures session lifecycle (user.add + memory.addSession) then `client.memory.add(sessionId, { messages: [Message{role,roleType,content}] })`; `.search()` uses `client.graph.search` per blueprint R2
- [ ] Sub-goal 3 (Letta): `LettaOfficialClient(agentId).add(scopeKey, text)` calls `client.agents.archivalMemory.insertArchivalMemoryAsync(agentId, { text })`; `.search()` calls `searchArchivalMemory(agentId, { query, limit: topK })`. Scope-key rename to allow `agentId` (per blueprint R5)
- [ ] Sub-goal 4 (interface rename): `VendorClient.{add,search}(scopeKey: string, ...)` — `userId` → `scopeKey` across 3 interfaces + adapter call sites + tests
- [ ] Sub-goal 5 (synthesize delegation): All 3 OfficialClients throw `new VendorSynthesizeUnsupportedError(<vendor>)` (typed class added to `src/core/errors.ts` per T0.3 — per **EC-2** + ADR D2, NOT generic `Error`). Adapter code path for `synthesize` updated to consult shared `LLM` DIP instead of vendor client (per blueprint R3)
- [ ] Sub-goal 6 (integration tests): 3 NEW test files at `tests/integration/benchmarks/vendor-{mem0,zep,letta}.test.ts`; each runs `describeMem0/Zep/Letta` gate; on key present, performs 1 add + 1 search + asserts non-empty result; on key absent, skips cleanly
- [ ] Sub-goal 7 (CI workflow): NEW `.github/workflows/vendor-benchmarks.yml` with `schedule: '0 6 * * *'` + `workflow_dispatch` triggers; reads `MEM0_API_KEY` + `ZEP_API_KEY` + `LETTA_API_KEY` from repo secrets

If sub-goals 1-7 are all checked AND test suite shows `vitest run tests/integration/benchmarks/` outputs `3 SKIPPED` (without keys) OR `3 PASSED` (with keys), the cycle is COMPLETE.

## ADRs

### D1 — `VendorClient` interface rename: per-vendor parameter names → uniform `scopeKey`

- **Decision:** All 3 vendor interfaces rename the first `add()` + `search()` parameter to uniform `scopeKey: string`. **Per-vendor pre-existing names differ** (empirically verified in `src/benchmarks/{mem0,zep,letta}/adapter.ts` at plan-write time — per EC-1 correction of v1.0):
  - `Mem0VendorClient.add(userId, ...)` — current parameter `userId` → `scopeKey`
  - `ZepVendorClient.add(sessionId, ...)` — current parameter `sessionId` → `scopeKey`
  - `LettaVendorClient.add(agentId, ...)` — current parameter `agentId` → `scopeKey`

  Each vendor's OfficialClient interprets the scopeKey per its own scope model: Mem0 = `user_id` in SDK call, Zep = `session_id`, Letta = `agent_id`. T0.2 GREEN must rename **all 3 distinct names**, NOT just `userId` (literal grep-replace of `userId` alone would leave Zep + Letta inconsistent).
- **Rationale:** Per blueprint R5 (Q5 finding), Letta's memory is AGENT-scoped (not user-scoped) AND Zep's is SESSION-scoped. The current 3-different-names state already honors the per-vendor scope model BUT prevents adapter-level abstraction (each call site must remember which vendor → which name). Unified `scopeKey` at interface level + per-vendor internal mapping at OfficialClient level is Inquebrável Rule 3 honest AND DRY at adapter call sites.
- **Consequences:** Breaking change for any external caller of the 3 vendor interfaces — but per CLAUDE.md `Status: Pre-release`, no external consumer relies on the v0.8 vendor interfaces (Drift-T6.x-1 explicitly says "Real SDK wiring deferred"; the interfaces shipped as DIP-seam-only with no production callers). Internal callers: only the existing `Mem0BenchmarkAdapter` / `ZepBenchmarkAdapter` / `LettaBenchmarkAdapter` constructors — updated in same commit.
- **Alternatives:**
  - Keep `userId` and document the lie in JSDoc — REJECTED (type-level honesty trumps backwards-compat for pre-release interfaces).
  - Add a per-vendor `scopeAdapter` callback — REJECTED (over-engineering for 3 known impls).

### D2 — `synthesize()` delegates to shared LLM DIP via typed error throw

- **Decision (revised per EC-2):** All 3 OfficialClients throw `new VendorSynthesizeUnsupportedError(<vendor>)` (typed class added to `src/core/errors.ts` per T0.3) for `synthesize()`. The adapter's `synthesize()` path is rewired to consult the shared `LLM` DIP (passed via adapter config) instead of vendor client. **NOT** generic `throw new Error('string message')` — that violates Inquebrável Rule 8 (Error Handling — typed errors mandate) and forces callers to parse `error.message` strings.
- **Rationale:** Per blueprint R3 (Q3 finding), none of the 3 vendor SDKs (`mem0ai`, `@getzep/zep-cloud`, `@letta-ai/letta-client`) expose a synthesize primitive — they're memory APIs, not completion APIs. Forcing vendor SDKs to also synthesize would either (a) require vendor-specific completion calls (unfair comparison since each vendor's "preferred" LLM differs) OR (b) reach for an unrelated LLM API (per-vendor different). Single shared LLM across all 4 adapters (TheMemory + 3 vendors) is the fair benchmark methodology per v0.8 plan's ADR-D8-equivalent (see `.claude/knowledge-base/plans/completed/v0-8-independent-benchmark-reproduction-plan.md`). Typed error class enables `catch (e instanceof VendorSynthesizeUnsupportedError)` fallback discrimination without string parsing.
- **Consequences:** `BenchmarkAdapter.synthesize()` impl in `src/benchmarks/{vendor}/adapter.ts` updated to consume the shared LLM. The existing TheMemory adapter already uses LLM DIP — no change there.
- **Alternatives:**
  - Per-vendor completion endpoint (Mem0 cloud has `/v1/chat`) — REJECTED (apples-to-oranges benchmark; vendor's hosted LLM ≠ ours).
  - Vendor-agnostic completion (use openrouter for all 4) — REJECTED (already shipped per v0.8 plan's ADR-D8-equivalent (see `.claude/knowledge-base/plans/completed/v0-8-independent-benchmark-reproduction-plan.md`); D2 just makes the delegation explicit).

### D3 — OfficialClient locus: `src/benchmarks/{vendor}/vendor-client.ts` (sibling of `adapter.ts`)

- **Decision:** Each OfficialClient ships as a separate file `src/benchmarks/{vendor}/vendor-client.ts` (NOT embedded in `adapter.ts`).
- **Rationale:** Same DIP separation as the parent cycle (v0.8 ADR D5 — `src/benchmarks/{vendor}/`). Adapter consumes VendorClient via DI; OfficialClient is one implementation. Tests can substitute mock implementations cleanly. Mirrors the pattern of `src/server/auth/oidc-introspect-oauth4webapi.ts` (separate file from `oidc-verifier.ts`) shipped in fixes-cycle-1.
- **Consequences:** 3 new files (~80-120 LoC each). Adapter file unchanged in size.
- **Alternatives:**
  - Embed in `adapter.ts` — REJECTED (couples DIP interface to SDK; mock substitution becomes harder).
  - Single shared file `src/benchmarks/vendor-clients.ts` — REJECTED (cross-vendor coupling; per-vendor evolution would touch shared file).

### D4 — Integration test gating: env-var presence (no fallback)

- **Decision:** `tests/integration/benchmarks/vendor-{mem0,zep,letta}.test.ts` use `describeMem0/Zep/Letta = API_KEY ? describe : describe.skip` per blueprint R4. Tests skip cleanly when env vars absent; NO fallback to "fake" SaaS.
- **Rationale:** Per `testing.md § Pyramid`, integration tests against real boundaries are canonical. Vitest equivalent of jest's `describe.skip` is supported via `describe.skipIf(!process.env.X)` (vitest 0.34+). Skipping cleanly preserves CI-without-secrets viability for forks.
- **Consequences:** Local-dev requires operator to set env vars + accept potential API quota burn. Per Inquebrável Rule 3, README adds "running vendor benchmark integration tests will consume paid API quota" disclosure.
- **Alternatives:**
  - Recorded HTTP fixtures (nock / msw) — REJECTED for round-trip integration validity (fixtures drift; defeat the "validate against real SaaS" purpose).
  - Mock at SDK level — already done for unit tests at `src/benchmarks/{vendor}/__tests__/vendor-client.test.ts` (NEW per Sub-goal 6).

### D5 — `optionalDependencies` shape: deferred to v1.0-cleanup cycle

- **Decision:** Ship the 3 npm packages as `dependencies` (NOT `optionalDependencies`) in v0.9. Defer optimization to a follow-up `v1.0-cleanup` cycle that audits bundle impact + adopts `optionalDependencies` + dynamic-import pattern per EC-26 precedent (`@usetheo/memory/cache-pg` bundle isolation).
- **Rationale:** Per `/deps-audit` Inquebrável Rule 9, prefer canonical defaults; optionalDependencies require dynamic-import discipline + per-consumer install-time choice. Adds complexity without v0.9 customer benefit. Bundle size impact (~3 vendor SDKs ≈ 5-15MB transitive) is acceptable for a benchmark-only path (not consumed in production hot path). Document the deferral; revisit at v1.0 contract freeze.
- **Consequences:** Default `npm install @usetheo/memory` ships 3 vendor SDKs as transitive deps. Operators who never run benchmarks pay the install-size cost. Acceptable for pre-release; flag for v1.0 audit.
- **Alternatives:**
  - Ship as optionalDependencies + dynamic-import — REJECTED for v0.9 (premature complexity). DEFERRED to v1.0-cleanup.
  - Ship as peerDependencies — REJECTED (forces every consumer to manage vendor versions; defeats Inquebrável Rule 9 "use canonical defaults").

## Dependency Graph

```
T0.1 (RED tests interface rename) ──▶ T0.2 (GREEN rename — Mem0 userId / Zep sessionId / Letta agentId → scopeKey per ADR D1 EC-1)
                                            │
                                            ▼
                                       T0.3 (NEW VendorSynthesizeUnsupportedError in src/core/errors.ts per ADR D2 EC-2)
                                            │
                                            ▼
T1.1 (RED Mem0 vendor-client.ts) ──▶ T1.2 (GREEN Mem0OfficialClient — maps r.memory to text per EC-3)
                                            │
                                            ▼
T2.1 (RED Zep vendor-client.ts) ──▶ T2.2 (GREEN ZepOfficialClient incl. session lifecycle)
                                            │
                                            ▼
T3.1 (RED Letta vendor-client.ts) ──▶ T3.2 (GREEN LettaOfficialClient agent-scoped)
                                            │
                                            ▼
                                       T4.1 (RED integration tests with describe.skipIf)
                                            │
                                            ▼
                                       T4.2 (GREEN integration tests + 3 round-trip scenarios)
                                            │
                                            ▼
                                       T5.1 (NEW CI workflow vendor-benchmarks.yml)
```

T0 (interface rename) is foundational; T1-T3 (per-vendor impls) can parallelize after T0; T4 (integration) gates all 3 impls; T5 (CI) is post-merge optional but recommended.

---

## Phases

### Phase 0: Interface rename + typed error (foundation)

**Objective:** Rename the 3 distinct vendor parameter names (`userId` Mem0 / `sessionId` Zep / `agentId` Letta — verified empirically at plan-write time) → uniform `scopeKey: string` per ADR D1 across all 3 interfaces + their adapter call sites + tests. Add typed error class for synthesize-unsupported throw per ADR D2.

#### T0.1 RED — sentinel tests for rename (3-name awareness)
Files: existing `src/benchmarks/{mem0,zep,letta}/__tests__/adapter.test.ts`. Update existing test mock stub signatures:
- Mem0 stub: `userId` → `scopeKey` parameter name
- Zep stub: `sessionId` → `scopeKey`
- Letta stub: `agentId` → `scopeKey`

Confirm tests FAIL pre-rename (TS compile error on each interface mismatch — 3 distinct failure paths, NOT a single grep-replace of `userId`).

#### T0.2 GREEN — rename across 3 interfaces + 3 adapters
Edit `src/benchmarks/{mem0,zep,letta}/adapter.ts` interfaces — `userId`/`sessionId`/`agentId` → `scopeKey` — + their internal call sites where adapter forwards the param to `this.client.add(...)` / `this.client.search(...)`. Internal mapping back to vendor-specific name happens at OfficialClient layer (T1.2/T2.2/T3.2). Recompile + tests pass.

#### T0.3 NEW — typed error class `VendorSynthesizeUnsupportedError` (per ADR D2 EC-2)
File: `src/core/errors.ts` (modify).
Add:
```ts
export class VendorSynthesizeUnsupportedError extends Error {
  constructor(vendor: 'mem0' | 'zep' | 'letta') {
    super(`synthesize not supported by ${vendor} SDK; caller must delegate to LLM DIP`);
    this.name = 'VendorSynthesizeUnsupportedError';
  }
}
```
TDD: write failing unit test in `src/core/__tests__/errors.test.ts` asserting `new VendorSynthesizeUnsupportedError('mem0').name === 'VendorSynthesizeUnsupportedError'` AND `instanceof Error === true`. GREEN: implement class. Required by Phase 1-3 throws.

### Phase 1-3: Per-vendor OfficialClient impls

For each vendor V in {mem0, zep, letta}:

#### T<V>.1 RED — vendor-client.ts contract tests
NEW file `src/benchmarks/<V>/__tests__/vendor-client.test.ts`. Tests with mock SDK asserting:

**Baseline (3-5 tests each):**
1. Method delegation — `add()` calls SDK with scopeKey mapped to vendor-specific param name
2. Scope mapping — verify mapping (Mem0: `{ user_id: scopeKey, ... }`, Zep: session, Letta: agent)
3. `synthesize()` throws `VendorSynthesizeUnsupportedError(<vendor>)` (typed, NOT generic `Error`) per ADR D2 EC-2

**Edge tests (per EC-4 through EC-11 absorbed inline):**

| EC | Vendor | Test name | Assertion |
|---|---|---|---|
| EC-3 | Mem0 | `test_mem0_search_maps_memory_field_to_text` | stub SDK returns `[{ memory: 'hello', score: 0.9 }]` → result `[{ text: 'hello', score: 0.9 }]` |
| EC-4 | Zep | `test_zep_add_handles_existing_session_409_idempotently` | 2nd `add('s', 'm2')` succeeds when SDK stub throws 409 on `memory.addSession` — try/catch + ignore 409 pattern |
| EC-5 | Letta | `test_letta_search_handles_passage_without_score_field` | stub returns Passage with no score → result has fallback score (`1.0 / (rank + 1)` OR constant `0.5` — implementer choice, document) |
| EC-6 | all 3 | `test_<V>_search_returns_empty_array_when_no_matches` | stub SDK returns `[]` → result `[]` (not null, not undefined, not throw) |
| EC-9 | Letta | `test_letta_add_propagates_404_when_agent_missing` | stub SDK throws 404 → wrapped in error with vendor-identifiable message; caller can distinguish "vendor error" vs "scope-key invalid" |
| EC-10 | all 3 | `test_<V>_official_client_constructor_di_pattern` | constructor receives pre-constructed SDK (DI pattern — mirror `LocalTransformerEmbedder` precedent), NOT api-key string. Documented in T<V>.2 JSDoc |
| EC-11 | Zep | `test_zep_concurrent_add_same_session_no_data_loss` | `Promise.all([add('s', 'm1'), add('s', 'm2')])` → both messages persist; race on session lifecycle handled via 409 ignore (EC-4) |

#### T<V>.2 GREEN — implement OfficialClient
NEW file `src/benchmarks/<V>/vendor-client.ts`. Class implements `<V>VendorClient` wrapping the official SDK per blueprint § Q3/Q5 recommendations. Constructor pattern: DI of pre-constructed SDK (EC-10), NOT api-key string.

Per-vendor specifics:
- **Mem0**: straightforward 1:1 mapping. `add → client.add(text, { user_id: scopeKey, infer: true })`. **search result mapping `{ text: r.memory, score: r.score }` per EC-3** (mem0-ts v3 field name). ~50 LoC.
- **Zep**: requires idempotent session lifecycle (user.add + memory.addSession before memory.add). Idempotency via try/catch + ignore 409 (EC-4). ~100 LoC; use `client.graph.search` per blueprint R2.
- **Letta**: scopeKey is agentId; uses `client.agents.archivalMemory.{insertArchivalMemoryAsync, searchArchivalMemory}`. Passage score fallback per EC-5; 404 propagation per EC-9. ~80 LoC.

### Phase 4: Integration tests

#### T4.1 RED — describe.skipIf helpers + 3 vendor integration test files
**Pre-flight (EC-8):** verify `describe.skipIf` API available in vitest 4 (`package.json` shows `^4.0.0`; major bump may have changed APIs even though `describe.skipIf` is stable since 0.34). 30s check: `npx vitest --version` + spot-check vitest 4 docs OR write a 3-line smoke test asserting `describe.skipIf(false)` exists. If absent, fall back to `const describeMem0 = process.env.MEM0_API_KEY ? describe : describe.skip` ternary pattern (works in any vitest ≥ 0.x). Either way the test gate semantic is preserved.

NEW `tests/integration/benchmarks/_helpers.ts` exports `describeMem0/Zep/Letta` per chosen API. NEW 3 test files each calling 1 add + 1 search round-trip.

Phase 4 also includes **EC-7 bundle isolation regression**: extend `tests/integration/public-paths.test.ts` with new test asserting `import * as Mem from '@usetheo/memory'` does NOT pull `mem0ai` / `@getzep/zep-cloud` / `@letta-ai/letta-client` (~5-15MB transitive). Mirror the existing `cache-pg` bundle isolation pattern (EC-26 precedent from semantic-recall-cache cycle).

#### T4.2 GREEN — confirm tests skip cleanly without keys + pass with keys
Run `vitest run tests/integration/benchmarks/` without env: expect `3 SKIPPED`. With env: expect `3 PASSED` (paid quota burn — manual local). Bundle isolation test (added per EC-7): always-run, must PASS.

### Phase 5: CI workflow

#### T5.1 NEW — vendor-benchmarks.yml
NEW `.github/workflows/vendor-benchmarks.yml`: `schedule: '0 6 * * *'` + `workflow_dispatch`. Reads `MEM0_API_KEY` + `ZEP_API_KEY` + `LETTA_API_KEY` from repo secrets. Runs `vitest run tests/integration/benchmarks/`.

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Drift-T6.x-1: Mem0/Zep/Letta vendor cells deferred — vendor SDK wiring missing | T1.2 + T2.2 + T3.2 | 3 OfficialClient classes wrap official SDKs |
| 2 | Roadmap Item 11 production-ready blocked by independent benchmark reproduction | T1.2 + T2.2 + T3.2 + T4.2 + T5.1 | Vendor cells become genuinely executable on CI cron |
| 3 | Blueprint R1: 3 npm packages need declaring | package.json dep update + T1.2/T2.2/T3.2 imports | mem0ai^3.0.6, @getzep/zep-cloud^3.23.0, @letta-ai/letta-client^1.12.1 |
| 4 | Blueprint R2: Zep session lifecycle pre-add (+ EC-4 idempotency on 409) | T2.2 | ZepOfficialClient.add() idempotent user.add + memory.addSession via try/catch + ignore 409 |
| 5 | Blueprint R3: synthesize delegation to LLM DIP via typed error (EC-2) | T0.3 + 3× T<V>.2 | `VendorSynthesizeUnsupportedError` typed class; adapter consults LLM DIP (ADR D2) |
| 6 | Blueprint R4: describe.skipIf env-gate canonical (+ EC-8 vitest 4 verification) | T4.1 _helpers.ts | describeMem0/Zep/Letta helpers; pre-flight API check |
| 7 | Blueprint R5: scope-key rename for per-vendor name unification (EC-1 corrected scope) | T0.1 + T0.2 (ADR D1) | userId/sessionId/agentId → scopeKey across 3 interfaces |
| 8 | Blueprint R6: CI gating cron+manual+secrets | T5.1 | vendor-benchmarks.yml |
| 9 | Per testing.md, integration tests against real boundary required | T4.1 + T4.2 | 3 integration tests gated by env vars |
| 10 | Per Inquebrável Rule 6, CHANGELOG.md update with `BREAKING:` prefix (EC-13) | post-T5.1 | `[Unreleased] § Changed` with `BREAKING: rename Vendor*Client scope param ...` |
| 11 | **EC-3** Mem0 v3 response field mapping (`memory` NOT `text`) | T1.1 RED + T1.2 GREEN | `{ text: r.memory, score: r.score }` mapping + dedicated test |
| 12 | **EC-7** Bundle isolation regression (3 new heavy deps) | T4.1 + `tests/integration/public-paths.test.ts` MODIFIED | Assert default barrel does NOT pull 3 vendor SDKs |
| 13 | **EC-5/9** Letta passage-shape + 404 propagation | T3.1 + T3.2 | Score fallback for passages without score; 404 wrapped with vendor-identifiable msg |
| 14 | **EC-6** Empty results `[]` propagation | T1.1 + T2.1 + T3.1 | Explicit per-vendor test |
| 15 | **EC-10** SDK constructor DI pattern (uniform across 3) | T1.1 + T2.1 + T3.1 | DI of pre-constructed SDK (NOT api-key string); JSDoc documents |
| 16 | **EC-11** Concurrent add race (Zep especially) | T2.1 | `Promise.all([add('s', 'm1'), add('s', 'm2')])` test |

**Coverage: 16/16 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed (T0.1+T0.2+T0.3, T1.1+T1.2, T2.1+T2.2, T3.1+T3.2, T4.1+T4.2, T5.1)
- [ ] `npm test`: 1169+ PASS (3 vendor-client unit-test files × ~7-10 tests = +21-30 minimum, includes EC-3/4/5/6/9/10/11 edge tests) + no regression
- [ ] `npm run typecheck`: 0 errors
- [ ] `npm run lint`: 0 warnings
- [ ] `vitest run tests/integration/benchmarks/`: `3 SKIPPED` without env OR `3 PASSED` with env
- [ ] `tests/integration/public-paths.test.ts`: extended assertion passes — default barrel does NOT pull 3 vendor SDKs (EC-7)
- [ ] `src/core/__tests__/errors.test.ts`: `VendorSynthesizeUnsupportedError` test PASSES (EC-2/T0.3)
- [ ] File-size budget: each `vendor-client.ts` ≤ 200 LoC (per architecture.md)
- [ ] CHANGELOG.md `[Unreleased] § Changed` updated with `BREAKING: rename Vendor*Client scope param ({userId,sessionId,agentId}) → scopeKey (no production consumers per Drift-T6.x-1)` per Inquebrável Rule 6 + EC-13 (semver bump determinism per `cycle-release.md`)
- [ ] Backward compatibility: existing TheMemory benchmark cells continue to pass at original goal-metric (`docs/benchmarks/v0.8.md`)
- [ ] **Runtime-metric proof**: N/A (this cycle wires vendor-side adapters; no new TheMemory counters declared)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND PR merged, move to `.claude/knowledge-base/plans/completed/`

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (no existing dep changes; all 3 new) | | | |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| mem0ai (NEW) | ^3.0.6 | npm | Evaluated: official Mem0 SDK per `mem0/mem0-ts/package.json` verified; NO alternative (this IS Mem0's canonical TS client). | Canonical |
| @getzep/zep-cloud (NEW) | ^3.23.0 | npm | Evaluated: official Zep SDK per blueprint Q1 npm view; NO alternative (Mem0's own evaluation/src/zep/ uses zep_cloud Python — TS counterpart is canonical). | Canonical |
| @letta-ai/letta-client (NEW) | ^1.12.1 | npm | Evaluated: official Letta TS SDK per blueprint Q1 npm view; alternative considered = hand-rolled REST wrap (ADR D4 of discovery plan — contingency). Rejected because TS SDK exists at canonical version 1.12.1. | Canonical |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Final Phase: Integration Validation (MANDATORY)

Per `cycle-implement.md`, post-implementation gate:

```
npm test                        # contract suite — must remain ≥ 1169 PASS + 15 new vendor-client tests
npm run typecheck               # zero TS errors
npm run lint                    # zero lint warnings
vitest run tests/integration/benchmarks/   # 3 SKIPPED or 3 PASSED
```

### If validation fails

1. Identify whether failures are caused by this plan's changes vs pre-existing
2. Fix plan-caused failures before declaring complete
3. Pre-existing issues documented + non-blocking (per parent cycle precedent — `tests/unit/examples/server-routes-contract.test.ts` mockCtx fix shipped in PR #32 closed those; ZERO known unrelated failures remain at plan-write time)

## Accepted Risks (per EC-12, EC-14)

| # | Risk | Mitigation | Rationale |
|---|---|---|---|
| EC-12 | **API quota burn** — cron `0 6 * * *` × 30 days × 3 vendors × ~5 calls each = ~450 SaaS API calls/month. Mem0/Zep/Letta free tiers may silently 429 mid-month. | None at v0.9. Operator monitors billing. ADR D4 § Consequences disclosure. | Operational not technical. README adds disclosure per ADR D4. Premature CI throttling = over-engineering. |
| EC-14 | **Fork PRs skip vendor benchmark validation** — secrets unavailable by GitHub design; vendor-benchmarks.yml uses `schedule + workflow_dispatch` only (NOT `pull_request`) per T5.1 design. | CONTRIBUTING.md note: "vendor benchmark tests run on main via cron; fork PRs do not validate vendor cells." | Per blueprint Q6, Letta's `pull_request_target` + `safe to test` label pattern is the canonical fix but out-of-scope for v0.9. Track as follow-up cycle (post-v1.0). |
| Mem0-ts response shape drift between SDK versions | None at v0.9. EC-3 test pins current v3.0.6 behavior; SDK major bump would surface as failed integration test on cron. | Acceptable — SDK pinned via `^3.0.6` caret allows minor bump risk. Major bump (`mem0ai@4.x`) requires explicit plan update. |
| Per-vendor billing model differences | None at v0.9. Each vendor's cost differs. | Operator's responsibility. Document in `docs/benchmarks/v0.9.md` (post-cycle). |

## Log of plan changes

| Version | Date | Change | Rationale |
|---|---|---|---|
| 1.0 | 2026-06-07 | Initial plan written from blueprint `v0-8-vendor-cells-mem0-zep-letta-blueprint.md` (SHIPPABLE_WITH_CAVEATS 70/100). | Grounds the v0.9 cycle in the blueprint's 6 recommendations. |
| 1.1 | 2026-06-07 | Absorbed 14 edge cases from `/edge-case-plan` review (`reviews/v0-9-vendor-client-impls-edge-cases-2026-06-07.md`): 3 MUST FIX inline (EC-1 ADR D1 § Decision corrected for 3 distinct pre-existing param names; EC-2 typed error class `VendorSynthesizeUnsupportedError` added via new T0.3 task in `src/core/errors.ts`; EC-3 Mem0 v3 response field `memory` mapped to `text` in Sub-goal 1). 8 SHOULD TEST inline as per-vendor T<V>.1 RED test entries (EC-4 Zep 409 idempotency, EC-5 Letta passage-without-score fallback, EC-6 empty results, EC-7 bundle isolation regression at `public-paths.test.ts`, EC-8 vitest 4 `describe.skipIf` pre-flight, EC-9 Letta 404 propagation, EC-10 uniform DI constructor pattern, EC-11 concurrent add race). 3 DOCUMENT added to new "Accepted Risks" section (EC-12 API quota burn, EC-13 CHANGELOG `BREAKING:` prefix for semver bump, EC-14 fork PR secrets gap). Coverage Matrix expanded 10 → 16 rows. | Closes the 3 MUST FIX bugs-that-would-ship-silently (ADR-vs-reality misdescription, typed-error violation per Inquebrável Rule 8, Mem0 field-name mismatch) before `/deps-audit` + `/plan-confidence`. |
