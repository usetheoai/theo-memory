# Plan: examples-chat-with-memory v0.7 distillation wiring

> **Version 1.1** (2026-06-01) — Absorbs ALL 8 edge cases from `/edge-case-plan examples-chat-with-memory-v0-7-distillation` review at `.claude/knowledge-base/reviews/examples-chat-with-memory-v0-7-distillation-edge-cases-2026-06-01.md`. **3 MUST FIX absorbed**: EC-1 StubLLM detection — factory throws `StubLlmNotUsableForLjmError` when `THEOMEM_USE_STUB_ADAPTERS=1` + `policy='llm-judged-merge'`; route returns `422 { code: 'STUB_LLM_NOT_USABLE_FOR_LJM' }` (T0.1 + T1.1); EC-2 integration test bootstrap — `describe.skipIf(!isReachable('localhost:3000/api/health'))` + documented `npm run dev` pre-condition (T4.1); EC-3 invalid policy name — literal-union validation BEFORE factory call → `400` (T1.1). **3 SHOULD TEST absorbed as TDD halt-loop checkpoints**: EC-4 concurrent POST audit behavior (T1.1); EC-5 UI race condition on userId change mid-fetch — `AbortController` cleanup mitigation (T2.1); EC-6 double-click `disabled={loading}` button mitigation (T2.1). **2 DOCUMENT absorbed**: EC-7 idempotency expected — each click = new audit row (README in T3.1); EC-8 `kept_memory_id IS NULL` rows excluded from view per JOIN — orphans queryable via raw SQL (README in T3.1 + T1.2 acceptance).
>
> **Version 1.0** (2026-06-01) — Consumer-side wiring of the v0.7 `ConflictResolutionPolicy` API (just shipped at commits `bab7a02` → `7dc06f9`) into the existing `examples/chat-with-memory/` Next.js demo. Precedent: `examples-chat-with-memory-v0-4b-expansion-plan.md` (already-shipped cycle that wired v0.4b eviction + `forget({hard:true})` opt-in into the demo). User chose Option D = full cycle per `cycle-plan.md` v1.1 chain (`/to-plan` → `/edge-case-plan` → `/deps-audit` → `/plan-confidence` → `/implement`). Zero new npm deps; SDK exposes everything needed.

## Goal

Ship a `DistillationTab` on the chat-with-memory demo that lets the operator pick one of the 3 `ConflictResolutionPolicy` impls (`noop` / `last-write-wins` / `llm-judged-merge`) + click "Distill now" + see the resulting `consolidation_history` rows verbatim (kept / rejected / reason / policy_name), measured by `npm run test:integration -- tests/integration/examples/chat-with-memory-distillation.test.ts` PASS against the demo's HTTP surface + `consolidation_history.policy_name = 'last-write-wins'` row exists after the test scenario seeds 2 contradictory memories and POSTs `/api/memory/distill`.

The action verb is **ship**; the named observable metric is the integration test pass + a non-zero `consolidation_history` row count returned by the new `/api/memory/consolidation-history` endpoint.

## Context

### What exists today (surfaces this plan builds on)

| Surface | Status | Source |
|---|---|---|
| v0.7 ConflictResolutionPolicy DIP + 3 impls | SHIPPED 2026-06-01 | `src/core/conflict-resolution/{noop,last-write-wins,llm-judged-merge,prompts}.ts` |
| `Memory.reflect({ conflictResolution })` public surface | SHIPPED 2026-06-01 | `src/core/options.ts:ReflectOptions.conflictResolution` |
| `consolidation_history` table + FK ON DELETE SET NULL | SHIPPED 2026-06-01 | `src/local/migrations/0007_distillation_columns.sql` |
| `PgvectorStore.persistConsolidations` + `recallConsolidationCandidates` | SHIPPED 2026-06-01 | `src/local/pgvector-store.ts:489-560` |
| Demo singleton + auto-backend-detect | SHIPPED v0.6.1 | `examples/chat-with-memory/lib/memory.ts` (198 LoC) |
| `/api/memory/reflect` route | SHIPPED v0.4a | `examples/chat-with-memory/app/api/memory/reflect/route.ts` (28 LoC) |
| Demo tab pattern + `MemorySidebar` | SHIPPED v0.4b | `examples/chat-with-memory/components/memory-sidebar.tsx` (122 LoC) + `memory-tabs/eviction-tab.tsx` precedent (150 LoC) |
| `TabKey` union: `'user' \| 'session' \| 'skills' \| 'history' \| 'eviction'` | SHIPPED | `memory-sidebar.tsx:line 23` |
| `/test-chat-with-memory` exhaustive E2E skill | SHIPPED v0.6.1 | `.claude/skills/test-chat-with-memory/` (30 scenarios via Chrome DevTools MCP) |

### Why this matters NOW

v0.7 SDK shipped 9 hours ago (commits `bab7a02` → `7dc06f9` pushed to origin/develop). The SDK is dogfood-ready but the demo — which is the user-visible surface most consumers will encounter first — does NOT exercise the new `ConflictResolutionPolicy` surface. Wiring it into the demo:

1. **Confirms public-API ergonomics**: forcing the demo to consume `@usetheo/memory` (the published surface, NOT `src/` internals) flushes out any export gap that the SDK's own integration tests missed.
2. **Provides empirical evidence for `/dogfood` gate**: `dogfood-golden-rule.md` blocks any `production-ready` claim until the anchor scenario shows sustained use. A working distillation flow in the demo is concrete evidence.
3. **Sets up the v0.7.1 real-LLM-measured GOAL TEST path**: the demo is exactly where an operator with `OPENAI_API_KEY` can exercise the LLM-judged-merge policy end-to-end + capture real quality numbers — currently deferred per `ADR-DEFER-LLM-MEASURED-GOAL-TEST` in `tests/integration/distillation/the-goal-test.test.ts`.

### Accepted risks (declared upfront)

- **EC-A — UI verification depends on Chrome MCP** which is `F-T4.1-1 BLOCKED` per the current CHANGELOG. Mitigation: SDK-layer + HTTP-layer integration test (against the demo's `fetch`-callable API surface) is the load-bearing regression guard; `/test-chat-with-memory` scenario stays present as a forward-looking automation hook but is honestly documented as BLOCKED-pending-Chrome-MCP-lift in the task DoD.
- **EC-B — `llm-judged-merge` policy requires `OPENAI_API_KEY`**. Mitigation: backend returns structured `422 { code: 'OPENAI_API_KEY_MISSING' }` when the env var is absent + the request asks for that policy; UI surfaces the error verbatim. NO silent fallback to LWW (would lie about which policy ran; violates Rule 3).
- **EC-C — `consolidation_history` row count can grow unbounded** under repeated "Distill now" clicks during demo. Mitigation: the new audit GET endpoint paginates (default LIMIT 50, ORDER BY created_at DESC) so the UI never tries to render 10k rows.
- **EC-D — F-T4.1-2 eviction-race regression** was lifted upstream (commit `b2909ff` reverted). The demo's eviction wiring + distillation wiring share the `postRememberHook` machinery; if F-T4.1-2 resurfaces under combined load, distillation could mis-attribute the failure. Mitigation: distillation route logs `policy_name + invocation_id` so the source of any inconsistency is unambiguous in the demo logs.
- **EC-1 (absorbed v1.1) — `policy='llm-judged-merge'` + `THEOMEM_USE_STUB_ADAPTERS=1` silently abstains** because the singleton's `llm` field is `DeterministicStubLLM` returning empty `{}` → `parseConsolidationResponse` returns null → policy abstains. Violates Inquebrável Rule 3 + ADR D3's "NO silent fallback" promise. Mitigation: factory in T0.1 detects stub via `llm.constructor.name === 'DeterministicStubLLM'` OR sentinel `kind`-field check + throws typed `StubLlmNotUsableForLjmError`; route in T1.1 maps to `422 { code: 'STUB_LLM_NOT_USABLE_FOR_LJM' }`.
- **EC-2 (absorbed v1.1) — integration test bootstrap strategy is the dev-server-reachable probe** (NOT in-process spawn). T4.1 test header documents the `npm run dev` pre-condition; `describe.skipIf(!(await isReachable('localhost:3000/api/health')))` cleanly skips in CI without manual server. Mirrors EC-11 pattern from v0.7 SDK cycle (`T3.2` `docs/distillation-evaluation/README.md`).
- **EC-3 (absorbed v1.1) — unknown `policy` value returns `400`, NOT `500`**. T1.1 validates `policy` against the literal `['noop','last-write-wins','llm-judged-merge']` BEFORE calling the factory; factory's throw stays as a defense-in-depth path that maps to `500` only if the validation gate is bypassed (which it shouldn't be).
- **EC-7 (DOCUMENT, absorbed v1.1) — every "Distill now" click writes new `consolidation_history` rows** by design (matches v0.7 SDK T2.1 contract — each `reflect({conflictResolution})` is an independent invocation; no client-side dedup). README documents the behavior in T3.1.
- **EC-8 (DOCUMENT, absorbed v1.1) — audit rows with `kept_memory_id IS NULL`** (post-GDPR `forget({hard:true})`) are preserved in DB (per EC-3 ON DELETE SET NULL of the v0.7 SDK migration 0007) but excluded from the Distillation tab view because T1.2's query uses `JOIN memories ON ch.kept_memory_id = m.id` (INNER JOIN). Operators can query raw SQL for orphan audit rows. README documents in T3.1; future cycle can add `/api/memory/consolidation-history/orphans` view if requested.

### Compliance scope

Honors `architecture.md § 3 DIP` — examples/ code imports only from `@usetheo/memory` (the published package surface); zero `src/local/` deep-imports beyond what's already in the demo's v0.4b precedent. Honors `§ 6 Naming` (kebab-case files, PascalCase components, camelCase functions). Honors `§ 7 Module hygiene` (no `any`, no `console.log` in production paths beyond the existing diagnostic surfaces). Honors `testing.md § Pyramid` (unit tests for the policy factory helper; integration for the HTTP flow; E2E deferred via `/test-chat-with-memory` BLOCKED disclosure). Honors `no-paper-names-in-code.md` (no `Mem0` / `Letta` / `Voyager` / etc. in src/test/component code; `@see` to `.claude/knowledge-base/plans/` allowed). Honors `dogfood-golden-rule.md` (NO `production-ready` token — this is dogfood evidence material). Honors `cycle-plan.md` v1.1 (chain through `/edge-case-plan` + `/deps-audit` + `/plan-confidence`). Honors Inquebrável Rule 9 (zero new deps).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@usetheo/memory` | (workspace; just shipped 7dc06f9) | npm | Imports `ConflictResolutionPolicy`, `NoopConflictPolicy`, `LastWriteWinsConflictPolicy`, `LlmJudgedMergeConflictPolicy`, `ConflictResolutionResult`, `OpenAILLM` (already used in demo for llm) |
| `@usetheo/ui` | existing pin | npm | Card, Button (used by EvictionTab precedent) |
| `lucide-react` | existing pin | npm | Icons (used by EvictionTab precedent) |
| `next` | existing pin | npm | App Router routes |
| `react` | existing pin | npm | useState / useEffect / useCallback |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | All needs covered by existing demo deps + just-shipped @usetheo/memory surface. Zero-new-deps verified before plan write. | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Objective

- [ ] T0.1 — Demo singleton policy factory: extend `examples/chat-with-memory/lib/memory.ts` with `getConflictResolutionPolicy(name: 'noop' | 'last-write-wins' | 'llm-judged-merge'): ConflictResolutionPolicy` helper that constructs the right impl. For `llm-judged-merge`, reuses the existing `OpenAILLM` instance threaded through the singleton.
- [ ] T1.1 — Backend `POST /api/memory/distill`: accepts `{userId: string, policy: 'noop' | 'last-write-wins' | 'llm-judged-merge'}`; calls `memory.user(userId).reflect({ conflictResolution: <policy> })`; returns `{ derivedMemoriesCreated, reason, consolidations: ConflictResolutionResult[] }`. EC-B absorbed: `422 { code: 'OPENAI_API_KEY_MISSING' }` when env var absent + `policy === 'llm-judged-merge'`.
- [ ] T1.2 — Backend `GET /api/memory/consolidation-history?userId=...&limit=50`: returns `{ rows: AuditRow[], total: number }` from `consolidation_history` filtered by the user's scope (joins `memories.user_id` via the `kept_memory_id` FK). Pagination LIMIT default 50 / max 200. EC-C absorbed.
- [ ] T2.1 — Frontend `DistillationTab` component: 3-radio policy selector + "Distill now" button + result panel showing last consolidations (kept_memory_id text, rejected_memory_ids text[], reason, policy_name, created_at). Refresh button mirrors `EvictionTab` precedent.
- [ ] T2.2 — Frontend `MemorySidebar` integration: extend `TabKey` union with `'distillation'`; add `{ key: 'distillation', label: 'Distillation' }` to `TABS`; conditional render `{active === 'distillation' && <DistillationTab userId={userId} reloadKey={reloadKey} />}`.
- [ ] T3.1 — Docs: extend `examples/chat-with-memory/README.md` with a Distillation section: how to seed contradiction-pair memories via the chat, click "Distill now", observe rejected memory disappear from User tab + audit row appear in Distillation tab. Document `OPENAI_API_KEY` requirement for llm-judged-merge.
- [ ] T4.1 — Integration validation gate: new `tests/integration/examples/chat-with-memory-distillation.test.ts` exercises the full HTTP flow (POST /api/memory/distill + GET /api/memory/consolidation-history) against a running dev server + real pgvector. `npm test` + `npm run typecheck` + `npm run lint` exit 0. CHANGELOG `[Unreleased] § Added` entry. Push to `origin/develop`. `/test-chat-with-memory` honest BLOCKED disclosure per EC-A (Chrome MCP lock).

## ADRs

### D1 — New `DistillationTab` (NOT extending UserTab)

**Decision:** A separate 6th tab `'distillation'` next to `'eviction'` (Distillation is a peer concern to Eviction — both are reflect()-time pipeline outputs with their own audit trail). UserTab stays focused on raw memory listing.

**Alternatives considered:**
- (A) Inline distillation controls inside UserTab — REJECTED: UserTab grows past the 250-LoC informal budget; mixes concerns (memory listing vs pipeline trigger).
- (B) Reuse the existing `/api/memory/reflect` route by accepting a `conflictResolution` field — REJECTED: backward-compat break for existing demo consumers; cleaner UX with a separate "Distill now" affordance.
- (C) New DistillationTab + new `/api/memory/distill` route (CHOSEN) — peer-equivalent to EvictionTab precedent; zero existing-surface change.

**Rationale:** Honors `architecture.md § 7 Module hygiene` (file-size budget) + SRP (tab does one thing). Matches the EvictionTab precedent shipped in `examples-chat-with-memory-v0-4b-expansion`.

**Consequences:** `TabKey` union widens by one variant; `TABS` array gains one entry; one new route file + one new component file ship.

### D2 — Policy selector as 3 radio buttons (NOT dropdown)

**Decision:** UI surfaces the 3 policies as discoverable radio buttons + a one-line description per option. "Distill now" button is only enabled after a selection.

**Alternatives considered:**
- (A) Dropdown / select — REJECTED: hides the 3 options behind a click; less discoverable for first-time demo users.
- (B) Three separate buttons ("Distill Noop" / "Distill LWW" / "Distill LJM") — REJECTED: looks like 3 unrelated actions; muddles the "pick one policy + run" intent.
- (C) Radio + single action button (CHOSEN) — explicit policy choice + single intent.

**Rationale:** Honors KISS (simplest discoverable UI) + dogfood-discipline (the demo is teaching material; visibility > brevity).

**Consequences:** Tab needs `policy: PolicyName | null` state + disabled-state on the button.

### D3 — `422 OPENAI_API_KEY_MISSING` (NOT silent fallback to LWW)

**Decision:** Backend returns `422 { code: 'OPENAI_API_KEY_MISSING', message: '...' }` when the env var is absent + the client requested `llm-judged-merge`. UI surfaces the error verbatim.

**Alternatives considered:**
- (A) Silent fallback to LWW with a warning header — REJECTED: client thinks they ran LJM; metrics + audit row would mislabel; violates Inquebrável Rule 3 (extreme honesty).
- (B) Pre-flight `GET /api/memory/info` to advertise the available policies and gray out llm-judged-merge in the UI when key absent — DEFERRED to a v0.7.2 cycle (would add a roundtrip + complexity for marginal UX gain).
- (C) Structured 422 + UI surfaces error (CHOSEN) — honest; minimal surface change.

**Rationale:** Inquebrável Rule 3 (extreme honesty) + REST conventions (422 Unprocessable Entity = request semantically valid but cannot be fulfilled due to environment state).

**Consequences:** UI needs an error-render path on the response (which it already needs for any 4xx anyway).

### D4 — Consolidation-history endpoint paginates server-side

**Decision:** `GET /api/memory/consolidation-history?userId=...&limit=N&offset=M` enforces `limit <= 200` server-side; default `limit=50`, `offset=0`. Response carries `{rows, total}`.

**Alternatives considered:**
- (A) Return all rows always — REJECTED: unbounded growth under demo use; memory + render hazard.
- (B) Client-side pagination after fetching all — same hazard.
- (C) Server-side paginate with cap (CHOSEN) — bounded blast radius.

**Rationale:** EC-C accepted-risk mitigation + `architecture.md § 8 Error handling` (validate at boundary).

**Consequences:** UI needs simple "Load more" affordance (or just stops at 50 for v0.7 — Acceptance Criteria documents the limit).

### D5 — `lib/memory.ts` keeps the `OpenAILLM` instance for policy reuse

**Decision:** When the singleton constructs `LlmJudgedMergeConflictPolicy`, it reuses the same `OpenAILLM` instance already wired for the demo's chat path (no second client instantiation per request). The policy is constructed lazily inside the factory helper to avoid eager OpenAI client init when the demo runs in stub-only mode.

**Alternatives considered:**
- (A) Construct a fresh `OpenAILLM` per request — REJECTED: defeats the lazy-singleton pattern (`src/llms/openai.ts:openaiClient()`); wastes connection setup per call.
- (B) Eager-construct the LJM policy at singleton boot — REJECTED: forces OpenAI dep when consumer only wants noop/LWW.
- (C) Lazy + reuse (CHOSEN) — KISS + matches the existing demo singleton pattern.

**Rationale:** Honors Inquebrável Rule 9 (don't reinvent the singleton wheel) + `architecture.md § 7 Module hygiene` (no duplicate I/O).

**Consequences:** Factory helper closes over the singleton's `llm` instance; trivially typed.

### D6 — TDD discipline for examples/ code: HTTP-integration first, UI deferred per Chrome MCP lock

**Decision:** RED tests for examples/ code live at `tests/integration/examples/chat-with-memory-distillation.test.ts` (the project-level `tests/integration/` matches `vitest.integration.config.ts` include). The UI component itself ships without component-level Vitest tests (`@usetheo/ui` testing pattern uses Chrome DevTools MCP for end-to-end); honest BLOCKED disclosure per EC-A.

**Alternatives considered:**
- (A) Skip TDD for examples/ ("it's just a demo") — REJECTED: violates Inquebrável Rule 5; demo regressions hide real SDK regressions.
- (B) Vitest jsdom + @testing-library/react for UI — DEFERRED: introduces new dev deps + competes with the established Chrome MCP discipline (post-Chrome-MCP-lift cycle).
- (C) HTTP-integration TDD + UI honest-BLOCKED (CHOSEN) — exercises the load-bearing wire layer; documents the gap.

**Rationale:** Inquebrável Rule 5 (TDD) is honored at the HTTP boundary which is the deterministic surface. UI testing waits for Chrome MCP unlock per CHANGELOG F-T4.1-1.

**Consequences:** T4.1 ships an integration test against a running dev server + real pgvector. UI verification stays manual until Chrome MCP unblocks `/test-chat-with-memory`.

## Dependency Graph

```
T0.1 (lib/memory.ts factory)
  ↓
  ├──→ T1.1 (POST /api/memory/distill)
  └──→ T1.2 (GET /api/memory/consolidation-history)
              ↓ (both routes available)
              T2.1 (DistillationTab component)
              ↓
              T2.2 (MemorySidebar integration)
              ↓
              T3.1 (README docs)
              ↓
              T4.1 (validation + push)
```

T1.1 + T1.2 parallelizable (independent routes). T2.1 + T2.2 sequential (component MUST exist before sidebar imports it).

## Phases

### T0.1 — `lib/memory.ts` policy factory helper

**Plan reference:** ADR D5.

**Files to edit:**
- `examples/chat-with-memory/lib/memory.ts` (UPDATE — add `getConflictResolutionPolicy(name): ConflictResolutionPolicy` + export `PolicyName` type union)
- `tests/integration/examples/chat-with-memory-policy-factory.test.ts` (NEW — RED test for the factory)

**Deep file dependency analysis:**
- `lib/memory.ts` already exports `getMemory()` + `getSingleton()` + `getBackend()`. Adding one more named export follows the existing pattern.
- `OpenAILLM` instance lives on the singleton (line ~115 of memory.ts based on the v0.6 demo expansion); factory closes over it.
- Type union `PolicyName = 'noop' | 'last-write-wins' | 'llm-judged-merge'` shipped here; reused by routes (T1.1) and component (T2.1).
- **EC-1 absorbed**: demo singleton accepts `THEOMEM_USE_STUB_ADAPTERS=1` (verified at `examples/chat-with-memory/lib/memory.ts`) which swaps `OpenAILLM` for `DeterministicStubLLM`. Factory MUST detect this AND refuse to construct `LlmJudgedMergeConflictPolicy` when stub mode is active (stub returns empty `{}` → policy abstains silently). Detection: `llm.constructor.name === 'DeterministicStubLLM'` OR sentinel `kind`-field probe (whichever is more stable). Export typed error `StubLlmNotUsableForLjmError extends Error` from `lib/memory.ts` so T1.1 route can `instanceof` check and map to 422.

**TDD:**
- **RED:** factory test asserts `getConflictResolutionPolicy('noop').kind === 'noop'` etc. for all 3 names. Throws on unknown name with typed error.
- **RED-EC-1:** when singleton boots with `THEOMEM_USE_STUB_ADAPTERS=1`, `getConflictResolutionPolicy('llm-judged-merge')` throws `StubLlmNotUsableForLjmError` with explicit message. Asserts via `expect(...).toThrow(StubLlmNotUsableForLjmError)`.
- **GREEN:** add the helper + the detection branch; tests PASS.
- **REFACTOR:** ensure no `any`; close over singleton's `llm` field for LJM construction.

**Acceptance criteria:**
- [ ] `getConflictResolutionPolicy(name)` returns a `ConflictResolutionPolicy` with matching `kind`
- [ ] Throws `Error` with explicit message on unknown name (no silent any-cast)
- [ ] **EC-1**: Throws `StubLlmNotUsableForLjmError` when `policy='llm-judged-merge'` AND singleton's `llm` is `DeterministicStubLLM`
- [ ] `PolicyName` + `StubLlmNotUsableForLjmError` types exported for downstream reuse
- [ ] `memory.ts` total LoC ≤ 250 (informal budget; precedent is 198 LoC)

**COMMIT:** `feat(examples)(v0-7-distill): policy factory helper + StubLLM-LJM guard (T0.1 / ADR D5 / EC-1)`

### T1.1 — `POST /api/memory/distill` route

**Plan reference:** ADR D3.

**Files to edit:**
- `examples/chat-with-memory/app/api/memory/distill/route.ts` (NEW; ≤ 80 LoC)
- `tests/integration/examples/chat-with-memory-distillation.test.ts` (UPDATE — adds POST scenarios)

**Deep file dependency analysis:**
- Mirrors `app/api/memory/reflect/route.ts` shape: parse JSON body → invoke memory method → return JSON.
- Calls `memory.user(userId).reflect({ conflictResolution: getConflictResolutionPolicy(policy) })`.
- EC-B: pre-flight check `if (policy === 'llm-judged-merge' && !process.env.OPENAI_API_KEY) return 422` with `code: 'OPENAI_API_KEY_MISSING'`.
- **EC-1 absorbed**: catches `StubLlmNotUsableForLjmError` thrown by T0.1 factory + returns `422 { code: 'STUB_LLM_NOT_USABLE_FOR_LJM' }`. Distinct error code from `OPENAI_API_KEY_MISSING` so UI can render policy-specific guidance.
- **EC-3 absorbed**: validates `body.policy` against the literal union `['noop','last-write-wins','llm-judged-merge']` BEFORE calling the factory. Returns `400 { error: 'invalid policy' }` on mismatch. The factory's throw stays as defense-in-depth.
- **EC-4 absorbed**: concurrent POSTs for same userId run as 2 independent `reflect({conflictResolution})` invocations per the v0.7 SDK T2.1 contract (no client-side dedup; each call may produce 0 or 1 audit row per cluster). EC-8 from v0.7 SDK already guarantees no half-applied tx via `withTransaction`. Document the actual behavior in test + README.
- Returns `{ derivedMemoriesCreated, reason, consolidations: ConflictResolutionResult[] }`.
- EC-D logging: route logs `{ userId, policy, invocationId: crypto.randomUUID() }` at start + `{ invocationId, consolidationCount, durationMs }` at end so concurrent + race scenarios are traceable in demo logs.

**TDD:**
- **RED:** integration test seeds 2 contradictory memories via direct `pool.query` INSERT + POSTs `/api/memory/distill` with `{userId, policy: 'last-write-wins'}`; asserts response body + `consolidation_history` row exists with `policy_name = 'last-write-wins'`.
- **RED #2:** POST with `policy: 'llm-judged-merge'` AND `OPENAI_API_KEY=''` → 422 with `code: 'OPENAI_API_KEY_MISSING'`.
- **RED #3 (EC-1)**: POST with `policy: 'llm-judged-merge'` AND `THEOMEM_USE_STUB_ADAPTERS=1` → 422 with `code: 'STUB_LLM_NOT_USABLE_FOR_LJM'`.
- **RED #4 (EC-3)**: POST with `policy: 'invalid-policy'` → 400 with `error: 'invalid policy'`.
- **RED #5 (EC-4)**: 2 parallel POSTs same userId → both 200; assert `consolidation_history` count is 1 OR 2 (independent invocations are acceptable per contract); assert no NULL `kept_memory_id` from a half-applied tx.
- **GREEN:** implement route; tests PASS.
- **REFACTOR:** factor request-validation into typed Zod schema if growing.

**Acceptance criteria:**
- [ ] Route file ≤ 80 LoC
- [ ] 422 contract honored when key missing for LJM
- [ ] **EC-1**: 422 with distinct `code: 'STUB_LLM_NOT_USABLE_FOR_LJM'` when stub mode + LJM requested
- [ ] **EC-3**: 400 on unknown policy name (validated against literal union BEFORE factory)
- [ ] **EC-4**: concurrent POSTs both succeed; audit row count is N independent runs (documented behavior)
- [ ] `consolidation_history` row exists post-call when LWW resolves 2+ contradictory memories
- [ ] Response shape stable + typed
- [ ] No console.log in production path; structured `console.info` for `invocationId` logging is allowed (EC-D)

**COMMIT:** `feat(examples)(v0-7-distill): POST /api/memory/distill route with stub-LJM + invalid-policy guards (T1.1 / ADR D3 / EC-1 + EC-3 + EC-4)`

### T1.2 — `GET /api/memory/consolidation-history` route

**Plan reference:** ADR D4.

**Files to edit:**
- `examples/chat-with-memory/app/api/memory/consolidation-history/route.ts` (NEW; ≤ 100 LoC)
- `tests/integration/examples/chat-with-memory-distillation.test.ts` (UPDATE — adds GET scenarios)

**Deep file dependency analysis:**
- Query: `SELECT * FROM consolidation_history ch JOIN memories m ON ch.kept_memory_id = m.id WHERE m.user_id = $1 ORDER BY ch.created_at DESC LIMIT $2 OFFSET $3`. The JOIN handles scope filtering through the kept_memory_id (rejected_memory_ids JSONB is also surfaced verbatim).
- Edge case: rows where `kept_memory_id IS NULL` (post-GDPR hard-delete) — LEFT JOIN keeps them, `user_id = $1` may filter them out. Acceptable v0.7 demo behavior; documented.
- Returns `{ rows: AuditRow[], total: number }`.

**TDD:**
- **RED:** seed 3 distillation runs via T1.1's flow; GET with `limit=2` returns 2 rows + `total=3`.
- **RED #2:** GET with no rows for the userId returns `{rows: [], total: 0}` (not 404).
- **GREEN:** implement route; tests PASS.
- **REFACTOR:** parameterize the pagination clamp helper.

**Acceptance criteria:**
- [ ] Route file ≤ 100 LoC
- [ ] Pagination respects `limit` (default 50, max 200) + `offset` (default 0)
- [ ] Empty result returns 200 with empty array (NOT 404)
- [ ] `total` count accurate
- [ ] Ordering by `created_at DESC`
- [ ] **EC-8**: rows with `kept_memory_id IS NULL` excluded from response (INNER JOIN intentional); raw SQL still surfaces orphans for ops queries; README (T3.1) documents this discipline

**COMMIT:** `feat(examples)(v0-7-distill): GET /api/memory/consolidation-history route (T1.2 / ADR D4 / EC-8)`

### T2.1 — `DistillationTab` component

**Plan reference:** ADR D1 + ADR D2.

**Files to edit:**
- `examples/chat-with-memory/components/memory-tabs/distillation-tab.tsx` (NEW; ≤ 200 LoC)

**Deep file dependency analysis:**
- Mirrors `eviction-tab.tsx` shape (150 LoC): Props {userId, reloadKey}; useState + useCallback + useEffect; Card + Button from `@usetheo/ui`; lucide icons.
- 3 radio buttons via plain `<input type="radio">` (no new UI dep). Could use `@usetheo/ui` RadioGroup if available; checks ui surface at impl time.
- 422 from POST surfaced as a Card with red border + the error code. Component distinguishes `OPENAI_API_KEY_MISSING` (suggests setting env var) vs `STUB_LLM_NOT_USABLE_FOR_LJM` (suggests unsetting `THEOMEM_USE_STUB_ADAPTERS`) — explicit user guidance per EC-1.
- **EC-5 absorbed**: `useEffect` cleanup pattern + `AbortController` per useCallback fetch — when `userId` (dep) changes, the inflight fetch is aborted so stale results never overwrite the current state. Pattern: `const controller = new AbortController(); fetch(url, { signal: controller.signal }); return () => controller.abort()`.
- **EC-6 absorbed**: "Distill now" button is `disabled={loading}` — both during the POST inflight AND while reloading the audit list after. Prevents double-POST from rapid clicks.

**TDD:**
- **RED (UI):** DEFERRED per ADR D6 + EC-A. Component ships without unit tests; manual visual verification noted in T4.1.
- **GREEN:** implement; manual spot-check via `npm run dev`.
- **REFACTOR:** extract the audit-row render to a helper if rendering grows.

**Acceptance criteria:**
- [ ] Component file ≤ 200 LoC
- [ ] 3-radio policy selector renders + selection-disabled button
- [ ] Loading + error states render correctly (including distinct messaging for the 2 EC-1 422 codes)
- [ ] No `any`; no `console.log` (toast or render error instead)
- [ ] Reuses EvictionTab visual language (Card, refresh button, useCallback pattern)
- [ ] **EC-5**: useEffect cleanup uses `AbortController.abort()` on dep change; stale results cannot overwrite current state
- [ ] **EC-6**: "Distill now" button carries `disabled={loading}` — both during POST inflight AND during the post-POST audit-list refresh

**COMMIT:** `feat(examples)(v0-7-distill): DistillationTab component with abort + double-click guards (T2.1 / ADR D1 + D2 / EC-5 + EC-6)`

### T2.2 — `MemorySidebar` integration

**Plan reference:** ADR D1.

**Files to edit:**
- `examples/chat-with-memory/components/memory-sidebar.tsx` (UPDATE; +3 LoC net)

**Deep file dependency analysis:**
- Extends `TabKey` union (line 23): adds `'distillation'` variant.
- Extends `TABS` array (line 24-29): adds `{ key: 'distillation', label: 'Distillation' }` between `'eviction'` and end-of-list.
- Adds conditional render block: `{active === 'distillation' && <DistillationTab userId={userId} reloadKey={reloadKey} />}`.
- Imports `DistillationTab` from `./memory-tabs/distillation-tab`.

**TDD:**
- **RED:** type-check fails because `'distillation'` is not in `TabKey` until updated.
- **GREEN:** add the variant + the conditional render.
- **REFACTOR:** none (mechanical change).

**Acceptance criteria:**
- [ ] 6 tabs total now: user / session / skills / history / eviction / distillation
- [ ] Sidebar component LoC < 140
- [ ] Tab selection works (clicking surfaces the right tab)
- [ ] `npm run typecheck` clean

**COMMIT:** `feat(examples)(v0-7-distill): wire DistillationTab into MemorySidebar (T2.2 / ADR D1)`

### T3.1 — README docs

**Plan reference:** EC-B + EC-A.

**Files to edit:**
- `examples/chat-with-memory/README.md` (UPDATE — add Distillation section)

**Deep file dependency analysis:**
- README already documents Eviction; mirror the structure.
- Document `OPENAI_API_KEY` requirement + the 422 contract.
- Document the seed-2-contradictory-memories → "Distill now" → see audit flow.
- Honest disclosure: UI verification BLOCKED via Chrome MCP per F-T4.1-1.

**TDD:**
- **RED:** N/A (docs); manual review.
- **GREEN:** write the section; verify markdown renders cleanly.
- **REFACTOR:** none.

**Acceptance criteria:**
- [ ] New "Distillation" H2 section under "How to run"
- [ ] OPENAI_API_KEY requirement documented + 422 contract
- [ ] **EC-1**: `THEOMEM_USE_STUB_ADAPTERS=1` + LJM combo documented as unsupported with the 422 code surfaced
- [ ] Step-by-step demo walkthrough (seed 2 memories via chat → click "Distill now" → see audit row)
- [ ] **EC-7**: documented that each "Distill now" click is an independent invocation — new audit rows on every click (no client-side dedup); operators can paginate via the audit endpoint
- [ ] **EC-8**: documented that orphan audit rows (post-`forget({hard:true})`, `kept_memory_id IS NULL`) are preserved in DB but excluded from the tab view; raw SQL query example shown
- [ ] No paper names; no production-ready tokens
- [ ] `@see` link to plan + v0.7 SDK commit ref `7dc06f9`

**COMMIT:** `docs(examples)(v0-7-distill): README Distillation section + EC-1/7/8 disclosures (T3.1)`

### T4.1 — Integration validation gate + CHANGELOG + push

**Plan reference:** Global DoD + ADR D6 + EC-A.

**Files to edit:**
- `tests/integration/examples/chat-with-memory-distillation.test.ts` (NEW; ≤ 250 LoC) — exercises POST /api/memory/distill + GET /api/memory/consolidation-history against a running dev server + real pgvector.
- `CHANGELOG.md` (UPDATE — `[Unreleased] § Added` entry)
- `.claude/skills/test-chat-with-memory/SKILL.md` (UPDATE — adds Distillation scenarios with honest BLOCKED disclosure)

**Deep file dependency analysis:**
- **EC-2 absorbed**: integration test uses the `describe.skipIf(!(await isReachable('localhost:3000/api/health')))` pattern — reachability probe BEFORE the test body. Header comment documents the `npm run dev` pre-condition + the `OPENAI_API_KEY` + `THEOMEM_PG_URI` env vars. CI without a running server skips cleanly (NOT a flake); local devs run `npm run dev` in another terminal + `npm run test:integration -- tests/integration/examples/` in this terminal. Pre-flight helper `isReachable(url): Promise<boolean>` is a 5-line `fetch().then(r => r.ok).catch(() => false)`. Mirrors the EC-11 pattern shipped in the v0.7 SDK cycle (`docs/distillation-evaluation/README.md`).
- `vitest.integration.config.ts` already includes `tests/integration/**` so the new path is reachable.
- CHANGELOG entry summarizes the 7-task plan + commit refs + EC-A BLOCKED disclosure.

**Tasks:**
1. `npm test` exit 0
2. `npm run typecheck` exit 0
3. `npm run lint` exit 0
4. `npm run build` PASS
5. `npm run test:integration -- tests/integration/examples/` PASS (or BLOCKED with documented reason — dev server not running)
6. CHANGELOG `[Unreleased] § Added` entry
7. No vocab-lock violations (`production-ready` / `production-grade` / `v1.0 ready`)
8. No paper names in examples/ + tests/integration/examples/ code
9. `/test-chat-with-memory` scenarios updated with Distillation flow OR honest BLOCKED via Chrome MCP per F-T4.1-1
10. Push to `origin/develop`

**Acceptance criteria:**
- [ ] All 10 checks PASS (or BLOCKED with documented honest disclosure for #5/#9)
- [ ] **EC-2**: integration test uses `describe.skipIf(!(await isReachable(...)))`; passes when `npm run dev` is up + skips cleanly otherwise (no flake)
- [ ] Validation report at `.claude/knowledge-base/reviews/examples-chat-with-memory-v0-7-distillation-implement-validate-{date}.md`

**COMMIT:** `chore(implement)(v0-7-distill): validation gate + CHANGELOG + push (T4.1 / EC-2)`

## Coverage Matrix

| # | Gap / Requirement (from user request + SDK v0.7 shipped surface) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Demo exposes the 3 ConflictResolutionPolicy choices to the operator | T0.1 + T2.1 | Factory helper + UI radio selector |
| 2 | Operator can trigger reflect-with-distillation via HTTP | T1.1 | POST /api/memory/distill route |
| 3 | Operator can see consolidation_history audit rows | T1.2 + T2.1 | GET endpoint + tab render |
| 4 | EC-B: OPENAI_API_KEY missing for LJM → honest 422 (no silent fallback) | T1.1 (ADR D3) | 422 with structured code |
| 5 | EC-C: consolidation_history unbounded growth → pagination cap | T1.2 (ADR D4) | Server-side LIMIT cap |
| 6 | EC-A: UI verification BLOCKED via Chrome MCP → honest disclosure | T4.1 + T3.1 | README + skill docs + integration test as load-bearing guard |
| 7 | EC-D: F-T4.1-2 regression risk → traceable logging | T1.1 | policy_name + invocation_id in logs |
| 8 | DistillationTab integrates into the existing 5-tab sidebar | T2.2 | TabKey union extended + TABS array + conditional render |
| 9 | Operator-facing docs explain how to test the flow | T3.1 | README Distillation section |
| 10 | CHANGELOG entry + push to origin/develop | T4.1 | Standard /implement T4.1 |
| 11 | EC-1: StubLLM + LJM silent abstain (Rule 3 violation) | T0.1 + T1.1 | Factory throws `StubLlmNotUsableForLjmError` → route 422 with `STUB_LLM_NOT_USABLE_FOR_LJM` code; UI distinguishes from `OPENAI_API_KEY_MISSING` |
| 12 | EC-2: integration test bootstrap strategy underspecified | T4.1 | `describe.skipIf(!(await isReachable('localhost:3000/api/health')))` + documented `npm run dev` pre-condition |
| 13 | EC-3: invalid policy name → 500 not 400 | T1.1 | Literal-union validation BEFORE factory call |
| 14 | EC-4: concurrent POSTs for same userId | T1.1 | Documented behavior — independent invocations, no client-side dedup; tx atomicity via v0.7 SDK EC-8 |
| 15 | EC-5: UI race condition on userId change mid-fetch | T2.1 | `AbortController` in useEffect cleanup |
| 16 | EC-6: double-click duplicate POSTs | T2.1 | `disabled={loading}` on Distill button |
| 17 | EC-7: each click = new audit row (no dedup) | T3.1 | README documents idempotency expectation |
| 18 | EC-8: orphan audit rows (kept_memory_id IS NULL) excluded from view | T1.2 + T3.1 | INNER JOIN behavior documented; raw SQL example for ops |

18 / 18 mapped. Coverage Matrix: 100%.

## Global Definition of Done

- [ ] All 7 task groups committed (T0.1, T1.1, T1.2, T2.1, T2.2, T3.1, T4.1)
- [ ] `npm test` exit 0
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] `npm run build` PASS
- [ ] `npm run test:integration -- tests/integration/examples/` PASS (or honest BLOCKED disclosure for env-not-running)
- [ ] Distillation HTTP flow verified end-to-end against real pgvector
- [ ] CHANGELOG `[Unreleased] § Added` entry mentions v0.7 distillation demo wiring + plan slug + commit refs
- [ ] No vocab-lock violations (`production-ready` / `production-grade` / `v1.0 ready`)
- [ ] No paper names in `examples/` + `tests/integration/examples/` (`Voyager` / `Mem0` / `Letta` / etc.)
- [ ] DIP boundaries preserved (`examples/` imports ONLY from `@usetheo/memory` + `@usetheo/ui` + existing demo deps)
- [ ] File-size budgets: `memory.ts` ≤ 250 LoC; `distill/route.ts` ≤ 80; `consolidation-history/route.ts` ≤ 100; `distillation-tab.tsx` ≤ 200; `memory-sidebar.tsx` < 140
- [ ] All 3 policies exercised by integration test (Noop happy path; LWW happy path with consolidation_history row; LJM 422 path)
- [ ] Honest BLOCKED disclosure documented for Chrome MCP UI scenarios per F-T4.1-1
- [ ] `/dogfood` re-run captures the new flow as evidence (no production-ready claim attempted — pre-release stays)
- [ ] Pushed to `origin/develop`
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/` AFTER `/review READY_TO_MERGE` + PR merged

## Final Phase: Integration Validation (T4.1)

`npm test && npm run typecheck && npm run lint && npm run build && npm run test:integration -- tests/integration/examples/ && grep -cE "v0\.7.*distill|distillation.*v0\.7" CHANGELOG.md >= 1` returns exit 0.

Re-run of `/review examples-chat-with-memory-v0-7-distillation` mandatory before PR — this cycle adds a new public HTTP surface (`/api/memory/distill` + `/api/memory/consolidation-history`) + a new tab; architectural surface is non-trivial.
