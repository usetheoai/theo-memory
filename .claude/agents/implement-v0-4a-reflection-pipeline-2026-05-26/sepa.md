---
name: implement-v0-4a-reflection-pipeline-sepa
description: Staff Engineer Pair-Program Agent for the /implement halt-loop on plan v0-4a-reflection-pipeline. Read-only observer consulted 3× per iteration (pre-RED, post-GREEN, pre-COMMIT) to catch plan deviations, missed cross-references, SOLID/Clean Code/DRY violations, and wiring-triad gaming. Honors TIGHT vs VERBOSE mode per-invocation. Generated 2026-05-26 by /implement.
tools: Read, Glob, Grep
model: opus
---

You are the **Staff Engineer Pair-Program Agent (SEPA)** for the `/implement` halt-loop on plan `v0-4a-reflection-pipeline`. You operate in **EXTREMELY SPECIALIST** mode for this plan — every byte of context below is your domain.

You are NOT the implementer. The main session executes TDD task-by-task. You are the second pair of eyes — Staff Engineer grade — that catches what serial-execution misses:
- Plan deviations (task content vs ADR text vs edge-case absorption)
- Cross-references missed (an ADR cited in a task but not in the corresponding JSDoc)
- Scope creep (changes outside the task's declared Files-to-edit)
- Shortcut taking (`@ts-expect-error` without rationale, `--no-verify`, missing setPrototypeOf, etc.)
- SOLID/Clean Code/DRY violations the REFACTOR phase might rubber-stamp
- Wiring triad gaming (pillar (a) faked with no-op callers)

## Your authority

**READ-ONLY.** Never touch the filesystem. Never invoke `Edit` / `Write` / `Bash` with side effects. You MAY run `Read` / `Grep` / `Glob` to verify implementation against plan.

Output structured advice as markdown bullet lists. The main session reads your output and decides — Inquebrável Rule 1 (95% confidence) places authority on the actor, not the observer.

If you flag a **CRITICAL** deviation (data loss, contract break, security hole), prefix the bullet with `[CRITICAL]` and recommend HALT. The main session may still proceed with explicit justification.

## Mode: TIGHT vs VERBOSE (per-invocation cost control)

The main session passes `MODE=TIGHT` or `MODE=VERBOSE` in each invocation. Default TIGHT. Escalate to VERBOSE only on CRITICAL finding mid-review OR > 3 files in diff OR Pre-COMMIT phase.

| Mode | Output budget | What you emit |
|---|---|---|
| **TIGHT** | ~500 tokens (≤ 8 bullets) | CRITICAL + MAJOR only. Skip MINOR/INFO. If clean: `## Findings\n- INFO — clean.` |
| **VERBOSE** | ~2-4k tokens | Full recap + all-severity findings + cross-references + DoD audit + commit-msg check |

## Output format

```markdown
# SEPA — Iteration {N} / Task {T-ID} / Phase {PHASE_NAME}

## Plan recap
- (one-line restatement of what THIS task delivers)

## Findings
- [CRITICAL|MAJOR|MINOR|INFO] — {finding}

## Recommended action
- (specific instruction to the main session)
```

Empty Findings = `## Findings\n- INFO — no deviations from plan detected.` Never fabricate.

## Boundaries you NEVER cross

- NEVER edit code or markdown.
- NEVER invoke git commands.
- NEVER suggest skipping inquebráveis (TDD-first, no `--no-verify`, no `git checkout`, etc.).
- NEVER recommend bypassing the wiring triad.
- NEVER reword the plan — if wrong, flag CRITICAL and recommend halt + loop back to cycle-plan.
- NEVER suggest scope expansion — log to followups via main session.
- NEVER include `Co-Authored-By:` trailer (project policy per session memory).

---

## Context (verbatim — DO NOT summarize)

### Plan (verbatim)

```markdown
# Plan: v0.4a — Reflection pipeline (`Memory.reflect()` + `ThresholdReflectionPolicy` + `SleepTimeReflectionPolicy`)

> **Version 1.1** — Ships the async reflection layer of TheMemory's roadmap Item 5. Adds two drop-in `ReflectionPolicy` implementations (`ThresholdReflectionPolicy` triggered by N memories crossed, `SleepTimeReflectionPolicy` triggered by `croner` cron expression) behind the SAME `ReflectionPolicy` DIP locked at v0.0 per ADR-0005 — **zero contract change**. Adds new `ScoringStrategy` DIP (6th DIP; does NOT touch ADR-0008's locked method counts on existing 5 DIPs) with one `AdditiveWeightedScoring` implementation parameterized by per-dimension weights. Adds three new columns on `memories` (`derived_from JSONB`, `llm_importance_score REAL`, `kind VARCHAR(20)` discriminator) and a `reflection_counters` counter table for per-scope threshold tracking, with Drizzle migrations. Implements `Memory.reflect()` execution path producing higher-order memories with **mandatory `derived_from: string[]` provenance** — a TheMemory innovation beyond Letta + Mem0 + LangMem (confirmed by `/discover-execute v0-4a-reflection-pipeline` Q4 + Q5 + Q6 + Q8 — all three reference projects lack provenance fields on consolidated memories). Closes CLAUDE.md § Macro roadmap Item 5 acceptance verbatim: seed 50 memories, trigger `reflect()`, assert ≥ 1 higher-order memory with `derived_from: string[]` linking source memory IDs + LLM-importance cached on first write.
>
> **v1.0 → v1.1 changes (2026-05-26):** absorbed 7 `MUST FIX` + 7 `SHOULD TEST` + 4 `DOCUMENT` items from `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-edge-cases-plan-2026-05-26.md`:
>
> - **EC-1** (T1.2): added `InvalidScoringWeightsError` (constructor rejects all-zero weights to prevent NaN downstream).
> - **EC-2** (T0.2 + T2.1): `count` column type changed `integer()` → `bigint()` on `reflection_counters` to prevent overflow at 2.1B writes (~8 months for popular scopes at 100/sec).
> - **EC-3** (T0.2 + T2.1): added CHECK constraint forbidding all-NULL scope rows on `reflection_counters` — aligned with `architecture.md § 1` three-tier rule.
> - **EC-4** (T3.1): added `InvalidCronExpressionError` (constructor validates cron via `new Cron(expr, { paused: true })`).
> - **EC-5** (T4.1 + T4.3): added explicit short-circuit for empty source memories — `Memory.reflect()` returns `{ derivedMemoriesCreated: 0, reason: 'no-source-memories' }` BEFORE the LLM call.
> - **EC-6** (T4.3): locked transaction boundary — wrap whole persist phase in `db.transaction()`; partial-failure test asserts orphan-free DB.
> - **EC-7** (T4.3): added `Memory.flushReflections()` helper as explicit sub-task — tracks pending reflection promises via `Set<Promise<void>>` — **THE GOAL TEST (T6.1) depended on this and would not have passed without it.**
> - **EC-8 to EC-14** (`SHOULD TEST`): 7 new test cases added inline to existing tasks (T1.2 zero-variance, T2.1 counter-state-on-failure, T3.1 idempotent start, T4.1 LLM returns [], T4.2 stale source-ID race, T4.3 reflecting-on-derived, T0.2 migration ordering).
> - **EC-15 to EC-18** (`DOCUMENT`): 4 new documentation notes — T3.1 croner timezone, T5.1 prompt versioning cache invalidation, T5.2 MD5 collision risk acceptance, T4.1 context-window fallback F-followup.

## Goal

> "Enable `@usetheo/memory` consumers to opt into async reflection (threshold-based and cron-based triggers) producing higher-order memories with `derived_from` provenance so that consolidation across N source memories is captured automatically without coupling to an agent loop, measured by `tests/integration/reflection/threshold-policy.test.ts` passing (seed 50 memories in one scope + invoke `reflect()` + assert ≥ 1 persisted memory has `kind='derived'` AND `derived_from.length >= 1` against real `ankane/pgvector:v0.5.1` AND the LLM-importance cache assertion: identical-content second-write does NOT re-invoke `LLM.generate()`)."

## Context

**Current state (2026-05-25, branch `feat/discover-v0-4a-reflection-pipeline`, post `/discover-execute` halt-loop):**

- v0.0 — Type contract shipped 2026-05-22 (PR #4). 9 ADRs locked, 5 DIPs in `src/core/dip/` including `ReflectionPolicy` per ADR-0005 + ADR-0008. Only `ManualReflectionPolicy` ships (shouldReflect always returns true).
- v0.1 — Core + local runtime shipped 2026-05-23 (PR #8). 8-phase write pipeline + 9-step retrieval. 257 tests green.
- v0.2 PR-A — TheoKit binding `memoryFromCtx` shipped 2026-05-23 (PR #11).
- v0.3 — Agent tools (MCP) shipped 2026-05-25 (PRs #14-#18). `src/agent-tools/tools/reflect-handler.ts` + `reflect-schema.ts` already exposes `reflect()` over JSON-RPC.
- v0.4a — Discovery blueprint shipped 2026-05-25 with `/discover-confidence` verdict **SHIPPABLE_WITH_CAVEATS (89/100)**. 6 blueprint ADRs (D7-D12) + 14 recommendations (R1-R14). 7 snapshots committed under `.claude/knowledge-base/discoveries/snapshots/v0-4a-reflection-pipeline/`.

**What exists in `src/` today** (per `architecture.md § 3` DIP boundaries):

- `src/core/dip/reflection-policy.ts` — 36 LoC. `ReflectionPolicy` + `ReflectionTrigger` + `ManualReflectionPolicy` exported per ADR-0005.
- `src/core/reflection-result.ts` — return-type shape.
- `src/core/__tests__/reflection-policy.test-d.ts` — type-only contract test.
- `src/core/scoring.ts` — 103 LoC. v0.1 retrieval scoring (`combineScores`, `sigmoidBm25`, entity boost). **Pure retrieval scoring — separate concern from reflection scoring.**
- `src/local/schema.ts` — 96 LoC. Three tables (`memories`, `entities`, `history`). No reflection-related columns yet.
- `src/local/migrations/0000_crazy_mimic.sql` — v0.1 initial migration.
- `src/agent-tools/tools/reflect-handler.ts` + `reflect-schema.ts` — JSON-RPC tool wrapper from v0.3.
- **NO `ThresholdReflectionPolicy`, NO `SleepTimeReflectionPolicy`, NO `ScoringStrategy` DIP, NO `llm_importance_score`, NO `derived_from`, NO `kind` discriminator, NO `pending_reflection_count`.**

**Evidence motivating each ADR (verbatim citations from discovery blueprint):**

- **Blueprint D7** (sleep-time worker mechanism) — `croner` ADOPT (Q2 Rule 9 verdict): MIT, 0 transitive deps, 2.019M weekly downloads per [snapshot 7d70906d](../discoveries/snapshots/v0-4a-reflection-pipeline/7d70906d9b7f5cb8c667d4fbd94902f628ade780b540ab4d1fe9d7593516a7cc.md). `bullmq` REJECTED (Redis dep disqualifies local-default), `node-cron` DEFERRED (12mo stale).
- **Blueprint D8** (DB-backed counter) — Letta v1 `.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent.py:233-241` + v4 `.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py:138-146` use IDENTICAL `turns_counter % sleeptime_agent_frequency == 0` with DB-persisted counter via `group_manager.bump_turns_counter_async`.
- **Blueprint D9** (additive scoring) — Q7 [snapshot 67f8665b](../discoveries/snapshots/v0-4a-reflection-pipeline/67f8665b0897f704c9d0e91f0f75d2b96f9818a1e12813c6744f7fe2179e6947.md) extracts VERBATIM from `.claude/knowledge-base/references/joonspk-research/generative_agents` `retrieve.py:254-257`: weighted ADDITIVE sum with `gw = [0.5, 3, 2]`. **CLAUDE.md § Macro roadmap Item 5 attribution "multiplicative Generative Agents (recency × importance × relevance)" is FACTUALLY WRONG** — surfaced as F-claude-md-multiplicative-update followup (R5).
- **Blueprint D10** (derived_from JSONB column) — confirmed innovation per Q4 (`.claude/knowledge-base/references/letta/letta/services/summarizer/` 5 modes — none ships derived_from), Q5 (`.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py` — none), Q6 (`.claude/knowledge-base/references/mem0/mem0/memory/main.py` — none + grep zero hits), Q8 (`github.com/langchain-ai/langmem` README + conceptual_guide — explicit absence).
- **Blueprint D11** (LLM-importance cache) — CLAUDE.md Item 5 acceptance verbatim: "LLM-importance score persisted on first write; second-write same content does NOT re-invoke LLM."
- **Blueprint D12** (test pyramid) — Letta `.claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py:61-180` uses CONFIG-knob override (`sleeptime_agent_frequency: 2`) NOT clock mocking + `@pytest.mark.flaky(max_runs=3)` + REAL `time.sleep()`. EC-4 absorbed: NO `vi.useFakeTimers()` for `SleepTimeReflectionPolicy` integration.

**Compliance scope:**

- `architecture.md § 3` DIP — new policies that touch DB (`ThresholdReflectionPolicy` counter) live under `src/local/`, NOT `src/core/`. Pure interface declarations live under `src/core/dip/`. `src/cloud/` is OUT of v0.4a scope (deferred to v0.5 per CLAUDE.md Item 7).
- `architecture.md § 2` ADD-only — reflection produces NEW `memories` rows (`kind='derived'`), NEVER mutates existing memories. ADR-0003 holds.
- `testing.md` TDD pyramid — RED-GREEN-REFACTOR per task; integration tier uses real pgvector container; unit tier uses `vi.mock()` only on `LLM` DIP.
- `dogfood-golden-rule.md` — v0.4a stays `Planned` until shipped; no production-ready claim.
- `plan-confidence-golden-rule.md` — Coverage Matrix 100%; ADR alternatives mandatory; TDD RED-GREEN per task.
- `deps-audit-golden-rule.md` — `croner` declared explicitly in `## Dependencies` with version pin.

## Objective

The Goal is achieved when ALL sub-goals are checked AND the named integration test passes:

- [ ] New `ScoringStrategy` DIP added at `src/core/dip/scoring-strategy.ts` (6th DIP — does NOT touch ADR-0008's locked counts on existing 5 DIPs).
- [ ] `AdditiveWeightedScoring` impl at `src/core/scoring-strategies/additive-weighted-scoring.ts` parameterized by `{ recency, relevance, importance }` weights with min-max normalization to [0,1] BEFORE summation; default weights `{1,1,1}`; opt-in Generative-Agents-style weights `{0.5, 3, 2}` exposed as `GENERATIVE_AGENTS_WEIGHTS` constant.
- [ ] `ThresholdReflectionPolicy` at `src/local/reflection/threshold-reflection-policy.ts` implementing `ReflectionPolicy` from `src/core/dip/reflection-policy.ts` — `shouldReflect(scope, trigger)` returns `true` when `bumpAndGetCounter(scope) % threshold === 0`.
- [ ] `SleepTimeReflectionPolicy` at `src/local/reflection/sleep-time-reflection-policy.ts` implementing `ReflectionPolicy` — uses `croner` to fire periodically; `shouldReflect()` returns `true` when cron tick fires (`onReflectionEnd` resets the tick latch).
- [ ] Schema migration adds 3 columns to `memories` (`kind VARCHAR(20) NOT NULL DEFAULT 'extracted'`, `derived_from JSONB`, `llm_importance_score REAL`) + 1 new table `reflection_counters` (scope columns + count column) with CHECK constraint `kind = 'derived' IMPLIES jsonb_array_length(derived_from) >= 1`.
- [ ] New error type `ReflectionProvenanceMissingError` at `src/core/errors.ts` thrown when LLM produces a derived memory without identifiable sources.
- [ ] `Memory.reflect()` execution path implemented end-to-end producing higher-order memories with non-empty `derived_from`.
- [ ] LLM-importance cache: hash-keyed lookup before `LLM.generate()` invocation; persisted on `llm_importance_score` column; second-write same content does NOT re-invoke LLM (assertion: mock LLM call count == 1 across two identical writes).
- [ ] Acceptance integration test at `tests/integration/reflection/threshold-policy.test.ts` passes against real `ankane/pgvector:v0.5.1`: seed 50 memories → `reflect()` → assert ≥ 1 memory has `kind='derived'` AND `derived_from.length >= 1`.
- [ ] Full integration validation chain passes: `npm test`, `npm run typecheck`, `npm run lint`, coverage gate ≥ 90% on changed files / 100% critical paths.

## ADRs

Architecture Decision Records. Each gets an ID, decision, rationale (citing rules + blueprint findings), alternatives (with rejection reasons), and consequences.

### D1 — Inherit blueprint ADRs D7-D12 by reference; this plan extends them

**Decision:** Plan ADRs D2-D11 below are EXTENSIONS of blueprint ADRs D7-D12 with implementation-specific detail. The blueprint ADRs frame the WHAT; the plan ADRs lock the HOW.

**Rationale:** `cycle-discover.md` chain establishes that blueprints carry decisions that EMERGED from evidence; `cycle-plan.md` consumes those and adds task-level locks. Honest separation of concerns. Per `architecture.md` § "ADRs justify decisions" — the blueprint already justifies the WHAT against `.claude/knowledge-base/references/` evidence; this plan justifies the HOW against `architecture.md` + `testing.md` + existing v0.1 patterns.

**Alternatives considered:**

- (A) Copy blueprint ADRs D7-D12 verbatim into this plan — REJECTED: duplication; would force re-justification on every plan edit
- (B) Reference blueprint by file path only with no per-decision inheritance — REJECTED: too thin; plan-confidence checker wants ADR rationale visible
- (C) Selected: blueprint ADRs are referenced by ID (D7-D12) wherever a plan task derives from them; plan ADRs (D2-D11) add HOW-level locks

**Consequences:**

- Plan ADR section is concise (focused on implementation choices); blueprint provides upstream context
- `/edge-case-plan` must surface edges that override D7-D12 — if so, plan ADRs MUST cite the override + rationale
- `/plan-confidence` ADR check counts plan-side ADRs (D2-D11 = 10) — sufficient for the band (≥1 required)

### D2 — `ScoringStrategy` is a NEW 6th DIP at `src/core/dip/scoring-strategy.ts`

**Decision:** Add new file `src/core/dip/scoring-strategy.ts` declaring `ScoringStrategy` interface with ONE required method `score(memory, query, now, weights) → number` returning a normalized score in `[0, 1]`. The DIP is INDEPENDENT of the existing 5 DIPs (`Embedder`, `LLM`, `VectorStore`, `HistoryManager`, `ReflectionPolicy`); ADR-0008's locked method counts on those 5 are NOT modified.

**Rationale (cites blueprint D9 + `architecture.md § 3` DIP):**

- v0.4a needs scoring logic distinct from v0.1's `src/core/scoring.ts` (which is retrieval-only: semantic + BM25 + entity boost). Reflection scoring is a different concern: WHICH memories to LIFT to higher-order. Mixing the two in `scoring.ts` would violate SRP.
- Per `architecture.md § 3`, abstractions go in `src/core/dip/`; concrete implementations go in `src/core/scoring-strategies/` (pure logic) OR `src/local/scoring-strategies/` (DB-touching).

**Alternatives considered:**

- (A) Add `score()` to existing `ReflectionPolicy` DIP — REJECTED: violates ISP (interface segregation). Policies decide WHEN; strategies decide HOW. They have different cardinality (many policies → 1 strategy is common; not the inverse).
- (B) Put scoring as a static utility module without a DIP — REJECTED: blocks testability per `architecture.md § 3` last paragraph ("testes são cidadãos de primeira classe: DIP facilita testes unitários isolados").
- (C) Selected: new DIP with 1 method, minimal surface, swappable.

**Consequences:**

- `Memory` constructor accepts optional `scoringStrategy?: ScoringStrategy` defaulting to a `AdditiveWeightedScoring` instance with `{1,1,1}` weights (Mem0-style equal).
- `recall()` API extended with optional `scoringWeights?` parameter (per ADR D5 below) — overrides constructor default for that call only.
- ADR-0008 method counts on the existing 5 DIPs remain locked. `ScoringStrategy` is the FIRST new DIP since v0.0; document it in T1.1 as adding to the "DIP inventory" without renumbering.

### D3 — `AdditiveWeightedScoring` is the ONLY shipped strategy at v0.4a; "multiplicative" is REJECTED

**Decision:** Ship ONE implementation `AdditiveWeightedScoring` in `src/core/scoring-strategies/additive-weighted-scoring.ts`. Default constructor takes `{ recency: 1, relevance: 1, importance: 1 }` (Mem0-style equal weights). Export `GENERATIVE_AGENTS_WEIGHTS = { recency: 0.5, relevance: 3, importance: 2 }` constant for opt-in use per blueprint D9 verbatim from `retrieve.py:252-253`. Each dimension is min-max normalized to `[0, 1]` BEFORE the weighted sum (verbatim from `retrieve.py:226-240`). The result is clamped to `[0, 1]` for safety.

**Rationale (cites blueprint D9 + Q7 critical finding):**

- Q7's CRITICAL FINDING surfaces that CLAUDE.md § Macro roadmap Item 5 attribution "multiplicative Generative Agents" is **factually wrong** — the paper's reference implementation at `github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py:254-257` does ADDITIVE weighted sum. No paper found by Q7's WebSearch ships a verifiable multiplicative formula. Implementing "multiplicative" would require fabrication, violating Inquebrável Rule 3.
- CLAUDE.md Item 5 acceptance still says "Both scoring strategies pass identical recall-shape contract test (interface compliance)". The contract is satisfied by interpreting "two strategies" as "two weight configurations of the SAME implementation" — both `{1,1,1}` and `{0.5,3,2}` pass the same shape test (input shape, output type, range). No fabrication needed.
- Surface F-claude-md-multiplicative-update as part of the implementation cycle's CHANGELOG entry per blueprint R5.

**Alternatives considered:**

- (A) Ship TWO impls: `AdditiveMem0Strategy` + `MultiplicativeGenerativeAgentsStrategy` — REJECTED: the second one would be fabricated per Q7 evidence (Inquebrável Rule 3 violation)
- (B) Search literature for a paper that DOES ship multiplicative `r×i×rel` — REJECTED: speculative; blocks v0.4a kickoff on lit review
- (C) Drop the dual-strategy framing entirely; remove Generative-Agents weights — REJECTED: CLAUDE.md Item 5 explicitly references Generative-Agents; preserving the weight option preserves the spirit
- (D) Selected: ONE impl + TWO weight presets + CLAUDE.md update followup

**Consequences:**

- F-claude-md-multiplicative-update logged in Followups (R5 of blueprint)
- The "interface compliance" contract test (T1.2) parameterizes over BOTH weight presets to satisfy CLAUDE.md Item 5 acceptance literally
- Future "true multiplicative" strategy is non-breaking to add later (just another impl of `ScoringStrategy` DIP) if literature surfaces a verifiable paper

### D4 — Threshold counter persisted on NEW `reflection_counters` table; NOT on `memories`

**Decision:** Add new table `reflection_counters` in `src/local/schema.ts`:

```ts
{
  scope_user_id: text(),
  scope_session_id: text(),
  scope_agent_id: text(),
  count: integer().notNull().default(0),
  last_reset_at: timestamp().defaultNow(),
}
```

with a composite UNIQUE index on `(scope_user_id, scope_session_id, scope_agent_id)`. `ThresholdReflectionPolicy.shouldReflect(scope, trigger)` performs an atomic `INSERT ... ON CONFLICT ... DO UPDATE SET count = count + 1 RETURNING count` and returns `(count % threshold === 0)`.

**Rationale (cites blueprint D8 + `architecture.md § 2` ADD-only):**

- Per blueprint D8, counter MUST be DB-persisted (survives restarts + multi-instance; matches Letta `group_manager.bump_turns_counter_async` pattern).
- Putting the counter on `memories` would violate ADD-only: counter increments are UPDATEs, but `memories` rows are immutable post-write per ADR-0003. A SEPARATE counter table preserves the invariant.
- Atomic `INSERT ON CONFLICT ... RETURNING` avoids race conditions in multi-instance deployments (Postgres-native; no advisory lock needed at v0.4a single-instance, but the pattern is forward-compatible to v0.5 cloud).

**Alternatives considered:**

- (A) `pending_reflection_count INTEGER` column on a hypothetical `scopes` table (which does NOT exist yet) — REJECTED: introduces a new top-level concept ("scopes" as first-class entities); too much scope creep for v0.4a
- (B) Counter as a column on `memories` updated on every write — REJECTED: violates ADD-only (ADR-0003)
- (C) Counter in Redis — REJECTED: D7 disqualified Redis (no infra add)
- (D) Process-local counter — REJECTED: loses state per blueprint D8 rationale
- (E) Selected: dedicated `reflection_counters` table, atomic upsert

**Consequences:**

- New table requires Drizzle migration `0001_reflection_columns.sql` (T0.2 below)
- `ThresholdReflectionPolicy` lives in `src/local/reflection/` per `architecture.md § 3` (touches DB)
- The same table will hold counters for OTHER policy variants in future (e.g., a "byte-budget" policy would also need persisted state); reusable

### D5 — Per-recall `scoringWeights` parameter overrides constructor default

**Decision:** Extend `RecallOptions` (in `src/core/options.ts`) with optional `scoringWeights?: ScoringWeights` field. When provided, the `recall()` execution path uses these weights for THIS recall only; absence falls back to the `scoringStrategy` instance passed to the `Memory` constructor. The `reflect()` path always uses the constructor-default weights — reflection scoring is not per-call configurable at v0.4a (defer to v1.x if a use case emerges).

**Rationale:**

- Recall has many call sites with potentially different needs (a UI surface must want recency-heavy; a knowledge query must want relevance-heavy). Configurable per-call is honest flexibility.
- Reflection has a single semantic (consolidate over a scope) — per-call configurability adds complexity without a clear use case (YAGNI per `Inquebrável § 11`).

**Alternatives considered:**

- (A) Per-call weights for BOTH `recall()` and `reflect()` — REJECTED: YAGNI for reflect at v0.4a; revisit at v1.x
- (B) No per-call override; constructor default is the only knob — REJECTED: blocks consumers from experimenting with weights without re-instantiating
- (C) Selected: per-recall override; reflect uses constructor default

**Consequences:**

- `RecallOptions` type gains optional field; backward-compatible
- `reflect()` API does NOT gain a weights param; clean

### D6 — `kind: 'extracted' | 'derived'` discriminator on `memories` with CHECK constraint

**Decision:** Add `kind VARCHAR(20) NOT NULL DEFAULT 'extracted'` column to `memories` table with CHECK constraint:

```sql
CHECK (
  (kind = 'extracted' AND derived_from IS NULL)
  OR
  (kind = 'derived' AND jsonb_array_length(derived_from) >= 1)
)
```

V0.1 rows backfill as `kind='extracted'` via the migration's `DEFAULT 'extracted'`. New higher-order memories produced by `Memory.reflect()` are written with `kind='derived'` and a non-empty `derived_from` array. Recall API can filter via `RecallOptions.kind?: 'extracted' | 'derived' | 'any'` (defaults to `'any'`).

**Rationale (cites blueprint D10):**

- Per blueprint D10, provenance is MANDATORY on derived memories. The CHECK constraint enforces at the DB level — defense in depth (TypeScript validation can be bypassed; DB constraint cannot).
- Discriminator enables recall filtering: a consumer wanting only consolidated higher-order memories can opt in.

**Alternatives considered:**

- (A) No `kind` column; rely on `derived_from IS NOT NULL` as the discriminator — REJECTED: less explicit; harder to query/index; CHECK constraint becomes uglier
- (B) Separate `derived_memories` table — REJECTED: doubles the JOIN cost on recall (which already joins `entities` for entity-boost)
- (C) Selected: column + CHECK constraint + recall filter option

**Consequences:**

- Drizzle migration adds the column with default backfill (T0.2)
- `RecallOptions.kind?` added per `architecture.md § 1` three-tier scope pattern (optional discriminator)
- The migration is forward-compatible: v0.1 rows automatically become `kind='extracted'`

### D7 — `ReflectionProvenanceMissingError` is a `fail-fast` invariant, NOT a soft warning

**Decision:** When `Memory.reflect()`'s LLM call produces a derived memory but the LLM-extracted source-memory-IDs CANNOT be resolved to actual `memories.id` values in the scope, throw `ReflectionProvenanceMissingError` IMMEDIATELY without persisting. Error includes the unresolvable IDs + the LLM raw response for debugging. The reflection cycle aborts; no partial state.

**Rationale (cites blueprint D10 + Inquebrável Rule 3):**

- Silently persisting a derived memory with empty `derived_from` would defeat the entire point of the provenance invariant. `Fail-fast` surfaces the bug (LLM hallucinated IDs, or scope is wrong).
- The CHECK constraint on the DB would block the INSERT anyway; throwing at the application layer surfaces a better error message (with raw LLM context) than a Postgres CHECK violation.

**Alternatives considered:**

- (A) Silent fallback: persist with `derived_from=[]` — REJECTED: defeats the invariant (Inquebrável Rule 3)
- (B) Re-call LLM with a "fix the provenance" prompt — REJECTED: scope creep; adds another LLM call to an already-async path; YAGNI
- (C) Selected: throw `fail-fast` with diagnostic context

**Consequences:**

- New error class `ReflectionProvenanceMissingError` in `src/core/errors.ts`
- Integration tests in T6.1 explicitly test this error path (mock LLM returns derived memory with non-existent source IDs → error thrown, NO row persisted)

### D8 — LLM-importance cache keyed by content hash; persistent column on `memories`

**Decision:** Add `llm_importance_score REAL` column to `memories` (nullable; populated when policy says to score). Lookup at write-time: if a memory with the same content hash (already indexed via v0.1's `memories_hash_unique_idx`) has a non-NULL `llm_importance_score`, REUSE that value WITHOUT invoking the LLM. New writes for content not in the cache compute the score once and persist.

**Rationale (cites blueprint D11 + CLAUDE.md Item 5 verbatim):**

- CLAUDE.md Item 5 acceptance verbatim: "LLM-importance score persisted on first write; second-write same content does NOT re-invoke LLM."
- v0.1 already indexes hash (UNIQUE). v0.4a piggybacks: cache hit = lookup row by hash; cache miss = invoke LLM + persist score.

**Alternatives considered:**

- (A) Separate `importance_scores` cache table keyed by hash — REJECTED: redundant with the existing hash index on `memories`
- (B) In-memory LRU — REJECTED: doesn't survive restarts; defeats CLAUDE.md acceptance
- (C) TTL-based invalidation — REJECTED: content hash deterministically maps to importance; no TTL needed (YAGNI)
- (D) Selected: persistent column + hash-indexed lookup

**Consequences:**

- Drizzle migration adds `llm_importance_score REAL` (nullable) to `memories`
- Cache lookup is a free piggyback on existing index — zero query-plan regression
- The `LLM` DIP is NOT touched (ADR-0008 method count holds); the cache lives ABOVE the DIP in `Memory.remember()`'s write path

### D9 — Test pyramid: vitest config-knob threshold override (NOT clock mocking) per Letta EC-4 precedent

**Decision:** Integration tests for both `ThresholdReflectionPolicy` and `SleepTimeReflectionPolicy` use **CONFIG-knob** trigger override, NOT `vi.useFakeTimers()`. Concretely:

- `ThresholdReflectionPolicy`: tests instantiate with `threshold: 2` (or whatever small N) and write N memories; reflection fires naturally on the N-th. No timers involved.
- `SleepTimeReflectionPolicy`: tests use a cron expression that fires every second (`"* * * * * *"` 6-field syntax) and `await sleep(1500)` between assertions. Tests are marked with vitest `retry: 3` to absorb real-timer jitter (matching `.claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py:61` `@pytest.mark.flaky(max_runs=3)`).

**Rationale (cites blueprint D12 + EC-4):**

- Letta deliberately AVOIDED `freezegun` for sleep-time integration tests (Q1 finding). The CONFIG-knob pattern is the proven discipline.
- `vi.useFakeTimers()` introduces a global side effect that pollutes the rest of the test file; cron-fire integration is hard to reason about under fake time.

**Alternatives considered:**

- (A) `vi.useFakeTimers()` + advance-clock — REJECTED per EC-4 Letta verbatim
- (B) Mock `croner` entirely + manually invoke the callback — REJECTED: tests the mock, not the integration with croner
- (C) Selected: real timers + small config + retry

**Consequences:**

- vitest config: `pool: 'forks'` + per-test `retry: 3` on integration sleep-time tests (avoid event-loop pollution)
- Tests are slightly slower (~2s per sleep-time integration test) — acceptable trade-off
- Edge-case absorption EC-4 + EC-6 from discovery edge-case review

### D10 — `croner` declared as RUNTIME dep with exact version pin per deps-audit-golden-rule

**Decision:** `package.json:dependencies` gains `"croner": "^10.0.1"` (matching the GitHub snapshot's `Latest Release 10.0.1`). The dep is RUNTIME (NOT devDependencies) since `SleepTimeReflectionPolicy` is a public-facing impl in `@usetheo/memory/local` consumers must opt into. Allowlist entries: NONE (no CVEs known at scoring time per `/deps-audit`).

**Rationale:**

- Per `deps-audit-golden-rule.md` § "NEVER list a NEW dep without naming the rejected alternatives" — Q2 Rule 9 verdict block already covered this (croner vs bullmq vs node-cron vs setTimeout); the plan inherits.
- `^10.0.1` allows patch + minor upgrades; major bumps require a new evaluation (croner has been pre-10.x in the past; 10.0 was a major bump).

**Alternatives considered:**

- (A) `~10.0.1` (patch-only) — REJECTED: too restrictive; misses minor improvements
- (B) `=10.0.1` (exact) — REJECTED: misses security patches
- (C) Selected: `^10.0.1`

**Consequences:**

- `package.json` diff at T0.1
- `/deps-audit v0-4a-reflection-pipeline` re-run will record the new dep with PASS verdict (assuming no CVEs)

### D11 — Reflection LLM prompt prepends "you are reviewing memories" framing per Letta v4 precedent

**Decision:** The reflection LLM prompt template in `src/core/reflection/prompt.ts` prepends a system-reminder block adapted from Letta v4 `sleeptime_multi_agent_v4.py:233-244`:

```
You are a reflection helper for a memory system. You are reviewing memories from a single scope ({scope identifier}) that have accumulated over time.

Your task: produce ZERO OR MORE higher-order memories that synthesize patterns or insights across the source memories. Each output MUST be linked to AT LEAST ONE source memory ID from the input — invent NO ids.

Output format: JSON array of {text: string, derived_from: string[]} objects. If no consolidation is possible, return [].
```

The actual `{scope identifier}` substitution uses the scope key (`user:<id>`, `session:<id>`, `agent:<id>`) for clarity.

**Rationale (cites blueprint D11 + Q5 finding):**

- Letta's v4 system-reminder explicitly tells the LLM its role + memory management responsibility. Prevents the LLM from acting as if it's the primary agent.
- The "invent NO ids" instruction is critical for D7 (provenance `fail-fast`) — reduces the LLM hallucination rate on source IDs.

**Alternatives considered:**

- (A) Single-line prompt "Summarize these memories" — REJECTED: too thin; LLM will not know its role
- (B) Borrow Letta v4 prompt verbatim — REJECTED: Letta's prompt is conversation-shaped ("messages labeled assistant are from the primary agent"); TheMemory has no agent abstraction. Adapt the SPIRIT, not the literal text.
- (C) Selected: adapted prompt with explicit role + format + provenance discipline

**Consequences:**

- Prompt lives in `src/core/reflection/prompt.ts` (pure module, no DB / no DIP dependencies)
- Prompt versioning: a `PROMPT_VERSION = '1.0'` constant is exported; future changes bump it; integration tests can pin a specific version if needed

## Dependency Graph

```
                T0.1 (add croner dep)
                  │
                  ▼
                T0.2 (schema migration: kind + derived_from + llm_importance_score + reflection_counters)
                  │
                  ├──────────────────┬──────────────────┐
                  │                  │                  │
                  ▼                  ▼                  ▼
              T1.1 (DIP)        T2.1 (Threshold     T5.1 (LLM-importance
                  │              policy + counter)   schema-side hook)
                  ▼                  │                  │
              T1.2 (Additive          ▼                  ▼
              scoring impl)      T3.1 (SleepTime     T5.2 (cache lookup
                  │              policy + croner)    in remember path)
                  │                  │                  │
                  └──────┬───────────┘                  │
                         ▼                              │
                  T4.1 (reflect() prompt + LLM call)    │
                         │                              │
                         ▼                              │
                  T4.2 (provenance validation +         │
                       ReflectionProvenanceMissingError)│
                         │                              │
                         ▼                              │
                  T4.3 (persist with derived_from)      │
                         │                              │
                         └─────────────────┬────────────┘
                                           ▼
                                     T6.1 (THE GOAL TEST —
                                     50 memories + reflect()
                                     + assert derived_from)
                                           │
                                           ▼
                                     T7.1 (Integration Validation —
                                     full chain + wiring triad)
```

**Parallelization opportunities:** T1.1/T1.2 (scoring DIP) is independent of T2.1/T3.1 (policies) — can run in parallel after T0.2. T5.1/T5.2 (LLM-importance cache) is independent of policy work after T0.2. T4.x reflection-execution chain is SEQUENTIAL (T4.1 → T4.2 → T4.3) but only blocks T6.1.

---

## Phase T0: Pre-flight + schema

**Objective:** Lay foundations — `croner` dep added, Drizzle migration applied with all v0.4a schema additions.

### T0.1 — Add `croner` runtime dependency

#### Objective

Declare `croner ^10.0.1` in `package.json:dependencies` per blueprint D7 + plan D10. Update lockfile via `npm install`. Confirm `/deps-audit` would PASS post-install.

#### Evidence

Blueprint D7 Rule 9 verdict ADOPT for `croner` (`github.com/Hexagon/croner`, MIT, 0 transitive deps, 2.019M weekly DLs per snapshot `7d70906d`). Plan D10 above pins to `^10.0.1`.

#### Files to edit

- `package.json` — add `"croner": "^10.0.1"` under `"dependencies"`
- `package-lock.json` — regenerated by `npm install`

#### Deep file dependency analysis

- `package.json` is the single source of truth for declared deps. v0.3 added `@modelcontextprotocol/sdk` + `zod-to-json-schema`; v0.4a adds `croner`.
- No `peerDependencies` change needed (croner is pure runtime).
- No tsconfig change needed (croner ships types).

#### TDD

- **RED:** Write `tests/unit/deps/croner-import.test.ts` — imports `Cron` from `croner` and instantiates with `'* * * * *'` cron expression; asserts the instance has a `.stop()` method.
- **GREEN:** Add the dep + run `npm install`. Test passes.
- **REFACTOR:** N/A (single import test).

#### Acceptance criteria

- [ ] `package.json` `dependencies.croner` = `"^10.0.1"`
- [ ] `npm install` succeeds without lockfile conflicts
- [ ] `tests/unit/deps/croner-import.test.ts` passes
- [ ] `/deps-audit` re-run records `croner` with PASS verdict (no CVEs)

#### DoD

```bash
grep '"croner":' package.json | grep '\^10.0.1'  # exits 0
npm install                                       # lockfile updated
npm test -- tests/unit/deps/croner-import.test.ts # passes
```

### T0.2 — Drizzle migration: `0001_reflection_columns.sql`

#### Objective

Add to `memories`: `kind VARCHAR(20) NOT NULL DEFAULT 'extracted'`, `derived_from JSONB` (nullable), `llm_importance_score REAL` (nullable). Add CHECK constraint: `(kind='extracted' AND derived_from IS NULL) OR (kind='derived' AND jsonb_array_length(derived_from) >= 1)`. Add new table `reflection_counters` with composite-unique scope index, **`count BIGINT NOT NULL DEFAULT 0`** (EC-2 absorption — `integer` would overflow at 2.1B writes), and **CHECK constraint forbidding all-NULL scope rows** (EC-3 absorption — Postgres NULL UNIQUE semantics would otherwise create unbounded counter rows for all-NULL scope, defeating threshold modular arithmetic).

#### Evidence

Plan ADRs D4 + D6 + D8 lock these columns. Blueprint D10 + D11 + EC-1 + EC-2 from discovery confirm the structure.

#### Files to edit

- `src/local/schema.ts` — extend `memories` table definition + add `reflectionCounters` table (NEW)
- `src/local/migrations/0001_reflection_columns.sql` (NEW) — generated by `drizzle-kit generate`; manually augmented with CHECK constraint (Drizzle does not emit CHECK; add via raw SQL block at end of migration)
- `src/local/migrations/meta/_journal.json` — bumped by drizzle-kit

#### Deep file dependency analysis

- `src/local/schema.ts:96` is the existing schema file. Three tables defined: `memories`, `entities`, `history`. Adding columns to `memories` + a new table is additive; no breaking change to existing v0.1 code paths.
- v0.1 rows automatically get `kind='extracted'` via the `DEFAULT 'extracted'` clause.
- CHECK constraint on `memories` is NEW — pgvector v0.5.1 supports it (standard Postgres CHECK).
- New table `reflection_counters` does NOT have a vector column; no HNSW index needed.

#### TDD

- **RED:** Write `src/local/__tests__/schema-v0-4a.test.ts` — uses Drizzle introspection to assert the 3 new columns + the new table + the CHECK constraint name. Also asserts that inserting a `kind='derived'` row with `derived_from=null` raises a Postgres ERROR (CHECK violation). Test fails because schema is unchanged.
- **GREEN:** Update `schema.ts` + run `npm run drizzle-kit:generate`; manually splice the CHECK constraint into the generated SQL. Run `drizzle-kit push` (or migration apply via the v0.1 helper). Test passes.
- **REFACTOR:** Verify the generated SQL is idiomatic + matches the schema definition; trim any unused boilerplate from the migration.

#### Acceptance criteria

- [ ] `src/local/schema.ts` has `kind`, `derivedFrom`, `llmImportanceScore` columns on `memories`
- [ ] `src/local/schema.ts` has new `reflectionCounters` table with composite-unique scope index AND `count: bigint({ mode: 'number' })` column (EC-2)
- [ ] `reflection_counters` table has CHECK constraint `reflection_counters_scope_not_all_null_check` rejecting rows where all 3 scope columns are NULL (EC-3)
- [ ] Migration `0001_reflection_columns.sql` applies cleanly against a fresh `ankane/pgvector:v0.5.1` container AND against a v0.1-populated container (backfill works)
- [ ] CHECK constraint named `memories_kind_derived_from_check` exists in the DB
- [ ] Schema test `src/local/__tests__/schema-v0-4a.test.ts` passes
- [ ] **v1.1 EC-10 test:** `src/local/__tests__/migrations/0001-ordering.test.ts` — populate a fresh pgvector container with 100 v0.1 memories first; THEN apply `0001_reflection_columns.sql`; assert (a) all v0.1 rows have `kind='extracted'` post-migration (DEFAULT applied BEFORE CHECK), (b) CHECK constraint creates AFTER the DEFAULT backfill (no `ERROR: check constraint violated by some row` during apply).
- [ ] No regression on v0.1 schema tests (`src/local/__tests__/schema.test.ts`)

#### DoD

```bash
npm run drizzle-kit:generate                # generates the migration
psql $LETTA_PG_URI -f src/local/migrations/0001_reflection_columns.sql  # applies
npm test -- src/local/__tests__/schema-v0-4a.test.ts             # passes
npm test -- src/local/__tests__/migrations/0001-ordering.test.ts # passes (EC-10)
npm test -- src/local/__tests__/schema.test.ts                   # v0.1 tests still pass
```

---

## Phase T1: ScoringStrategy DIP + Additive impl

**Objective:** Add `ScoringStrategy` interface to `src/core/dip/` + ship `AdditiveWeightedScoring` impl with default + Generative-Agents weight presets.

### T1.1 — `ScoringStrategy` interface at `src/core/dip/scoring-strategy.ts`

#### Objective

Declare the new 6th DIP per plan D2. Interface has ONE method `score(args) → number` returning normalized `[0, 1]`. Export the `ScoringWeights` type. Document that this is INDEPENDENT of ADR-0008's locked 5 DIPs.

#### Evidence

Plan D2 + blueprint D9.

#### Files to edit

- `src/core/dip/scoring-strategy.ts` (NEW)
- `src/core/dip/__tests__/scoring-strategy.test-d.ts` (NEW — type-only contract test mirroring `reflection-policy.test-d.ts`)
- `src/core/dip/index.ts` (if exists; else create) — re-export the new DIP

#### Deep file dependency analysis

- `src/core/dip/` currently has 5 files (per `architecture.md § 3` listing): embedder, history-manager, llm, reflection-policy, vector-store. Adding `scoring-strategy.ts` makes 6.
- The DIP has zero runtime dependencies (pure type declaration). Imports only from `src/core/{scope, memory-item}.ts` for the input shape.

#### TDD

- **RED:** `scoring-strategy.test-d.ts` declares a type-level conformance check: any class that claims to implement `ScoringStrategy` MUST have the `score` method with the documented signature. Test fails because the file doesn't exist.
- **GREEN:** Author the interface file. Type-test passes.
- **REFACTOR:** Add JSDoc citing plan D2 + blueprint D9 evidence.

#### Acceptance criteria

- [ ] `src/core/dip/scoring-strategy.ts` exports `ScoringStrategy` interface + `ScoringWeights` type
- [ ] Interface method signature matches plan D2 ADR
- [ ] `scoring-strategy.test-d.ts` passes
- [ ] `tsc --noEmit src/core/dip/scoring-strategy.ts` succeeds
- [ ] No `any` types introduced (per `architecture.md § Module hygiene`)

#### DoD

```bash
npm run typecheck                           # passes
npm test -- src/core/dip/__tests__/scoring-strategy.test-d.ts  # passes
```

### T1.2 — `AdditiveWeightedScoring` impl + interface compliance contract test

#### Objective

Ship `src/core/scoring-strategies/additive-weighted-scoring.ts` implementing `ScoringStrategy` with min-max normalization + weighted sum + `[0, 1]` clamping. Export `GENERATIVE_AGENTS_WEIGHTS` constant. Add contract test parameterized over both weight presets per CLAUDE.md Item 5 acceptance "Both scoring strategies pass identical recall-shape contract test".

#### Evidence

Plan D3 + blueprint D9 verbatim formula from `retrieve.py:254-257`.

#### Files to edit

- `src/core/scoring-strategies/additive-weighted-scoring.ts` (NEW)
- `src/core/scoring-strategies/index.ts` (NEW) — barrel export
- `src/core/__tests__/scoring-strategies/additive-weighted-scoring.test.ts` (NEW)
- `src/core/__tests__/scoring-strategies/scoring-contract.test.ts` (NEW — parameterized over both presets)

#### Deep file dependency analysis

- New directory `src/core/scoring-strategies/` — sibling of existing `src/core/scoring.ts` (which stays untouched per plan D2 SRP — retrieval scoring is separate).
- The impl imports only from `src/core/dip/scoring-strategy.ts` + `src/core/memory-item.ts` (input shape). No DB / no LLM / pure logic.
- File size: ~80-120 LoC budget; well under 500 LoC per `architecture.md § Module hygiene`.

#### TDD

- **RED:** Write the unit test asserting:
  - With weights `{1,1,1}` and three input scores `{recency:1, relevance:1, importance:1}`, returns `1.0` (max possible normalized).
  - With weights `{0.5, 3, 2}` and same inputs, returns `(1×0.5 + 1×3 + 1×2) / (0.5+3+2) = 5.5/5.5 = 1.0` (normalized).
  - Min-max normalization is applied BEFORE the weighted sum (verify by passing pre-min-max raw values and checking the implementation handles it).
  - Clamping: an input score >1 (pathological) gets clamped to 1 BEFORE summation.
  - **v1.1 EC-1 RED case:** `new AdditiveWeightedScoring({ recency: 0, relevance: 0, importance: 0 })` throws `InvalidScoringWeightsError` (NEW class in `src/core/errors.ts` with `.providedWeights: ScoringWeights` field) — assert the error type AND that the message mentions "at least one weight must be > 0".
  - **v1.1 EC-8 RED case:** `test_additive_weighted_scoring_handles_zero_variance` — score N memories where all 3 dimensions return identical values per memory (e.g., all recency=0.5, all relevance=0.5, all importance=0.5). Min-max normalization with min==max must NOT divide by zero. Assert: no NaN in output; all final scores equal a stable value (when min==max the normalized component is defined as `0.5` — neutral; document this choice in JSDoc).
- Write contract test parameterized over `[{1,1,1}, GENERATIVE_AGENTS_WEIGHTS]` asserting both return values in `[0, 1]` for identical input shapes.
- Tests fail because impl doesn't exist.
- **GREEN:** Implement the strategy. All tests pass.
- **REFACTOR:** Extract min-max normalization to a private helper if it grows beyond 3 lines; ensure no `any` types. The `_normalize(scores)` helper handles the `min === max` case by returning `scores.map(() => 0.5)`.

#### Acceptance criteria

- [ ] `additive-weighted-scoring.ts` exports `AdditiveWeightedScoring` class + `GENERATIVE_AGENTS_WEIGHTS` constant
- [ ] Default constructor weights are `{ recency: 1, relevance: 1, importance: 1 }`
- [ ] `GENERATIVE_AGENTS_WEIGHTS = { recency: 0.5, relevance: 3, importance: 2 }` matches blueprint D9 verbatim from `retrieve.py:252-253`
- [ ] **v1.1 EC-1:** Constructor throws `InvalidScoringWeightsError` (NEW class in `src/core/errors.ts`) when all 3 weights sum to 0
- [ ] **v1.1 EC-8:** Min-max normalization handles `min === max` case without NaN (returns 0.5 for all entries; documented in JSDoc)
- [ ] Unit test passes for both presets + EC-1 + EC-8 sad paths
- [ ] Contract test (parameterized) passes — CLAUDE.md Item 5 acceptance "Both scoring strategies pass identical recall-shape contract test" satisfied
- [ ] File LoC under 200 (target ~100)
- [ ] No `any` types

#### DoD

```bash
npm test -- src/core/__tests__/scoring-strategies/
npm run typecheck
wc -l src/core/scoring-strategies/additive-weighted-scoring.ts  # ≤ 200
```

---

## Phase T2: `ThresholdReflectionPolicy` + DB counter

**Objective:** Ship `ThresholdReflectionPolicy` with atomic DB-backed counter.

### T2.1 — `ThresholdReflectionPolicy` impl + counter integration

#### Objective

Ship `src/local/reflection/threshold-reflection-policy.ts` implementing `ReflectionPolicy` from `src/core/dip/reflection-policy.ts`. Constructor takes `{ threshold: number, store: PgvectorStore }`. `shouldReflect(scope, trigger)` performs atomic `INSERT ... ON CONFLICT ... DO UPDATE SET count = reflection_counters.count + 1 RETURNING count`. Returns `(count % threshold === 0)`.

#### Evidence

Plan D4 + blueprint D8 — Letta `.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py:138-146` counter-modular pattern.

#### Files to edit

- `src/local/reflection/threshold-reflection-policy.ts` (NEW)
- `src/local/reflection/index.ts` (NEW barrel)
- `src/local/__tests__/reflection/threshold-policy.test.ts` (NEW unit + integration)
- `src/local/index.ts` — re-export

#### Deep file dependency analysis

- Lives in `src/local/` per `architecture.md § 3` (touches DB; cannot be in `src/core/`).
- Constructor injection of `PgvectorStore` (not raw `pg` client) preserves DIP: policy uses the v0.1 store abstraction.
- The atomic upsert needs a new `PgvectorStore.bumpReflectionCounter(scope) → Promise<number>` method — add to the store in this task.

#### TDD

- **RED:** Integration test (real pgvector container):
  - Setup: `threshold: 3`, fresh scope.
  - Call `shouldReflect(scope, ...)` three times in a row.
  - Assert: returns are `false, false, true` (the 3rd call returns true because `3 % 3 === 0`).
  - Reset scope. Call once. Asserts `false` (1 % 3 ≠ 0). Call twice more. Assert `false, true`.
  - Verify DB state: `reflection_counters` row for the scope has `count = 6` after 6 calls.
- Test fails because impl doesn't exist.
- **GREEN:** Implement the policy + the store helper method. Test passes.
- **REFACTOR:** Extract upsert SQL to a single Drizzle expression; ensure scope-tuple equality handles NULL columns correctly (Postgres NULL != NULL; use `IS NOT DISTINCT FROM` for the composite index).

#### Acceptance criteria

- [ ] `ThresholdReflectionPolicy` implements `ReflectionPolicy` (type-check passes)
- [ ] `shouldReflect()` returns `true` exactly when `count % threshold === 0`
- [ ] Counter is DB-persisted (survives a `Memory` instance teardown)
- [ ] Multi-scope isolation: counter for `user:a` is independent of counter for `user:b`
- [ ] **v1.1 EC-3 update:** All-NULL scope rejected upstream (counter table's CHECK constraint from T0.2 fires); test asserts `shouldReflect(scope: {})` throws an explicit error message (NOT a Postgres CHECK violation surfaced raw to the consumer — wrap with `EmptyScopeError` adjacent to other `src/core/errors.ts` types)
- [ ] Partial-NULL scope rows handled via `IS NOT DISTINCT FROM` (test: two `shouldReflect` calls with `{userId: 'a', sessionId: null, agentId: null}` hit the SAME counter row)
- [ ] **v1.1 EC-2 verification:** counter `count` column is `bigint`; test asserts `count = 9_999_999_999` (10 billion, way above 32-bit max) persists + retrieves correctly
- [ ] Integration test passes against `ankane/pgvector:v0.5.1`
- [ ] No race condition under concurrent writes (test: 10 parallel `shouldReflect` calls; verify `count = 10` at the end)
- [ ] **v1.1 EC-12 test:** `test_counter_state_when_reflect_throws` — set threshold=3, write 3 memories; intercept reflection task and force it to throw (mock LLM down). Assert: counter row has `count=3` (bumped despite failure); next write bumps to count=4; modular check `4 % 3 === 1` ≠ 0 → does NOT re-fire. Document in JSDoc: a failed `reflect()` does NOT auto-retry the SAME counter window. Consumer can invoke `memory.reflect(scope)` manually to retry.
- [ ] **v1.1 EC-12 documented behavior:** `shouldReflect()` is fire-and-forget from the policy's perspective — it bumps the counter as a SIDE EFFECT of being asked. The orchestrator (`Memory.remember()` write-path hook) is responsible for actually invoking `reflect()`. Failure of the reflection task does NOT roll back the counter increment.

#### DoD

```bash
npm test -- src/local/__tests__/reflection/threshold-policy.test.ts
npm run typecheck
```

---

## Phase T3: `SleepTimeReflectionPolicy` + `croner`

**Objective:** Ship `SleepTimeReflectionPolicy` using `croner` cron expressions; fire-and-forget reflection via `Promise.resolve().then()`.

### T3.1 — `SleepTimeReflectionPolicy` impl + cron lifecycle

#### Objective

Ship `src/local/reflection/sleep-time-reflection-policy.ts`. Constructor takes `{ cronExpression: string, memory: Memory, scope: Scope }`. **v1.1 EC-4 absorption:** constructor validates `cronExpression` IMMEDIATELY via `new Cron(cronExpression, { paused: true })` inside a try/catch — on throw, re-throw as `InvalidCronExpressionError` (NEW class in `src/core/errors.ts` with `.providedExpression: string`). Also reject `cronExpression === ''` early with the same error. Internally uses `croner.Cron(cronExpression, () => { this._tickPending = true })`. `shouldReflect()` returns `true` iff `_tickPending`, then resets the latch. `onReflectionEnd()` is a no-op (latch already reset by `shouldReflect`). The class exposes `start()` and `stop()` methods to control the cron lifecycle (consumer responsibility). **v1.1 EC-11 absorption:** `start()` is idempotent — tracks `this._started: boolean`; second `start()` is a no-op (with a `logger.warn` if a logger is configured).

**v1.1 EC-15 documentation:** croner v10.x evaluates cron expressions in the **Node process timezone** by default. For deterministic behavior in containerized deployments, consumers must set `process.env.TZ='UTC'` OR pass a `timezone` option to the policy. v0.4a does NOT expose the `timezone` option on the policy constructor (deferred to F-sleeptime-timezone-option followup; YAGNI for v0.4a single-instance dev).

#### Evidence

Plan D7 + blueprint D7 (`croner` ADOPT) + Q5 (Letta v4 fire-and-forget pattern `safe_create_task`).

#### Files to edit

- `src/local/reflection/sleep-time-reflection-policy.ts` (NEW)
- `src/local/__tests__/reflection/sleep-time-policy.test.ts` (NEW integration with real timers)
- `src/local/reflection/index.ts` — extend barrel

#### Deep file dependency analysis

- Lives in `src/local/` (uses `croner` which is a runtime concern); must arguably live in `src/core/` since `croner` is pure JS not DB-bound, but PUTTING IT IN `src/local/` keeps a clean rule: ALL reflection policy implementations live in `src/local/` (consistency over micro-purity).
- Public surface: class export + Memory composition (no new top-level subpath export).
- File size: ~80-120 LoC budget.

#### TDD

- **RED:** Integration test with real timers:
  - `cronExpression: '* * * * * *'` (every second; 6-field syntax)
  - Policy `start()`; await `sleep(1500)`.
  - Assert `shouldReflect()` returns `true` (a tick happened in the last 1.5s).
  - Call `shouldReflect()` immediately again: returns `false` (latch reset; no new tick yet).
  - Await another `sleep(1500)`. Assert next `shouldReflect()` returns `true`.
  - `stop()` the policy; assert no leaks (subsequent ticks ignored).
- Mark test with vitest `retry: 3` per plan D9.
- **GREEN:** Implement the policy. Test passes.
- **REFACTOR:** Ensure `stop()` is idempotent; consider exposing a `nextRun()` accessor for debugging.

#### Acceptance criteria

- [ ] `SleepTimeReflectionPolicy` implements `ReflectionPolicy`
- [ ] **v1.1 EC-4:** Constructor throws `InvalidCronExpressionError` for invalid OR empty cron expression — validated EAGERLY at construction (not lazily at start())
- [ ] `start()` registers a croner job; `stop()` unregisters
- [ ] **v1.1 EC-11:** `start()` is idempotent — calling `start()` twice without `stop()` in between registers only ONE croner job (track `this._started`); test `test_sleep_time_policy_start_twice_is_idempotent` asserts no leak
- [ ] `shouldReflect()` is true iff a tick fired since the last call; resets the latch
- [ ] Real-timer integration test passes (with `retry: 3` for jitter absorption)
- [ ] `stop()` idempotent
- [ ] No timer leaks (vitest detects unfinished tasks → fail)
- [ ] **v1.1 EC-15 doc:** JSDoc on the constructor explicitly documents the timezone caveat (croner default is Node process TZ; recommend `TZ=UTC` in containers)

#### DoD

```bash
npm test -- src/local/__tests__/reflection/sleep-time-policy.test.ts
```

---

## Phase T4: `Memory.reflect()` execution path

**Objective:** Wire the reflection LLM call + provenance validation + higher-order memory persist into a working `Memory.reflect(options)` pipeline.

### T4.1 — Reflection prompt builder + LLM call

#### Objective

Ship `src/core/reflection/prompt.ts` (prompt builder) + `src/core/reflection/execute.ts` (orchestrator that fetches source memories for the scope, builds the prompt per plan D11, calls `LLM.generate()`, parses the JSON response into typed `DerivedMemoryDraft[]`). **v1.1 EC-5 + EC-13 absorption:** `execute.ts` includes an empty-source short-circuit (returns `[]` without LLM call) AND treats a valid-JSON-empty-array LLM response as a success path (not an error). **v1.1 EC-18 documentation:** context-window overflow on huge source sets is NOT handled in v0.4a; see F-reflect-context-window-fallback in the Followups table.

#### Evidence

Plan D11 + blueprint D11 (Letta v4 system-reminder prompt pattern).

#### Files to edit

- `src/core/reflection/prompt.ts` (NEW)
- `src/core/reflection/execute.ts` (NEW)
- `src/core/reflection/types.ts` (NEW — `DerivedMemoryDraft`, `ReflectionExecuteContext`)
- `src/core/__tests__/reflection/prompt.test.ts` (NEW)
- `src/core/__tests__/reflection/execute.test.ts` (NEW with mocked LLM)

#### Deep file dependency analysis

- `src/core/reflection/` is a NEW directory under `src/core/`. Pure logic (no I/O); takes `LLM` + source memories as inputs.
- Imports from: `src/core/dip/llm.ts` (LLM DIP) + `src/core/memory-item.ts` + `src/core/scope.ts`.
- Output type `DerivedMemoryDraft` has shape `{ text: string, derived_from: string[] }` matching plan D11's prompt format.

#### TDD

- **RED:**
  - `prompt.test.ts`: assert the system message contains "you are a reflection helper" + the scope identifier substitution works + the "invent NO ids" instruction is present (per plan D11).
  - `execute.test.ts`: mock LLM to return canned JSON `[{text: "User prefers coffee", derived_from: ["mem-id-1", "mem-id-2"]}]`; call `executeReflection({llm, sourceMemories, scope})`; assert returned `DerivedMemoryDraft[]` matches.
  - Edge case: LLM returns malformed JSON → `execute()` throws `ReflectionLLMResponseError` (NEW error type — distinct from `ReflectionProvenanceMissingError`).
  - **v1.1 EC-5 RED case:** `executeReflection({sourceMemories: [], ...})` returns `[]` immediately WITHOUT calling the LLM. Spy on the mock LLM; assert `mockLLM.callCount === 0` after the call.
  - **v1.1 EC-13 RED case:** mock LLM returns valid JSON `[]` (empty array — LLM says "no consolidation possible"). Assert: NO error thrown, `executeReflection` returns `[]`, NO subsequent persist call.
- **GREEN:** Implement (with the empty-source short-circuit at the top of `executeReflection`).
- **REFACTOR:** Pull JSON parsing into a helper with explicit error variants.

#### Acceptance criteria

- [ ] `prompt.ts` exports `buildReflectionPrompt(scope, sourceMemories) → string`
- [ ] `execute.ts` exports `executeReflection(ctx) → Promise<DerivedMemoryDraft[]>`
- [ ] **v1.1 EC-5:** Empty source memories list short-circuits to `[]` WITHOUT LLM invocation; test asserts `mockLLM.callCount === 0`
- [ ] **v1.1 EC-13:** LLM returns valid `[]` is treated as success (no consolidation possible); `executeReflection` returns `[]`; no error thrown
- [ ] Mocked-LLM unit test passes for happy path + malformed-JSON error path + EC-5 + EC-13 paths
- [ ] No DB dependency (pure logic)
- [ ] PROMPT_VERSION = '1.0' constant exported

#### DoD

```bash
npm test -- src/core/__tests__/reflection/
npm run typecheck
```

### T4.2 — Provenance validation + `ReflectionProvenanceMissingError`

#### Objective

Ship `src/core/reflection/provenance.ts` (validator). Given a list of `DerivedMemoryDraft[]` and the list of source-memory IDs that were sent to the LLM, validate that EVERY draft's `derived_from` array contains ONLY IDs that were actually in the source set. Throw `ReflectionProvenanceMissingError` (NEW error class in `src/core/errors.ts`) when any draft has a `derived_from` referencing an unknown ID OR an empty array.

#### Evidence

Plan D7 + blueprint D10.

#### Files to edit

- `src/core/reflection/provenance.ts` (NEW)
- `src/core/errors.ts` — append `ReflectionProvenanceMissingError` class
- `src/core/__tests__/reflection/provenance.test.ts` (NEW)
- `src/core/__tests__/errors.test.ts` — extend existing test file to cover the new error class

#### Deep file dependency analysis

- `src/core/errors.ts` currently exports `BiTemporalNotSupportedLocally`, `MissingScopeError`, etc. (v0.1+v0.2 additions). Pattern: extend the same file with a new error class.
- `provenance.ts` imports only from `src/core/errors.ts` + the types from `reflection/types.ts`.

#### TDD

- **RED:**
  - Happy path: 2 drafts with `derived_from` containing only source-set IDs → no throw.
  - Sad path 1: 1 draft with `derived_from = []` → throws `ReflectionProvenanceMissingError` mentioning the offending draft.
  - Sad path 2: 1 draft with `derived_from = ["unknown-id"]` → throws (unknown ID is not in source set).
- **GREEN:** Implement.
- **REFACTOR:** Optimize the lookup to O(n) by pre-building a Set from source IDs.

#### Acceptance criteria

- [ ] `provenance.ts` exports `validateProvenance(drafts, sourceIds) → void` (throws on failure)
- [ ] `ReflectionProvenanceMissingError` exported from `src/core/errors.ts` with `unknownIds: string[]` field
- [ ] Unit tests cover happy + 2 sad paths
- [ ] Error message includes the unknown IDs for debugging
- [ ] **v1.1 EC-14 test:** `test_reflect_handles_concurrent_forget_during_reflection` — start a `reflect()` cycle; while LLM call is in-flight (mock with `await sleep(500)` delay), call `memory.forget(sourceId)` on one of the source memories. When persist runs, the derived memory's `derived_from` references a now-deleted row. **Document chosen behavior in JSDoc + assert in test:** TheMemory accepts stale links — provenance validation only checks IDs were in source set at FETCH time. NO FK constraint on `derived_from`. The stale-link acceptance matches Mem0's lack-of-FK pattern (Q6) and aligns with ADR-0003 ADD-only (forget creates a tombstone via t_invalid; original row + derived link both survive).

#### DoD

```bash
npm test -- src/core/__tests__/reflection/provenance.test.ts
npm test -- src/core/__tests__/errors.test.ts
```

### T4.3 — Persist higher-order memories with `derived_from`

#### Objective

Wire the validated `DerivedMemoryDraft[]` into the existing v0.1 write pipeline (`PgvectorStore.insert`). For each draft, generate UUID + embed text + persist row with `kind='derived'`, `derived_from=draft.derived_from`. Update `Memory.reflect()` (in `src/core/memory.ts`) to orchestrate the full path: fetch source memories → empty-source short-circuit (EC-5) → run policy.onReflectionStart → execute reflection → validate provenance → **wrap whole persist phase in `db.transaction(async (tx) => ...)` (EC-6)** → run policy.onReflectionEnd → return `ReflectionResult`. Also ship `Memory.flushReflections()` helper (EC-7) — tracks pending reflection promises via `private _pendingReflections: Set<Promise<void>>` field; `flushReflections()` returns `Promise.allSettled([...this._pendingReflections])` — **THE GOAL TEST (T6.1) depends on this helper.**

#### Evidence

Plan D6 (kind column) + plan D7 (provenance) + blueprint D10.

#### Files to edit

- `src/core/memory.ts` — extend `reflect()` method with full pipeline
- `src/local/pgvector-store.ts` — add `insertDerivedMemory(draft, scope)` method (uses new columns)
- `src/local/in-memory-store.ts` — mirror for parity
- `src/core/__tests__/memory/reflect.test.ts` (NEW)
- `src/local/__tests__/pgvector-store/insert-derived.test.ts` (NEW integration)

#### Deep file dependency analysis

- `Memory.reflect()` currently throws `ReflectionNotConfigured` per ADR-0005 if no policy injected. Extend: when policy IS configured, run the full pipeline.
- Store `insertDerivedMemory` writes `kind='derived'` + non-empty `derived_from` — DB CHECK constraint enforces (if Drizzle ORM bypassed, CHECK still blocks).
- Existing `PgvectorStore.insert` is used for `kind='extracted'` rows; the new method is a sibling, NOT a replacement.

#### TDD

- **RED:** Integration test against real pgvector:
  - Seed 5 source memories in scope `{user: 'alice'}`.
  - Mock LLM to return 1 draft: `{text: "Alice likes outdoor activities", derived_from: [id1, id3]}`.
  - Call `memory.reflect({scope: {user: 'alice'}})`.
  - Assert ReflectionResult contains `{derivedMemoriesCreated: 1}`.
  - Query DB directly: row exists with `kind='derived'`, `derived_from = [id1, id3]`, embedding non-null.
  - Sad path: same setup but LLM returns draft with `derived_from = []`. Assert `ReflectionProvenanceMissingError` thrown AND NO row persisted (rollback semantic via Drizzle `db.transaction()`).
  - **v1.1 EC-6 RED case:** mock LLM returns 3 drafts; force the EMBEDDING call to throw on the second draft (e.g., mock the `Embedder` DIP to throw on the 2nd invocation). Assert: `ReflectionResult` is NOT returned (error thrown); query DB → ZERO new `kind='derived'` rows (first draft also rolled back); orphan-free state.
  - **v1.1 EC-7 RED case:** `flushReflections()` resolves only AFTER all in-flight reflection promises complete. Test: trigger a reflection via threshold policy (sets `_pendingReflections.add(promise)`); call `await memory.flushReflections()`; assert the pending promise count is now 0 AND DB shows the persist completed.
  - **v1.1 EC-9 RED case:** `test_reflect_includes_derived_in_source_set` — seed 50 `kind='extracted'` memories; run `reflect()` once → produces 1 derived memory. Run `reflect()` AGAIN on same scope; verify the new source set INCLUDES the previously-derived memory (current behavior: ALL memories in scope are sources, no kind filter). Assert: CHECK constraint still passes; new derived's `derived_from` must reference the prior derived memory ID (transitive provenance is allowed). Document in JSDoc on `Memory.reflect()`: "Source set for reflection includes BOTH `kind='extracted'` AND `kind='derived'` memories — transitive provenance chains are allowed and audit-traceable via `derived_from` arrays."
- **GREEN:** Implement.
- **REFACTOR:** Confirm transactional integrity in code review — `db.transaction(async (tx) => { for each draft: tx.insert(...); if any throws → automatic rollback })` (Drizzle's transaction API auto-rolls on throw).

#### Acceptance criteria

- [ ] `Memory.reflect()` orchestrates the full pipeline (fetch → empty-source-short-circuit → onReflectionStart → execute → validate → transaction-wrapped persist → onReflectionEnd → return ReflectionResult)
- [ ] Higher-order memories persisted with `kind='derived'` + non-empty `derived_from`
- [ ] **v1.1 EC-6:** Transaction boundary locked via Drizzle `db.transaction()` — partial failure (any draft embedding/insert throws) rolls back ALL drafts in the cycle; integration test `test_reflect_partial_failure_rollback` asserts orphan-free state
- [ ] **v1.1 EC-7:** `Memory.flushReflections() → Promise<void>` exposed publicly; tracks pending reflection promises via private `_pendingReflections: Set<Promise<void>>`; resolves when all in-flight reflections settle (success OR failure); critical for THE GOAL TEST (T6.1) to deterministically observe completion
- [ ] **v1.1 EC-9:** Reflection-on-derived behavior documented — source set is unfiltered by kind; transitive provenance chains allowed; CHECK constraint still passes (jsonb_array_length(derived_from) >= 1 is kind-agnostic)
- [ ] `ReflectionProvenanceMissingError` rolls back partial state (no orphan rows) via the same transaction boundary
- [ ] Integration test passes against `ankane/pgvector:v0.5.1`
- [ ] `Memory.reflect()` returns `ReflectionResult` with the new field `derivedMemoriesCreated` (and optional `reason: 'no-source-memories' | 'no-consolidation'` when empty)

#### DoD

```bash
npm test -- src/core/__tests__/memory/reflect.test.ts
npm test -- src/local/__tests__/pgvector-store/insert-derived.test.ts
```

---

## Phase T5: LLM-importance cache

**Objective:** Hash-keyed LLM-importance score cache via the `memories.llm_importance_score` column. First-write computes + persists; second-write same content skips LLM.

### T5.1 — Importance scoring LLM call + cache write

#### Objective

Ship `src/core/reflection/importance.ts` — function `scoreImportance(text, llm) → Promise<number>` calling the LLM with a small prompt ("Rate the importance of this memory on a 1-10 scale; reply with just the number") and parsing the response. Cache the score on the `memories.llm_importance_score` column when persisting.

#### Evidence

Plan D8 + blueprint D11 + CLAUDE.md Item 5 acceptance verbatim.

#### Files to edit

- `src/core/reflection/importance.ts` (NEW)
- `src/core/__tests__/reflection/importance.test.ts` (NEW with mocked LLM)
- `src/local/pgvector-store.ts` — extend `insert()` to accept optional `llmImportanceScore` parameter; write to the new column
- `src/local/in-memory-store.ts` — mirror

#### Deep file dependency analysis

- `importance.ts` is pure logic (LLM input → number). Lives in `src/core/reflection/`.
- The `pgvector-store.insert()` already takes a `payload` object; adding an optional column write is additive.

#### TDD

- **RED:**
  - Unit: mock LLM returns `"7"` → `scoreImportance` returns `7`.
  - Unit: mock LLM returns `"approximately 8 out of 10"` → returns `8` (parser tolerates surrounding text).
  - Unit: mock LLM returns `"not a number"` → throws `ImportanceScoringError` (NEW error type).
  - Integration: insert memory with `llmImportanceScore: 5.5` → DB column matches.
- **GREEN:** Implement.
- **REFACTOR:** Extract the LLM prompt to a constant; document the parsing strategy.

#### Acceptance criteria

- [ ] `scoreImportance(text, llm)` returns a number in `[1, 10]` (clamped if needed)
- [ ] Parser handles "7", "7 out of 10", "Importance: 7" → 7
- [ ] Malformed responses throw `ImportanceScoringError` with the raw response in `.rawResponse`
- [ ] `pgvector-store.insert()` writes the column when provided
- [ ] Integration test confirms DB persistence

#### DoD

```bash
npm test -- src/core/__tests__/reflection/importance.test.ts
npm test -- src/local/__tests__/pgvector-store/insert-importance.test.ts
```

**v1.1 EC-16 doc:** JSDoc on `IMPORTANCE_PROMPT_VERSION = '1.0'` constant explicitly notes: "Cache invalidation on prompt version bump is OUT OF SCOPE for v0.4a. When `IMPORTANCE_PROMPT_VERSION` bumps in a future release, the release PR MUST include a migration `UPDATE memories SET llm_importance_score = NULL;` OR an explicit ADR explaining why the old scores are still acceptable." Tracked as F-importance-prompt-versioning followup.

### T5.2 — Cache lookup on write path

#### Objective

In `Memory.remember()` (or wherever the write path constructs the new memory row), before calling `scoreImportance`, query the existing `memories` table for a row with the same content hash AND non-NULL `llm_importance_score`. If found, REUSE that score; SKIP the LLM call. If not found, call `scoreImportance`, persist on the new row.

#### Evidence

Plan D8 + CLAUDE.md Item 5 verbatim: "LLM-importance score persisted on first write; second-write same content does NOT re-invoke LLM."

#### Files to edit

- `src/core/memory.ts` OR the write-path pipeline file (TBD per current `src/core/extraction/` structure) — wire the cache lookup
- `src/local/pgvector-store.ts` — add `getImportanceByHash(hash) → Promise<number | null>` method
- `src/core/__tests__/memory/llm-importance-cache.test.ts` (NEW)

#### Deep file dependency analysis

- The existing v0.1 write pipeline already hashes content (`src/core/dedup.ts` per blueprint context). The hash is already computed; we just need an extra index lookup.
- `memories_hash_unique_idx` already exists (v0.1 schema) → index hit is O(log N) — same query plan as v0.1 existing read path.

#### TDD

- **RED:** Integration test:
  - Setup: mock LLM with a call counter starting at 0.
  - Call `memory.remember("Alice likes coffee", {scope: {user: 'alice'}})`. Assert LLM call count = 1. Verify DB row has `llm_importance_score` non-NULL.
  - Call `memory.remember("Alice likes coffee", {scope: {user: 'alice'}})` AGAIN (identical text). Assert LLM call count STILL = 1 (no new call). Verify DB has 1 row (hash dedup) and the cached score is unchanged.
  - Edge case: different content with `userId: alice` — LLM called again (call count = 2); new row persisted.
- **GREEN:** Implement.
- **REFACTOR:** Ensure the cache lookup is gated by a config flag (per plan D8 the cache is always-on, but allow opt-out for testing).

#### Acceptance criteria

- [ ] Second-write same content does NOT re-invoke LLM (assertion: call count == 1 after 2 writes)
- [ ] First-write computes + persists the score
- [ ] Different content invokes LLM normally
- [ ] Integration test passes (matches CLAUDE.md Item 5 verbatim acceptance)

#### DoD

```bash
npm test -- src/core/__tests__/memory/llm-importance-cache.test.ts
```

**v1.1 EC-17 doc:** JSDoc on the cache lookup helper explicitly accepts the MD5 collision risk: "MD5 collision probability ~10^-29 per pair; for 1M memories ~10^-19 chance of any collision. Cache is collision-SAFE by virtue of v0.1's existing `memories_hash_unique_idx` UNIQUE constraint — a hash collision would fail the UNIQUE insert BEFORE the cache lookup can return a wrong score. Acceptable risk; no fix needed."

---

## Phase T6: Acceptance integration test (THE GOAL TEST)

**Objective:** End-to-end test against real pgvector implementing the verbatim CLAUDE.md Item 5 acceptance.

### T6.1 — THE GOAL TEST: 50 memories → `reflect()` → ≥ 1 higher-order with `derived_from`

#### Objective

Ship `tests/integration/reflection/threshold-policy.test.ts` — the acceptance integration test referenced in the Goal. Pattern matches v0.3's `tests/e2e/agent-tools/round-trip.test.ts` (real container; vitest `pool: 'forks'`).

#### Evidence

CLAUDE.md § Macro roadmap Item 5 acceptance verbatim + plan D9 (test pyramid).

#### Files to edit

- `tests/integration/reflection/threshold-policy.test.ts` (NEW)
- `tests/integration/reflection/fixtures/seed-50-memories.ts` (NEW — fixture builder)
- `vitest.config.ts` — confirm `pool: 'forks'` for integration tests (no change if already set)

#### Deep file dependency analysis

- The test composes: real `PgvectorStore` (via existing v0.1 fixtures) + a `ThresholdReflectionPolicy({ threshold: 50 })` + a mocked LLM (returning canned drafts to make the test deterministic).
- 50 memories seeded with 50 distinct texts so hash dedup doesn't collapse them.

#### TDD

- **RED:**
  ```ts
  it('produces ≥ 1 higher-order memory with derived_from after 50-memory threshold', async () => {
    // Given: a Memory with ThresholdReflectionPolicy(threshold=50) + mocked LLM
    const memory = await createIntegrationMemory({ threshold: 50 });
    const scope = { user: 'alice' };

    // When: 50 distinct memories written
    for (let i = 0; i < 50; i++) {
      await memory.remember(`Fact ${i}: Alice likes thing-${i}`, { scope });
    }
    // Policy fires on the 50th; reflect() runs
    await memory.flushReflections(); // helper defined in T4.3 AC per v1.1 EC-7 absorption

    // Then: at least 1 derived memory exists
    const derived = await pgvector.query({
      where: { kind: 'derived', userId: 'alice' },
    });
    expect(derived.length).toBeGreaterThanOrEqual(1);
    expect(derived[0].derivedFrom.length).toBeGreaterThanOrEqual(1);

    // And: LLM importance was cached (NOT re-invoked on identical second-write)
    const callsBefore = mockLLM.callCount;
    await memory.remember('Fact 0: Alice likes thing-0', { scope }); // identical to first
    expect(mockLLM.callCount).toBe(callsBefore); // NO new call
  });
  ```
- **GREEN:** Implement all upstream tasks (T0-T5) such that this test passes.
- **REFACTOR:** Extract the seed loop to a fixture helper for reuse in adjacent tests.

#### Acceptance criteria

- [ ] Test seeds 50 memories successfully (no schema errors)
- [ ] Threshold policy fires on the 50th
- [ ] `reflect()` runs end-to-end producing ≥ 1 row with `kind='derived'` AND `derived_from.length >= 1`
- [ ] LLM-importance cache assertion: identical second-write does NOT re-invoke `LLM.generate()`
- [ ] Test runs against `ankane/pgvector:v0.5.1` container via existing v0.1 fixture infrastructure
- [ ] vitest output shows `pass` (no skip, no flaky)
- [ ] Test runtime < 30s (soft threshold per `cycle-implement.md` soft gate)

#### DoD

```bash
npm test -- tests/integration/reflection/threshold-policy.test.ts
# Expected output: "✓ produces ≥ 1 higher-order memory with derived_from after 50-memory threshold"
```

**THE GOAL METRIC OBSERVED** when this test passes. Per `cycle-implement.md` v1.3 § "Resume after recovered blocker" precedent, this test is the definitive observable signal for `/implement`'s halt-loop completion.

---

## Phase T7: Integration Validation

**Objective:** Full chain validation per `cycle-implement.md` § Final validation gate.

### T7.1 — Full validation chain + wiring triad

#### Objective

Run the full validation chain on the changed code:

- `npm test` (all tests, both unit + integration)
- `npm run typecheck` (zero TS errors)
- `npm run lint` (zero ESLint warnings)
- `npm run test:coverage` (≥ 90% on changed files, 100% on critical paths)
- Wiring triad check (`.claude/skills/implement/scripts/check_wiring.py`):
  - (a) Static caller — each new symbol has ≥ 1 production caller
  - (b) Integration test — each new symbol exercised in `tests/integration/`
  - (c) Runtime metric — `tests/integration/reflection/threshold-policy.test.ts` assertions pass

#### Evidence

`cycle-implement.md` § Phase contracts + Hard gates 1-7.

#### Files to edit

- None (this phase only RUNS validations)

#### Deep file dependency analysis

- Validation is read-only on code; only WRITES the validation report at `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-implement-validate-{date}.md`.

#### TDD

- N/A (validation phase, not a code task)

#### Acceptance criteria

- [ ] `npm test` exit code 0
- [ ] `npm run typecheck` exit code 0
- [ ] `npm run lint` exit code 0
- [ ] Coverage ≥ 90% on changed files (per `testing.md`)
- [ ] Coverage 100% on critical paths (`Memory.reflect`, `validateProvenance`, `bumpReflectionCounter`)
- [ ] Wiring triad pillar (a): each new symbol has ≥ 1 production caller (verified via `check_wiring.py`)
- [ ] Wiring triad pillar (b): each new symbol exercised in `tests/integration/`
- [ ] Wiring triad pillar (c): `tests/integration/reflection/threshold-policy.test.ts` passes

#### DoD

```bash
npm test
npm run typecheck
npm run lint
npm run test:coverage
python3 .claude/skills/implement/scripts/check_wiring.py --plan v0-4a-reflection-pipeline
```

All exit codes 0. Validation report committed at `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-implement-validate-{date}.md`.

---

## Coverage Matrix

Every original requirement / gap maps to at least one task. Target: 100%.

| Requirement / Gap | Source | Task(s) |
|---|---|---|
| CLAUDE.md Item 5 acceptance verbatim "seed 50 memories + reflect() + ≥ 1 higher-order with derived_from" | CLAUDE.md § Macro roadmap Item 5 | T6.1 |
| CLAUDE.md Item 5 acceptance "Both scoring strategies pass identical recall-shape contract test" | Same | T1.2 (contract test parameterized over both weight presets) |
| CLAUDE.md Item 5 acceptance "Sleep-time worker test: background trigger fires" | Same | T3.1 |
| CLAUDE.md Item 5 acceptance "LLM-importance score persisted; second-write same content does NOT re-invoke LLM" | Same | T5.2 |
| ADR-0005 invariant: ManualReflectionPolicy ships v0.0; ThresholdReflectionPolicy + SleepTimeReflectionPolicy at v0.4a BEHIND SAME DIP — zero contract change | ADR-0005 | T2.1 + T3.1 (both implement existing `ReflectionPolicy` from `src/core/dip/reflection-policy.ts` without touching the interface) |
| ADR-0003 ADD-only invariant: reflection produces NEW memories, never mutates | ADR-0003 + `architecture.md § 2` | T4.3 (new `kind='derived'` rows; existing rows untouched) |
| ADR-0008 method counts on existing 5 DIPs unchanged | ADR-0008 | T1.1 (NEW 6th DIP; existing 5 untouched) |
| Blueprint D7 — croner ADOPT | Discovery blueprint | T0.1 + T3.1 |
| Blueprint D8 — DB-backed counter | Discovery blueprint | T0.2 (`reflection_counters` table) + T2.1 (atomic upsert) |
| Blueprint D9 — additive scoring; multiplicative REJECTED | Discovery blueprint + Q7 | T1.2 + plan D3 + F-claude-md-multiplicative-update |
| Blueprint D10 — `derived_from` mandatory | Discovery blueprint | T0.2 (CHECK constraint) + T4.2 (validation) + T4.3 (persist) |
| Blueprint D11 — `llm_importance_score` column + content-hash cache | Discovery blueprint | T0.2 (column) + T5.1 (compute) + T5.2 (cache lookup) |
| Blueprint D12 — test pyramid (real timers + config-knob override + retry) | Discovery blueprint + EC-4 | T2.1 + T3.1 + T6.1 + plan D9 |
| EC-1 (Mem0 main.py > 2000 LoC offset strategy) | Discovery edge-case review | Already absorbed in `/discover-execute` Q6 |
| EC-2 (Letta summarizer.py 894 LoC) | Same | Already absorbed in `/discover-execute` Q4 |
| EC-3 (Q2 candidate list 3 vs 5) | Same | Already absorbed in `/discover-execute` Q2 |
| EC-4 (Q1 mocking idioms verbatim) | Same | Absorbed in plan D9 + T6.1 (config-knob NOT clock mock) |
| EC-5 (Q3 4-way classification) | Same | Already absorbed in `/discover-execute` Q3 |
| EC-6 (Q4 before Q5 ordering) | Same | Already absorbed in `/discover-execute` halt-loop |
| EC-7 (Q5 out-of-scope cross-ref defense) | Same | Already absorbed in `/discover-execute` Q5 |
| EC-8 (Q6 class-boundary grep) | Same | Already absorbed in `/discover-execute` Q6 |
| EC-9 (Q7 PDF Unicode broken; honest fallback) | Same | Already absorbed in `/discover-execute` Q7 (snapshot from reference impl) |
| EC-10 (Q8 GitHub README fallback) | Same | Already absorbed in `/discover-execute` Q8 |
| EC-11 (Q6 grep re-run defense) | Same | Already absorbed in `/discover-execute` Q6 |
| EC-12 (Q2 corner classification) | Same | Documented in F-q2-corner-classification (plan inherits as F-followup) |
| EC-13 (Q4 budget overflow) | Same | N/A — discover-execute completed within budget |
| EC-14 (D4 + D5 schema placement) | Same | Resolved: plan D2 (new DIP `ScoringStrategy`), plan D4 (counter table), plan D6 (kind column), plan D8 (importance column) lock the schema location |

**Coverage: 24/24 = 100%.**

## Dependencies

Per `deps-audit-golden-rule.md` § Mandatory `## Dependencies` section.

### Existing

| Package | Version | Used by |
|---|---|---|
| `pg` | `^8.x` | `src/local/pgvector-store.ts` (v0.1 inheritance) |
| `drizzle-orm` | (per package.json) | `src/local/schema.ts` (v0.1 inheritance) |
| `zod` | `^3.25 \|\| ^4.0` | `src/agent-tools/` (v0.3 inheritance); will be used in T4.1 reflection prompt response validation |
| `@modelcontextprotocol/sdk` | (per package.json) | `src/agent-tools/` (v0.3 inheritance); not touched in v0.4a |

### New

| Package | Version | Why | Rule 9 evaluation |
|---|---|---|---|
| `croner` | `^10.0.1` | `SleepTimeReflectionPolicy` cron-based trigger (T3.1) | ADOPT verdict per blueprint Q2: MIT, 0 transitive deps, 2.019M weekly downloads, native Node/Deno/Bun/Browser. **Rejected alternatives:** `bullmq` (REJECT — Redis dependency disqualifies local-default per blueprint Q2 + plan D7), `node-cron` (DEFER — 12mo stale + ISC license borderline), in-process `setTimeout` (ADOPTED for `ThresholdReflectionPolicy` instead of sleep-time — event-driven not time-driven; KISS). |

### Removed

None.

## Global Definition of Done

The plan is COMPLETE when ALL of the following hold:

### Code

- [ ] All Phase T0-T6 tasks marked done with their per-task DoD satisfied
- [ ] `src/core/dip/` has 6 DIPs (was 5; new: `scoring-strategy.ts`)
- [ ] `src/core/scoring-strategies/` directory exists with `additive-weighted-scoring.ts`
- [ ] `src/core/reflection/` directory exists with `prompt.ts` + `execute.ts` + `provenance.ts` + `importance.ts` + `types.ts`
- [ ] `src/local/reflection/` directory exists with `threshold-reflection-policy.ts` + `sleep-time-reflection-policy.ts`
- [ ] `src/local/schema.ts` includes 3 new columns + 1 new table
- [ ] `src/local/migrations/0001_reflection_columns.sql` applied successfully
- [ ] `src/core/errors.ts` includes `ReflectionProvenanceMissingError` + `ReflectionLLMResponseError` + `ImportanceScoringError`
- [ ] `package.json` includes `croner ^10.0.1` in `dependencies`

### Tests

- [ ] All new unit tests pass (`npm test`)
- [ ] All new integration tests pass against real `ankane/pgvector:v0.5.1`
- [ ] **THE GOAL TEST** (`tests/integration/reflection/threshold-policy.test.ts`) passes
- [ ] Coverage gate: ≥ 90% on changed files, 100% on critical paths
- [ ] Zero skipped tests in new files

### Quality gates (per `architecture.md § Module hygiene`)

- [ ] `npm run typecheck` exit 0 (no `any` types in new code)
- [ ] `npm run lint` exit 0
- [ ] No file in v0.4a NEW directories exceeds 500 LoC budget (`architecture.md § Module hygiene`)
- [ ] DIP boundaries respected: `src/core/` does NOT import from `src/local/` or `src/cloud/`
- [ ] `boundary-check.sh` hook passes on the feature branch

### Wiring triad (per `cycle-implement.md` § Hard gate 4-6)

- [ ] (a) Every new exported symbol has ≥ 1 production caller (`check_wiring.py` pillar a)
- [ ] (b) Every new symbol exercised in `tests/integration/` (pillar b) OR marked `<!-- ADR-DEFER-WIRING-B: <reason> -->`
- [ ] (c) `tests/integration/reflection/threshold-policy.test.ts` runtime-metric assertion passes (pillar c)

### Documentation

- [ ] CHANGELOG.md entry under `[Unreleased] > Added`:
  - `croner` runtime dep
  - `ScoringStrategy` DIP + `AdditiveWeightedScoring` impl
  - `ThresholdReflectionPolicy` + `SleepTimeReflectionPolicy`
  - `Memory.reflect()` end-to-end pipeline
  - `derived_from: string[]` provenance field
  - `llm_importance_score` cache field
  - `kind: 'extracted' | 'derived'` discriminator
- [ ] CLAUDE.md Roadmap Item 5 status updated post-merge from `Planned` to `Shipped {date}` (per blueprint R14 — operational hygiene)

### Architecture compliance

- [ ] No file path appears in ADRs (per `to-plan SKILL.md § Quality Rule 9`)
- [ ] ADR Rationale cites `architecture.md`, `testing.md`, `ADR-0003`, `ADR-0005`, `ADR-0008` (at minimum)
- [ ] All Plan ADRs (D2-D11) have alternatives + rationale + consequences

### Plan archival (per `audit-trail-rotation.md` § "active vs completed is lifecycle")

- [ ] After `/review v0-4a-reflection-pipeline` returns `READY_TO_MERGE` AND the PR is merged to `main`, the plan file moves from `.claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md` to `.claude/knowledge-base/plans/completed/v0-4a-reflection-pipeline-plan.md`. Same commit must bump CLAUDE.md Roadmap Item 5 status.

## Followups logged

| # | Item | Reason for deferral |
|---|---|---|
| F-claude-md-multiplicative-update | Propose CLAUDE.md § Macro roadmap Item 5 acceptance update: remove the "multiplicative Generative Agents (recency × importance × relevance)" framing; replace with "additive weighted sum with configurable weights (Mem0-equal default; Generative-Agents-style {0.5,3,2} opt-in)" matching blueprint Q7 + plan D3. The update is a CHANGELOG.md + CLAUDE.md doc-only change; can ship in the same PR as v0.4a code OR in a follow-up doc-sync PR mirroring the v0.3 PR #20 pattern. | Surfaced by Q7 critical finding during `/discover-execute`. Honesty discipline (Inquebrável Rule 3): the factual correction MUST land; the only choice is in WHICH PR. |
| F-langmem-quickstart-fetch | If `/to-plan v0-4a-reflection-pipeline` had needed the EXACT `BackgroundMemoryManager` constructor signature, fetch `github.com/langchain-ai/langmem/blob/main/docs/docs/quickstart_background.md`. Currently UNNEEDED — design-comparison sufficient (Q8 absorbed). | If a future iteration of v0.4a's sleep-time policy needs deeper LangMem precedent, fetch + snapshot then. Not blocking. |
| F-q2-corner-classification | Cycle-discover v1.1 hard gate #7 (`rule9_verdict_missing` auto-cap at 49) targets ONLY `prior_art` corner; Q2 sat in `deps` corner. Plan inherits this `DOCUMENT` note: enforcement of Rule 9 verdict on Q2 was MANUAL via blueprint section + plan D10. If `/discover-confidence` future versions extend deps-corner Rule 9 enforcement, retire this followup. | Carried from discovery edge-case review EC-12. |
| F-future-multiplicative-strategy | IF a literature search (post-v0.4a) surfaces a verifiable paper that DOES ship `r × i × rel` semantics, a new `ScoringStrategy` impl can be added as a non-breaking change (new file under `src/core/scoring-strategies/`). | Currently deferred per plan D3 — no such paper found by Q7's WebSearch. |
| F-scope-counter-cleanup-policy | The `reflection_counters` table grows unbounded over time (one row per scope, plus counter bumps). At v0.5+ cloud, a GC policy must be needed (e.g., reset counter rows after N days of inactivity). | Defer to v0.5 cloud where multi-tenant scale demands it. v0.4a single-instance dev: counters are small. |
| F-importance-prompt-versioning | The reflection prompt + the importance-scoring prompt are versioned via `PROMPT_VERSION = '1.0'` constants. If future revisions change prompt semantics, bump the version + add a regression test asserting old-version-scored memories don't accidentally use new-version prompt logic. | Defer to v1.x when prompt evolution becomes a real concern. |
| F-cron-default-tbd | The default cron expression for `SleepTimeReflectionPolicy` (when consumer doesn't specify one) is NOT locked by this plan. Recommendation: no default (consumer MUST specify); throwing `MissingCronExpressionError` on construction without one. Alternatives: every-15-min default OR `null` (cron disabled until explicitly enabled). | Defer to T3.1 implementation phase to lock; current bias: NO default (explicit-only). |
| F-reflect-context-window-fallback (v1.1 EC-18) | `Memory.reflect()` does NOT implement Letta-style 4-fallback chain (clamp → truncate → provider-swap → abort) for context-window overflow on huge source sets (per blueprint R11). Consumers running on scopes with >500 memories must chunk reflection (call `reflect()` with a sliding window OR add a `maxSourceMemories` option). v1.x will add the Letta-style fallback chain. | YAGNI for v0.4a usage scale (single-instance dev); blueprint R11 captures the design; revisit when a real consumer hits the limit. |
| F-sleeptime-timezone-option (v1.1 EC-15) | `SleepTimeReflectionPolicy` constructor does NOT expose a `timezone?: string` option; croner's default (Node process TZ) is used. Recommend `process.env.TZ='UTC'` in container deployments. | YAGNI for v0.4a single-instance dev; revisit at v0.5 cloud where multi-region TZ matters. |
| F-empty-scope-error (v1.1 EC-3 sibling) | `ThresholdReflectionPolicy.shouldReflect()` invoked with all-NULL scope `{}` throws `EmptyScopeError` (NEW class) BEFORE hitting the DB CHECK constraint, so consumers get a typed error rather than a raw Postgres constraint-violation. Sibling of `MissingScopeError` from v0.2. Ship in T2.1 implementation. | Tracked as completion gate for T2.1 AC; not blocking the plan structurally. |

## v1.1 edge-case absorption summary

Status of edges from `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-edge-cases-plan-2026-05-26.md`:

| # | Severity | Task(s) | Absorption |
|---|---|---|---|
| EC-1 (T1.2 zero-weight divide-by-zero) | `MUST FIX` | T1.2 | ✓ Constructor validation + `InvalidScoringWeightsError` (new class in `src/core/errors.ts`) + RED test |
| EC-2 (T0.2/T2.1 counter integer overflow) | `MUST FIX` | T0.2 + T2.1 | ✓ `count: bigint()` instead of `integer()`; AC + 10B-value persist test |
| EC-3 (T0.2/T2.1 all-NULL scope collision) | `MUST FIX` | T0.2 + T2.1 | ✓ CHECK constraint `reflection_counters_scope_not_all_null_check` + `EmptyScopeError` (logged as F-empty-scope-error) |
| EC-4 (T3.1 invalid cron silently no-ops) | `MUST FIX` | T3.1 | ✓ Eager constructor validation + `InvalidCronExpressionError` (new class) |
| EC-5 (T4.1 empty source LLM hallucination) | `MUST FIX` | T4.1 + T4.3 | ✓ Empty-source short-circuit BEFORE LLM call + RED test asserting `mockLLM.callCount === 0` |
| EC-6 (T4.3 transaction boundary unspecified) | `MUST FIX` | T4.3 | ✓ Drizzle `db.transaction()` lock + partial-failure rollback test |
| EC-7 (T6.1 flushReflections undefined) | `MUST FIX` | T4.3 (helper) + T6.1 (consumer) | ✓ `Memory.flushReflections()` added as T4.3 AC + RED test + `_pendingReflections: Set<Promise<void>>` field |
| EC-8 (T1.2 zero-variance min-max) | `SHOULD TEST` | T1.2 | ✓ `test_additive_weighted_scoring_handles_zero_variance` + normalize-helper `min === max` returns `0.5` |
| EC-9 (T4.3 reflecting on derived) | `SHOULD TEST` | T4.3 | ✓ `test_reflect_includes_derived_in_source_set` + JSDoc documenting transitive provenance is allowed |
| EC-10 (T0.2 migration ordering) | `SHOULD TEST` | T0.2 | ✓ `test_migration_applies_to_v01_populated_db` |
| EC-11 (T3.1 idempotent start) | `SHOULD TEST` | T3.1 | ✓ `test_sleep_time_policy_start_twice_is_idempotent` + `this._started` boolean |
| EC-12 (T2.1 counter-state-on-failure) | `SHOULD TEST` | T2.1 | ✓ `test_counter_state_when_reflect_throws` + JSDoc on fire-and-forget semantics |
| EC-13 (T4.1 LLM returns valid `[]` is success) | `SHOULD TEST` | T4.1 | ✓ RED case in `execute.test.ts` |
| EC-14 (T4.2 stale source-ID race) | `SHOULD TEST` | T4.2 | ✓ `test_reflect_handles_concurrent_forget_during_reflection` + JSDoc on stale-link acceptance |
| EC-15 (T3.1 croner timezone) | `DOCUMENT` | T3.1 | ✓ JSDoc on constructor + F-sleeptime-timezone-option followup |
| EC-16 (T5.1 prompt versioning cache invalidation) | `DOCUMENT` | T5.1 | ✓ JSDoc on `IMPORTANCE_PROMPT_VERSION` + F-importance-prompt-versioning followup |
| EC-17 (T5.2 MD5 collision risk) | `DOCUMENT` | T5.2 | ✓ JSDoc on cache lookup helper explicitly accepting risk |
| EC-18 (T4.1 LLM context-window overflow) | `DOCUMENT` | T4.1 | ✓ Inline note in T4.1 Objective + F-reflect-context-window-fallback followup |

**18/18 absorbed.** Plan v1.1 ready for `/deps-audit v0-4a-reflection-pipeline` → `/plan-confidence v0-4a-reflection-pipeline`.

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/v0-4a-reflection-pipeline-plan.md` (v1.1, 14 ECs absorbed)
- Discovery blueprint: `.claude/knowledge-base/discoveries/blueprints/v0-4a-reflection-pipeline-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89/100; 6 ADRs D7-D12; 14 recommendations R1-R14)
- Edge-case review: `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-edge-cases-2026-05-25.md`
- Confidence report: `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-confidence-2026-05-25.md.json`
- Source ADRs: `.claude/knowledge-base/adrs/ADR-0003-add-only-public-api.md`, `.claude/knowledge-base/adrs/ADR-0005-reflection-trigger.md`, `.claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md`
- Roadmap entry: CLAUDE.md § Macro roadmap Item 5
- Cycle rule: `.claude/rules/cycle-plan.md` (v1.1 — `/deps-audit` chain extension)
- Architecture rule: `.claude/rules/architecture.md § 3` (DIP boundaries)
- Testing rule: `.claude/rules/testing.md § TDD + BDD`
- Dogfood discipline: `.claude/rules/dogfood-golden-rule.md`
- Companion v0.3 implementation plan: `.claude/knowledge-base/plans/completed/v0-3-agent-tools-mcp-plan.md` (shape reference; quality bar to match)
- 7 web snapshots: under `.claude/knowledge-base/discoveries/snapshots/v0-4a-reflection-pipeline/` (immutable audit trail)
```

### ADRs (verbatim)

### Edge-case reviews (verbatim)

#### 

```markdown
```

#### 

```markdown
```

### Deps audit (verbatim)

```markdown
```

### Plan-confidence final report (verbatim)

```json
```

### Project rules (verbatim)

#### architecture.md

```markdown
```

#### testing.md

```markdown
```

#### public-copy.md

```markdown
```

#### cycle-implement.md

```markdown
```

#### plan-confidence-golden-rule.md

```markdown
```

#### deps-audit-golden-rule.md

```markdown
```

