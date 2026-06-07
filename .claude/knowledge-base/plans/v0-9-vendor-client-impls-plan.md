# Plan: v0-9-vendor-client-impls — concrete `Mem0OfficialClient` + `ZepOfficialClient` + `LettaOfficialClient` for benchmark adapters

> **Version 1.2** (2026-06-07) — Structural conformance pass: expanded T<V> placeholders into 6 concrete tasks (T1.1/T1.2 Mem0, T2.1/T2.2 Zep, T3.1/T3.2 Letta) + added `#### TDD` sub-section to every task (T0.1-T5.1) per `check_tdd_shape.py` gate convention shared with shipped plans (theo-memory-faang-auth-lifecycle, p0-api-sdk, voyager-skill-library). No semantic change — TDD info already existed in tables/prose; v1.2 formalizes as structured TDD blocks with concrete test fixtures (Given/When/Then with assertion APIs). Plan grows from 6 to 12 tasks total; Dependency Graph + Coverage Matrix updated accordingly. Re-validated via /plan-confidence post-bump.
>
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

### T0.1 — RED: sentinel tests for rename (3-name awareness)

**Files to edit:** `src/benchmarks/{mem0,zep,letta}/__tests__/adapter.test.ts` (existing).

#### TDD

```ts
// Given a stub Mem0VendorClient with the renamed parameter
class StubMem0Client implements Mem0VendorClient {
  add(scopeKey: string, text: string) { /* ... */ }
  search(scopeKey: string, query: string, topK: number) { /* ... */ }
  synthesize(question: string, context: string[]) { /* ... */ }
}
// When the existing adapter.test.ts contract test imports and runs
// Then TS compile fails with: "userId is not a property of Mem0VendorClient"
// (3 distinct failures — Mem0/Zep/Letta — confirming gate detects per-vendor)
```

RED criteria: `npm run typecheck` reports 3 distinct interface-mismatch errors (one per vendor stub). NOT a single grep-replace of `userId`.

### T0.2 — GREEN: rename across 3 interfaces + 3 adapters

**Files to edit:** `src/benchmarks/{mem0,zep,letta}/adapter.ts` (3 interfaces + internal call sites).

#### TDD

```ts
// Given the existing call site:
//   await this.client.add(userId, text);    // Mem0
//   await this.client.add(sessionId, text); // Zep
//   await this.client.add(agentId, text);   // Letta
// When renamed per scopeKey contract:
test_adapter_forwards_scopeKey_unchanged_to_client_add() {
  const stub = new StubMem0Client();
  const adapter = new Mem0BenchmarkAdapter({ client: stub });
  await adapter.add({ scopeKey: 'user-abc' }, 'text-1');
  expect(stub.lastAddArgs).toEqual(['user-abc', 'text-1']);  // forwarded unchanged
}
```

GREEN criteria: `npm run typecheck` 0 errors; all 3 adapter.test.ts contract tests PASS.

### T0.3 — NEW: typed error class `VendorSynthesizeUnsupportedError` (per ADR D2 EC-2)

**Files to edit:** `src/core/errors.ts` (modify); `src/core/__tests__/errors.test.ts` (modify).

#### TDD

```ts
test_VendorSynthesizeUnsupportedError_has_correct_name_and_inherits_Error() {
  // Given construction with vendor literal
  const err = new VendorSynthesizeUnsupportedError('mem0');
  // Then
  expect(err.name).toBe('VendorSynthesizeUnsupportedError');
  expect(err instanceof Error).toBe(true);
  expect(err.message).toContain('mem0');
  expect(err.message).toContain('LLM DIP');
}
```

GREEN: implement class per ADR D2:

```ts
export class VendorSynthesizeUnsupportedError extends Error {
  constructor(vendor: 'mem0' | 'zep' | 'letta') {
    super(`synthesize not supported by ${vendor} SDK; caller must delegate to LLM DIP`);
    this.name = 'VendorSynthesizeUnsupportedError';
  }
}
```

Required by Phase 1-3 throws (T1.2 + T2.2 + T3.2).

### Phase 1: Mem0 OfficialClient

### T1.1 — RED: Mem0OfficialClient contract + edge tests

**Files to edit:** `src/benchmarks/mem0/__tests__/vendor-client.test.ts` (NEW).

#### TDD

```ts
import { Mem0OfficialClient } from '../vendor-client.js';
import { VendorSynthesizeUnsupportedError } from '../../../core/errors.js';

class StubMem0Sdk {
  lastAddArgs: unknown[] = [];
  searchResult: unknown[] = [];
  add(text: string, opts: { user_id: string; infer: boolean }) {
    this.lastAddArgs = [text, opts]; return Promise.resolve({ id: 'x' });
  }
  search(query: string, opts: { user_id: string; top_k: number }) {
    return Promise.resolve(this.searchResult);
  }
}

test_mem0_add_delegates_to_sdk_with_user_id_mapping() {
  // Given Mem0OfficialClient with stub SDK
  const sdk = new StubMem0Sdk();
  const client = new Mem0OfficialClient(sdk as unknown as MemoryClient);
  // When add()
  await client.add('user-abc', 'I love sushi');
  // Then SDK received { user_id: 'user-abc', infer: true }
  expect(sdk.lastAddArgs).toEqual(['I love sushi', { user_id: 'user-abc', infer: true }]);
}

test_mem0_search_maps_memory_field_to_text_per_EC3() {
  // Given stub returns mem0-ts v3 shape with `memory` field (NOT `text`)
  const sdk = new StubMem0Sdk();
  sdk.searchResult = [{ id: 'm1', memory: 'hello world', score: 0.9 }];
  const client = new Mem0OfficialClient(sdk as unknown as MemoryClient);
  // When search()
  const results = await client.search('greeting', 'hi', 5);
  // Then result has text (mapped from memory) + score
  expect(results).toEqual([{ text: 'hello world', score: 0.9 }]);
}

test_mem0_search_returns_empty_array_when_no_matches_per_EC6() {
  const sdk = new StubMem0Sdk(); sdk.searchResult = [];
  const client = new Mem0OfficialClient(sdk as unknown as MemoryClient);
  expect(await client.search('x', 'y', 5)).toEqual([]);
}

test_mem0_synthesize_throws_typed_error_per_EC2() {
  const client = new Mem0OfficialClient(new StubMem0Sdk() as unknown as MemoryClient);
  expect(() => client.synthesize('q', ['ctx'])).toThrow(VendorSynthesizeUnsupportedError);
}

test_mem0_constructor_DI_pattern_per_EC10() {
  // Given pre-constructed SDK
  const sdk = new StubMem0Sdk();
  // When constructor accepts SDK (NOT api-key string)
  const client = new Mem0OfficialClient(sdk as unknown as MemoryClient);
  // Then no MEM0_API_KEY string passed at construction
  expect(client).toBeDefined();
}
```

RED: all 5 tests fail (module `'../vendor-client.js'` does not exist yet).

### T1.2 — GREEN: implement Mem0OfficialClient

**Files to edit:** `src/benchmarks/mem0/vendor-client.ts` (NEW); `package.json#dependencies` (add `mem0ai@^3.0.6`).

#### TDD

```ts
import type { MemoryClient } from 'mem0ai';
import { VendorSynthesizeUnsupportedError } from '../../core/errors.js';

export class Mem0OfficialClient implements Mem0VendorClient {
  constructor(private readonly sdk: MemoryClient) {}  // DI per EC-10

  async add(scopeKey: string, text: string): Promise<void> {
    await this.sdk.add(text, { user_id: scopeKey, infer: true });
  }
  async search(scopeKey: string, query: string, topK: number) {
    const raw = await this.sdk.search(query, { user_id: scopeKey, top_k: topK });
    return raw.map((r) => ({ text: r.memory, score: r.score }));  // EC-3 field mapping
  }
  synthesize(): never {
    throw new VendorSynthesizeUnsupportedError('mem0');
  }
}
```

**Validation:** Given the GREEN impl shipped, when `npx vitest run src/benchmarks/mem0/__tests__/vendor-client.test.ts` runs, then all 5 T1.1 RED tests transition to PASS (assert exit code 0; assertEquals failing_count 0). ~50 LoC; `npm run lint` 0 warnings; `npm run typecheck` 0 errors.

### Phase 2: Zep OfficialClient

### T2.1 — RED: ZepOfficialClient contract + idempotent session + concurrency

**Files to edit:** `src/benchmarks/zep/__tests__/vendor-client.test.ts` (NEW).

#### TDD

```ts
class StubZepSdk {
  sessionsCreated = new Set<string>();
  shouldThrow409 = false;
  graphSearchResult: unknown[] = [];
  user = { add: vi.fn().mockResolvedValue({}) };
  memory = {
    addSession: vi.fn().mockImplementation((opts: { sessionId: string }) => {
      if (this.shouldThrow409 && this.sessionsCreated.has(opts.sessionId)) {
        const err: any = new Error('Conflict'); err.statusCode = 409;
        return Promise.reject(err);
      }
      this.sessionsCreated.add(opts.sessionId);
      return Promise.resolve({});
    }),
    add: vi.fn().mockResolvedValue({}),
  };
  graph = { search: vi.fn().mockImplementation(() => Promise.resolve(this.graphSearchResult)) };
}

test_zep_add_handles_existing_session_409_idempotently_per_EC4() {
  // Given 2 sequential adds to same scopeKey, 2nd triggers 409
  const sdk = new StubZepSdk(); sdk.shouldThrow409 = true;
  const client = new ZepOfficialClient(sdk as unknown as ZepClient);
  // When
  await client.add('session-1', 'msg-1');
  await client.add('session-1', 'msg-2');  // session exists; 409 thrown
  // Then both messages persist; 2nd add does NOT throw
  expect(sdk.memory.add).toHaveBeenCalledTimes(2);
}

test_zep_concurrent_add_same_session_no_data_loss_per_EC11() {
  const sdk = new StubZepSdk(); sdk.shouldThrow409 = true;
  const client = new ZepOfficialClient(sdk as unknown as ZepClient);
  await Promise.all([client.add('s1', 'm1'), client.add('s1', 'm2')]);
  expect(sdk.memory.add).toHaveBeenCalledTimes(2);
}

test_zep_search_uses_graph_search_per_blueprint_R2() {
  const sdk = new StubZepSdk();
  sdk.graphSearchResult = [{ episode: { content: 'fact-1' }, score: 0.85 }];
  const client = new ZepOfficialClient(sdk as unknown as ZepClient);
  const results = await client.search('s1', 'q', 5);
  expect(sdk.graph.search).toHaveBeenCalled();
  expect(results[0].text).toBe('fact-1');
}

test_zep_search_empty_array_per_EC6() {
  const sdk = new StubZepSdk(); sdk.graphSearchResult = [];
  const client = new ZepOfficialClient(sdk as unknown as ZepClient);
  expect(await client.search('s1', 'q', 5)).toEqual([]);
}

test_zep_synthesize_throws_typed_error_per_EC2() {
  const client = new ZepOfficialClient(new StubZepSdk() as unknown as ZepClient);
  expect(() => client.synthesize('q', ['ctx'])).toThrow(VendorSynthesizeUnsupportedError);
}
```

RED: all 5 fail (module does not exist).

### T2.2 — GREEN: implement ZepOfficialClient with idempotent session lifecycle

**Files to edit:** `src/benchmarks/zep/vendor-client.ts` (NEW); `package.json#dependencies` (add `@getzep/zep-cloud@^3.23.0`).

#### TDD

```ts
import type { ZepClient } from '@getzep/zep-cloud';
import { VendorSynthesizeUnsupportedError } from '../../core/errors.js';

export class ZepOfficialClient implements ZepVendorClient {
  constructor(private readonly sdk: ZepClient) {}  // DI per EC-10

  async add(scopeKey: string, text: string): Promise<void> {
    try {
      await this.sdk.user.add({ userId: scopeKey });
    } catch (e: unknown) { if ((e as any)?.statusCode !== 409) throw e; }  // EC-4 idempotent
    try {
      await this.sdk.memory.addSession({ sessionId: scopeKey, userId: scopeKey });
    } catch (e: unknown) { if ((e as any)?.statusCode !== 409) throw e; }
    await this.sdk.memory.add(scopeKey, {
      messages: [{ role: 'user', roleType: 'user', content: text }],
    });
  }

  async search(scopeKey: string, query: string, topK: number) {
    const raw = await this.sdk.graph.search({ sessionId: scopeKey, query, limit: topK });
    return raw.map((r: any) => ({ text: r.episode?.content ?? r.fact ?? '', score: r.score ?? 0.5 }));
  }
  synthesize(): never { throw new VendorSynthesizeUnsupportedError('zep'); }
}
```

**Validation:** Given the GREEN impl shipped, when `npx vitest run src/benchmarks/zep/__tests__/vendor-client.test.ts` runs, then all 5 T2.1 RED tests transition to PASS (assertEquals failing_count 0). ~100 LoC.

### Phase 3: Letta OfficialClient

### T3.1 — RED: LettaOfficialClient contract + passage score fallback + 404

**Files to edit:** `src/benchmarks/letta/__tests__/vendor-client.test.ts` (NEW).

#### TDD

```ts
class StubLettaSdk {
  searchResult: unknown[] = [];
  shouldThrow404 = false;
  agents = {
    archivalMemory: {
      insertArchivalMemoryAsync: vi.fn().mockImplementation((agentId: string) => {
        if (this.shouldThrow404) {
          const err: any = new Error('Not Found'); err.statusCode = 404;
          return Promise.reject(err);
        }
        return Promise.resolve({});
      }),
      searchArchivalMemory: vi.fn().mockImplementation(() => Promise.resolve(this.searchResult)),
    },
  };
}

test_letta_add_delegates_with_agentId_mapping() {
  const sdk = new StubLettaSdk();
  const client = new LettaOfficialClient(sdk as unknown as LettaClient);
  await client.add('agent-xyz', 'fact-1');
  expect(sdk.agents.archivalMemory.insertArchivalMemoryAsync)
    .toHaveBeenCalledWith('agent-xyz', { text: 'fact-1' });
}

test_letta_add_propagates_404_when_agent_missing_per_EC9() {
  const sdk = new StubLettaSdk(); sdk.shouldThrow404 = true;
  const client = new LettaOfficialClient(sdk as unknown as LettaClient);
  await expect(client.add('nonexistent', 'x'))
    .rejects.toThrow(/letta/i);  // vendor-identifiable message
}

test_letta_search_handles_passage_without_score_field_per_EC5() {
  // Given Passage lacking explicit score
  const sdk = new StubLettaSdk();
  sdk.searchResult = [{ text: 'passage-1' }, { text: 'passage-2' }];
  const client = new LettaOfficialClient(sdk as unknown as LettaClient);
  // When search
  const results = await client.search('agent-x', 'q', 5);
  // Then fallback score 1.0 / (rank + 1) per implementer choice
  expect(results).toHaveLength(2);
  expect(results[0].score).toBeGreaterThan(results[1].score);  // rank-based decay
  expect(results[0].text).toBe('passage-1');
}

test_letta_search_empty_per_EC6() {
  const sdk = new StubLettaSdk(); sdk.searchResult = [];
  const client = new LettaOfficialClient(sdk as unknown as LettaClient);
  expect(await client.search('a', 'q', 5)).toEqual([]);
}

test_letta_synthesize_throws_typed_per_EC2() {
  const client = new LettaOfficialClient(new StubLettaSdk() as unknown as LettaClient);
  expect(() => client.synthesize('q', ['ctx'])).toThrow(VendorSynthesizeUnsupportedError);
}
```

RED: all 5 fail.

### T3.2 — GREEN: implement LettaOfficialClient agent-scoped

**Files to edit:** `src/benchmarks/letta/vendor-client.ts` (NEW); `package.json#dependencies` (add `@letta-ai/letta-client@^1.12.1`).

#### TDD

```ts
import type { LettaClient } from '@letta-ai/letta-client';
import { VendorSynthesizeUnsupportedError } from '../../core/errors.js';

export class LettaOfficialClient implements LettaVendorClient {
  constructor(private readonly sdk: LettaClient) {}  // DI per EC-10

  async add(scopeKey: string, text: string): Promise<void> {
    try {
      await this.sdk.agents.archivalMemory.insertArchivalMemoryAsync(scopeKey, { text });
    } catch (e: unknown) {
      // EC-9: wrap with vendor-identifiable msg so caller can distinguish
      const orig = e instanceof Error ? e.message : String(e);
      throw new Error(`letta add failed for agent ${scopeKey}: ${orig}`);
    }
  }

  async search(scopeKey: string, query: string, topK: number) {
    const raw = await this.sdk.agents.archivalMemory.searchArchivalMemory(scopeKey, { query, limit: topK });
    return raw.map((p: any, i: number) => ({
      text: p.text ?? '',
      score: p.score ?? 1.0 / (i + 1),  // EC-5 rank-based fallback
    }));
  }
  synthesize(): never { throw new VendorSynthesizeUnsupportedError('letta'); }
}
```

**Validation:** Given the GREEN impl shipped, when `npx vitest run src/benchmarks/letta/__tests__/vendor-client.test.ts` runs, then all 5 T3.1 RED tests transition to PASS (assertEquals failing_count 0). ~80 LoC.

### Phase 4: Integration tests

### T4.1 — RED: describe.skipIf helpers + 3 vendor integration test files + bundle isolation

**Files to edit:** `tests/integration/benchmarks/_helpers.ts` (NEW); `tests/integration/benchmarks/vendor-{mem0,zep,letta}.test.ts` (3 NEW); `tests/integration/public-paths.test.ts` (MODIFIED for EC-7).

**Pre-flight (EC-8):** `npx vitest --version` → confirm vitest 4.x; verify `describe.skipIf` API available (stable since 0.34, but vitest 4 had major bump). Fallback: `const describeX = process.env.X_API_KEY ? describe : describe.skip` ternary (works in any vitest ≥ 0.x).

#### TDD

```ts
// _helpers.ts
export const describeMem0 = process.env.MEM0_API_KEY ? describe : describe.skip;
export const describeZep = process.env.ZEP_API_KEY ? describe : describe.skip;
export const describeLetta = process.env.LETTA_API_KEY ? describe : describe.skip;

// vendor-mem0.test.ts
import { describeMem0 } from './_helpers.js';
describeMem0('Mem0 vendor round-trip (gated by MEM0_API_KEY)', () => {
  test_real_mem0_saas_round_trip_add_then_search() {
    // Given real MemoryClient + Mem0OfficialClient
    const sdk = new MemoryClient({ apiKey: process.env.MEM0_API_KEY! });
    const client = new Mem0OfficialClient(sdk);
    const scopeKey = `theomemory-v0-9-test-${Date.now()}`;
    // When
    await client.add(scopeKey, 'I prefer espresso over filter coffee');
    await sleep(2000);  // Mem0 indexes async
    const results = await client.search(scopeKey, 'coffee preferences', 5);
    // Then
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toMatch(/espresso|coffee/i);
  }
});

// tests/integration/public-paths.test.ts (modified per EC-7)
test_default_barrel_does_not_pull_vendor_sdks_per_EC7() {
  // Given import * from canonical entry point
  const mod = await import('@usetheo/memory');
  // Then vendor SDKs are NOT in the module graph
  // (assert via require.cache inspection OR bundle-analyzer check)
  expect(Object.keys(mod)).not.toContain('Mem0OfficialClient');
  expect(Object.keys(mod)).not.toContain('ZepOfficialClient');
  expect(Object.keys(mod)).not.toContain('LettaOfficialClient');
}
```

RED: 3 vendor integration tests + 1 bundle isolation test fail (helpers + clients do not exist yet).

### T4.2 — GREEN: confirm tests skip cleanly without keys + pass with keys

**Files to edit:** none beyond T4.1.

#### TDD

```bash
# Without env vars (CI fork PR / local-dev without keys)
$ unset MEM0_API_KEY ZEP_API_KEY LETTA_API_KEY
$ vitest run tests/integration/benchmarks/
# Expected: 3 tests SKIPPED, 0 FAILED
#           Plus bundle isolation test: 1 PASSED (always-run)

# With env vars (manual local OR cron CI on main)
$ export MEM0_API_KEY=mem0_xxx ZEP_API_KEY=zep_xxx LETTA_API_KEY=letta_xxx
$ vitest run tests/integration/benchmarks/
# Expected: 3 tests PASSED (real SaaS round-trips), 0 FAILED
```

**Validation:** Given env vars unsetted, when `vitest run tests/integration/benchmarks/` runs, then 3 tests SKIPPED + 1 bundle-isolation PASSED (assertEquals failing_count 0). Given env vars set, when same command runs, then 3 PASSED + 1 PASSED (assertEquals failing_count 0).

### Phase 5: CI workflow

### T5.1 — NEW: vendor-benchmarks.yml

**Files to edit:** `.github/workflows/vendor-benchmarks.yml` (NEW).

#### TDD

```yaml
# .github/workflows/vendor-benchmarks.yml — minimum viable shape
name: vendor-benchmarks
on:
  schedule:
    - cron: '0 6 * * *'  # daily 06:00 UTC
  workflow_dispatch:     # manual trigger
jobs:
  vendor-roundtrip:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: '.nvmrc' }
      - run: npm ci
      - run: npx vitest run tests/integration/benchmarks/
        env:
          MEM0_API_KEY:  ${{ secrets.MEM0_API_KEY }}
          ZEP_API_KEY:   ${{ secrets.ZEP_API_KEY }}
          LETTA_API_KEY: ${{ secrets.LETTA_API_KEY }}
```

**Validation:** Given the YAML file written, when `yamllint .github/workflows/vendor-benchmarks.yml` runs, then 0 errors (assertEquals errors_count 0). Given the file pushed to develop, when `gh workflow list` runs, then `vendor-benchmarks` appears in active workflows. Given manual trigger from `main` (with secrets set), when `gh workflow run vendor-benchmarks.yml` invoked, then job concludes succeed (assertEquals exit_status 0). NO `pull_request` trigger per EC-14 (fork PRs cannot access secrets by GitHub design — schedule + workflow_dispatch only).

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
