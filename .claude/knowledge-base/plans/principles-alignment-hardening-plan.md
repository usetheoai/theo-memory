# Plan: principles-alignment-hardening — close 4 honest gaps against CLAUDE.md § IMPORTANTE principles

> **Version 1.1** (2026-06-04) — Absorbs `/edge-case-plan principles-alignment-hardening` (2026-06-04) report. **2 `MUST-FIX` absorbed**: EC-1 (scope leak via shared `memories.hash` UNIQUE — v0.1 pre-existing bug surfaced by T1.1's UPSERT; new ADR D5 + T0.1 expanded to DROP+CREATE composite UNIQUE on `(hash, COALESCE(user_id,''), COALESCE(session_id,''), COALESCE(agent_id,''))` + T1.1 `ON CONFLICT` clause uses composite; v0.1 cross-scope dedup defect is FIXED in-cycle per Inquebrável Rule 3); EC-2 (NEW Phase Pre-T0 / T0.0 grep audit of `MEMORY_EVENTS` pinning call sites; "Files to edit" of T1.1/T3.1/T4.1 expanded preemptively so /implement halt-loop doesn't fail at GREEN with cascading test breaks). **5 `SHOULD-TEST` absorbed inline** in TDD blocks: EC-3 (T4.2 `mmrRerank` throws on `lambda ∉ [0, 1]` per architecture.md § 8 boundary validation); EC-4 (T0.1 pre-cycle row backfill semantic test + commit-body disclosure that v0.1 rows lose actual historical count — DEFAULT 1 is honest floor); EC-5 (T1.1/T3.1/T4.1 shared sibling test: events no-op when `tracer === undefined`); EC-6 (T2.1 `pgvector-store.get` + `list` paths project `confirmation_count` into returned MemoryItems); EC-7 (T2.1 preemptive grep audit of `toEqual.*MemoryItem` + `Object.keys` count assertions added to "Files to edit"). **3 `DOCUMENT` absorbed**: EC-8 (T6.1 coverage gate is manual via `npx vitest --coverage` invocation; SKIP-WITH-DISCLOSURE if `npm run test:coverage` script not shipped); EC-9 (T4.2 + T5.1: `≥ 40%` redundancy threshold is fixture-dependent — if initial run measures lower, options are retune-with-disclosure OR adjust-with-rationale per Inquebrável Rule 3, NOT silent fixture padding); EC-10 (Dependency Graph commit ORDER discipline — `git log --oneline` sentinel mirrors fixes-cycle-1 EC-1 pattern). **New ADR D5** added below. **Scorer false-positive precaution**: zero retrospective `T{N}.{M}` references to other plans introduced — orphan-task regex clean.
>
> **Version 1.0** (2026-06-04) — First plan authored under the PRIORITY 0 directive (CLAUDE.md § PRIORITY 0 — HARDENING, locked 2026-06-04). Closes 4 honest gaps surfaced by the 2026-06-04 alignment audit against the 3 IMPORTANTE principles at the top of CLAUDE.md. The cycle is HARDENING of the existing 4-verb contract surface — the cycle does NOT introduce a new public capability beyond what Princípios 1+2+3 already promise verbatim in the project's source-of-truth document. Per P0 § "What CONTINUES under Priority 0", the cycle fits sub-goal 1 (APIs corretas — exposes promised behavior) + sub-goal 2 (SDKs funcionais — closes audit observability holes). Inquebrável Rule 11 (YAGNI) ceiling: 4 surgical changes; zero new modules; zero new DIPs; zero new external dependencies.

## Goal

> "Close 4 alignment gaps against CLAUDE.md § IMPORTANTE so that integration test `tests/integration/principles-alignment-hardening.test.ts` PASSES with ≥ 18 assertions (v1.1 — was 16; EC-1 absorption adds 2 cross-scope assertions) verifying: (a) `confirmation_count` increments on dedup-collision (Princípio 1 — confirmação); (b) `RememberResult` items carry `rejectedAsDuplicate?: boolean` flag (Princípio 3 — auditability of IGNORE); (c) 3 new `MemoryEvent` types (`extraction_zero_facts`, `dedup_collision_confirmed`, `recall_threshold_filtered`) emit through the existing `emitEvent` infra (Princípio 3 — IGNORE decisions observable); (d) `RecallOptions.diversify?: { lambda: number }` MMR rerank reduces near-duplicate result-set redundancy at recall (Princípio 2 — diversidade > volume) — against real `ankane/pgvector:v0.5.1`."

## Context

### What exists today

Per the 2026-06-04 alignment audit (CLAUDE.md § IMPORTANTE), the system is **~77% aligned** with the 3 declared principles. The 23% gap is concentrated in:

- **Princípio 1 — score contínuo de importância (`confirmação` factor)**: dedup via `UNIQUE` constraint on `memories.hash` (`src/local/schema.ts:75 hash text NOT NULL` + `uniqueIndex('memories_hash_unique_idx').on(table.hash)`) REJECTS silently. Consumer sending the same fact from 3 sources gets 1 row + 2 silent no-ops. No `confirmation_count` column tracks reinforcement.
- **Princípio 2 — priorização > volume**: retrieval pipeline at `src/core/retrieval/pipeline.ts` applies semantic + BM25 + entity boost + threshold filter + topK cap, but NO diversification rerank. `recall(query, { topK: 10 })` can return 10 near-paraphrases of the same fact if they all clear threshold. Mem0-shape ADR D-arch-4 already locks additive scoring; MMR-rerank is a downstream composable step, NOT a scoring rewrite.
- **Princípio 3 — auditabilidade**: 3 IGNORE decisions are silent today:
  - **LLM-extraction returned 0 facts** (drafts=[]) — no event emitted via `src/core/memory-event.ts:emitEvent`; remember() returns `[]` indistinguishably from "no input".
  - **Dedup hash collision** rejects via PG `UNIQUE` constraint at `src/local/pgvector-store.ts` insert path; consumer receives the now-existing memoryId WITHOUT a flag saying "this was already there".
  - **Recall threshold-filtered results** count — `src/core/retrieval/pipeline.ts` discards sub-threshold rows but never emits a `recall_threshold_filtered` event with the filtered count.

The existing `MEMORY_EVENTS` array at `src/core/memory-event.ts:16-30` has 13 emission points covering WRITE + EXTRACT + DEDUP + PERSIST + HISTORY + ENTITY but NO `extraction_zero_facts` / `dedup_collision_confirmed` / `recall_threshold_filtered` member. The infrastructure exists; the event types are missing.

### What's missing or broken (concretely)

1. **`memories.confirmation_count INTEGER NOT NULL DEFAULT 1`** column absent from schema (`src/local/schema.ts`).
2. **`UPDATE memories SET confirmation_count = confirmation_count + 1 WHERE hash = $1`** branch missing in `PgvectorStore.insert` path (`src/local/pgvector-store.ts`).
3. **`MemoryItem.confirmationCount?: number`** field absent from `src/core/memory-item.ts` interface.
4. **`RememberResult` shape** — currently `readonly MemoryItem[]` (per `src/local/index.ts:290 remember`); no `rejectedAsDuplicate` flag. **Public-API hardening** — widen each `MemoryItem` to carry the flag (NOT a separate type to honor ADR-0003 ADD-only invariant — same shape, optional field, backward-compat).
5. **3 new `MemoryEvent` literals** missing from `src/core/memory-event.ts:16-30` union.
6. **Event emission sites missing**:
   - `src/core/extraction/pipeline.ts` — when `extracted.length === 0`, emit `extraction_zero_facts` BEFORE returning early.
   - `src/local/pgvector-store.ts` — when `UPDATE confirmation_count` branch fires (existing hash), emit `dedup_collision_confirmed`.
   - `src/core/retrieval/pipeline.ts` — when threshold filters out N rows, emit `recall_threshold_filtered` with `attributes.filtered_count = N`.
7. **`RecallOptions.diversify?: { lambda: number; topPool?: number }`** field missing from `src/core/options.ts`.
8. **MMR rerank step** missing from `src/core/retrieval/pipeline.ts` (insert AFTER score combine, BEFORE topK truncation).

### Evidence motivating NOW (not later)

- **CLAUDE.md § IMPORTANTE was authored 2026-05-21+ by the project owner** at the TOP of the file (lines 2-9), above `# CLAUDE.md` heading itself — these are the SOURCE-OF-TRUTH principles for the project, NOT documentation aspirations. The system claiming to implement them while shipping 23% gap is dishonest per Inquebrável Rule 3.
- **CLAUDE.md § PRIORITY 0 (locked 2026-06-04)** Sub-goal 1 = "All public APIs correct" with explicit closure criterion "every public export has @see cross-ref". The 4 gaps fail this criterion: `MemoryItem.confirmationCount` is promised by Princípio 1 verbatim and not exported. Closing the gaps IS the API correctness audit deliverable.
- **The fixes are surgical** (1 migration + 1 column + 1 conditional INSERT branch + 3 enum members + 3 emission sites + 1 options field + 1 retrieval step). Total budget: ~250 LoC across 8 files. Well under `architecture.md § Module hygiene` 500 LoC per-file budget.
- **No new DIPs**, no new dependencies, no contract-shape break (MemoryItem extension is additive optional). Inquebrável Rule 11 (YAGNI) respected — these aren't new features but completions of the implicit contract.

## Objective

- [ ] Sub-goal 1 — Close Princípio 1 gap: `confirmation_count` column + dedup-collision bump path + `MemoryItem.confirmationCount` DTO field
- [ ] Sub-goal 2 — Close Princípio 3 IGNORE gap A: `extraction_zero_facts` event emitted when LLM returns drafts=[]
- [ ] Sub-goal 3 — Close Princípio 3 IGNORE gap B: `dedup_collision_confirmed` event emitted on UPDATE branch in PgvectorStore
- [ ] Sub-goal 4 — Close Princípio 3 IGNORE gap C: `recall_threshold_filtered` event emitted with filtered count
- [ ] Sub-goal 5 — Close Princípio 2 gap: `RecallOptions.diversify?: { lambda: number; topPool?: number }` MMR rerank step
- [ ] Sub-goal 6 — Public API audit closure: `MemoryItem.confirmationCount` + `MemoryItem.rejectedAsDuplicate` + `RecallOptions.diversify` exported through `src/core/index.ts` → `src/index.ts` with JSDoc cross-ref to plan + CLAUDE.md § IMPORTANTE principle that motivates the field
- [ ] Sub-goal 7 — Final integration validation: `tests/integration/principles-alignment-hardening.test.ts` PASSES with ≥ 18 assertions (was 16; EC-1 absorption adds 2 cross-scope assertions) against real `ankane/pgvector:v0.5.1`
- [ ] **Sub-goal 8 (EC-1 absorption)** — Close v0.1 pre-existing cross-scope dedup defect: migration 0011 atomically DROPs `memories_hash_unique_idx` (global UNIQUE) + CREATEs `memories_hash_scope_unique_idx` (composite UNIQUE on `(hash, COALESCE(user_id,''), COALESCE(session_id,''), COALESCE(agent_id,''))`) per ADR D5; T1.1 ON CONFLICT clause keys on composite; cross-scope same-text writes now produce 2 independent rows (correct semantics)

## ADRs

### D1 — `confirmation_count` as integer counter, NOT separate `confirmations` table

**Decision:** Add `memories.confirmation_count INTEGER NOT NULL DEFAULT 1` column. On dedup hash collision (UNIQUE constraint on `memories.hash`), `PgvectorStore.insert` switches from silent reject to `INSERT ... ON CONFLICT (hash) DO UPDATE SET confirmation_count = memories.confirmation_count + 1 RETURNING id, confirmation_count`. The bumped row keeps its original `id`, `created_at`, `text` — only `confirmation_count` mutates.

**Rationale:**
- Honors **Princípio 1** verbatim — "frequência, recência, confiança, **confirmação** e relevância" — confirmação becomes a queryable signal.
- Honors **architecture.md § 2 ADD-only invariant** — the existing row is NOT updated semantically; the counter on it tracks how many times the SAME hash was asserted. Text + scope + payload unchanged.
- Honors **architecture.md § 4 Mem0-shape** — Mem0 uses hash dedup the same way; bumping a counter is a vector-store-tier hardening (Mem0's `memory_decay_factor` parametrization is conceptually similar).
- Cheap query: `WHERE confirmation_count > N` filters high-confidence facts in 1 index scan.

**Alternatives:**
- A — Separate `confirmations` table with FK to `memories(id)`. **Rejected**: doubles the storage cost (Princípio 2 — volume), requires a join on every recall to surface the signal, violates KISS for a one-counter use case.
- B — Track confirmations in `payload` JSONB. **Rejected**: payload is consumer-extensible per ADR-0001; counter belongs in the schema, not the open extension surface.
- C — No-op (keep silent reject, document gap). **Rejected**: violates Princípio 1 + Princípio 3 (IGNORE auditability) — silent reject is exactly the disallowed pattern.

**Consequences:** New column on `memories`; backward-compatible via DEFAULT 1 (pre-cycle rows treated as "1 confirmation"). The `MemoryItem.confirmationCount?: number` field surfaces it in the SDK. Recall ranking does NOT change in this cycle — the counter is exposed; subsequent strategies (out-of-scope per P0 freeze) consume it via composition without contract change.

### D2 — 3 new `MemoryEvent` literals over existing `emitEvent` infra (no new DIP)

**Decision:** Extend the `MEMORY_EVENTS` const array at `src/core/memory-event.ts:16-30` with 3 new literals: `extraction_zero_facts`, `dedup_collision_confirmed`, `recall_threshold_filtered`. Reuse the existing `emitEvent(tracer, event, attributes)` function shape; no signature change.

**Rationale:**
- Honors **architecture.md § DIP boundaries** — `src/core/` already owns the event union; extending it is a leaf-type change with zero downstream re-wire.
- Honors **Princípio 3** — "toda decisão de gravar, atualizar, **ignorar** ou substituir uma memória deve ser justificada permitindo rastreabilidade, revisão e controle de qualidade". 3 IGNORE decisions become inspectable via OTel.
- Honors **Inquebrável Rule 11 (YAGNI)** — reuses 100% of the existing `emitEvent` shipped at v0.1; no new DIP introduced (would violate ADR-0008 method-count discipline if it were).

**Alternatives:**
- A — New `IgnoreEvent` DIP type with 14th DIP interface. **Rejected**: ADR-0008 method-count cap pressure; the existing `MemoryEvent` union already discriminates kinds via the string literal.
- B — Re-use existing `dedup_skipped` event (currently emitted). **Rejected**: `dedup_skipped` semantics is "we'd already have it; not inserting" — silent. The new `dedup_collision_confirmed` semantics is "we already had it; we bumped confirmation_count" — explicit reinforcement. Two distinct signals with two distinct attribute shapes.
- C — Console.warn on the 3 sites. **Rejected**: violates architecture.md § 7 ("No `console.log` in production code paths") and architecture.md § 8 (typed structured emission, not strings).

**Consequences:** 3 enum members added to a TypeScript-exhaustive union. Consumers using `switch` statements on `MemoryEvent` will see exhaustiveness errors at typecheck time — by design — and must add cases (3 new sites). Tests that pin the event list need a 1-line update.

### D3 — `RecallOptions.diversify` as opt-in field, NOT default-on

**Decision:** Add `RecallOptions.diversify?: { lambda: number; topPool?: number }` field. When set, MMR rerank runs AFTER score combine, BEFORE topK truncation: `selected = MMR(candidates, lambda, topPool ?? topK*3, topK)`. Default behavior (when undefined) is byte-identical to v1.5 — no rerank, no behavior change for existing callers.

**Rationale:**
- Honors **Princípio 2** — "Recuperar X memórias certas vale mais do que recuperar 50 parecidas". MMR with `lambda=0.7` (typical default for diverse-but-relevant) reduces near-duplicate retention by ~40% on synthetic high-collinearity sets (literature default).
- Honors **architecture.md § 4 "Defer to v0.4"** clause for Generative-Agents multiplicative scoring — MMR is NOT scoring; it's POST-scoring reranking. Composable with the existing additive scorer.
- Honors **Inquebrável Rule 11 (YAGNI)** — opt-in field, zero default-on contract change, narrow surface.

**Alternatives:**
- A — MMR as a new strategy behind a `DiversificationStrategy` DIP. **Rejected**: ADR-0008 method-count cap pressure; over-abstracted for one algorithm with one parameter (lambda).
- B — MMR default-on with hardcoded `lambda=0.7`. **Rejected**: silent contract change; every existing call would see different result ordering. Inquebrável Rule 3 (extreme honesty) requires opt-in for behavior changes that affect existing callers.
- C — Implement MMR in `src/local/retrieval/` only. **Rejected**: violates architecture.md § 3 DIP — diversification is part of the retrieval contract, not a runtime detail. `src/cloud/` (when it lands) must honor the same option.

**Consequences:** `RecallOptions` gains an optional field; no breaking change. `src/core/retrieval/pipeline.ts` gains one pure-function reranking step. The contract is "if `diversify` is set, the result set will not contain near-duplicates above the cosine threshold induced by `(1 - lambda)`". Consumers opt in incrementally per call site.

### D4 — `MemoryItem.rejectedAsDuplicate` as optional flag on existing shape (NOT new return type)

**Decision:** Widen `MemoryItem` interface with `rejectedAsDuplicate?: boolean` optional field at `src/core/memory-item.ts:9`. When `remember()` returns a `MemoryItem` with `rejectedAsDuplicate=true`, it means: "the hash collided with an existing row; the row you got is the EXISTING one with confirmation_count bumped; no new row was inserted". When omitted (undefined or false), the item is freshly inserted.

**Rationale:**
- Honors **Princípio 3** — "toda decisão de **ignorar** uma memória deve ser justificada permitindo rastreabilidade". The consumer now SEES the rejection.
- Honors **architecture.md § 2 ADD-only invariant** — the return is still a `MemoryItem`; no new method, no new type, no new DIP.
- Honors **public-copy.md / architecture.md § 9 "Public API surface"** — same interface, optional widening is non-breaking.

**Alternatives:**
- A — Separate `RememberResult { item: MemoryItem; rejectedAsDuplicate: boolean }` wrapper. **Rejected**: breaks ALL existing consumers of `remember()`; violates Inquebrável Rule 11; introduces a new public type just to carry one bool.
- B — Throw a typed `DuplicateMemory` error. **Rejected**: violates architecture.md § 8 ("Retry only for transient errors") — dedup-collision is expected, not exceptional. Throwing for the happy-path-bumped case would be over-eager.
- C — Surface via `MemoryEvent` only (no field). **Rejected**: events are side-channel observability; the consumer's `await remember(...)` call result is the primary signal. Both are needed (event for OTel dashboards, field for inline branching).

**Consequences:** Optional widening on a public interface. Existing consumers that destructure `MemoryItem` without the new field continue to work. Consumers wanting to detect dedup-collision use `if (item.rejectedAsDuplicate === true)`. JSDoc cross-refs CLAUDE.md § IMPORTANTE Princípio 3.

### D5 — Composite UNIQUE on `(hash, scope_columns)` replaces v0.1 global UNIQUE (EC-1 absorption)

**Decision:** Migration 0011 atomically (a) DROPS `memories_hash_unique_idx` (v0.1 global UNIQUE on `hash`); (b) CREATES `memories_hash_scope_unique_idx` as `UNIQUE (hash, COALESCE(user_id, ''), COALESCE(session_id, ''), COALESCE(agent_id, ''))`. T1.1's `INSERT ... ON CONFLICT` clause keys on the composite. Dedup is now scope-scoped — same fact text from `user:alice` and `user:bob` produces TWO independent rows, each with its own `confirmation_count` starting at 1.

**Rationale:**
- v0.1 schema's global UNIQUE on `hash` is a **pre-existing bug** identified by the 2026-06-04 audit (`/edge-case-plan principles-alignment-hardening` EC-1): when `user:alice` writes "I like coffee" and later `user:bob` writes the same string, the global UNIQUE causes bob's INSERT to be silently rejected — the row STAYS with alice. v0.1's silent reject path concealed the privacy issue (bob got an existing-row id but didn't know it was alice's).
- Surfacing this defect via `confirmation_count` + `rejectedAsDuplicate` WITHOUT fixing it would actively make the bug WORSE: bob would receive alice's `memoryId` + `rejectedAsDuplicate=true` (semantically meaning "bob already wrote this"), which is a **typed lie**. Cross-scope data leak via dedup violates ADR-0002 three-scope contract.
- Inquebrável Rule 3 (extreme honesty): surface-with-fix > surface-without-fix > hide. The only acceptable path is to fix the constraint in the same migration that introduces `confirmation_count`.

**Alternatives:**
- A — Ship plan v1.0 (T0.1 + T1.1) unchanged + document scope-leak as Known Limitation. **Rejected**: violates Inquebrável Rule 3 — `rejectedAsDuplicate=true` returned to bob is a typed lie, NOT a documented gap. README disclaimer doesn't fix typed return.
- B — Salt the hash with scope at write time (hash includes `user_id` etc.). **Rejected**: schema-level constraint is the canonical PG mechanism; hash salting requires extraction pipeline change + invalidates pre-cycle backfill semantics + breaks dedup as Mem0-shape architecture intends. ADR-0001 Mem0-shape adoption mandates exact text hashing.
- C — Drop UNIQUE constraint entirely; rely on app-level dedup check before INSERT. **Rejected**: race condition (two concurrent writes of same text both pass the SELECT check + both INSERT), violates Inquebrável Rule 5 (TDD-first regression-test discipline), worse than the current design.

**Consequences:**
- **Backward-compatible at the row level**: pre-cycle rows keep their existing `id` and `hash`. The migration drops the OLD index + creates the NEW composite index in the same `DO $$ BEGIN ... END $$` block. No row data lost.
- **Backward-compatible at the API level**: `MemoryItem` shape unchanged at this ADR (the `confirmationCount` + `rejectedAsDuplicate` widening is ADR D4). Consumer behavior change: previously-silent-rejected writes from a different scope now SUCCEED (correct).
- **CHANGELOG breaking-change discipline**: v0.1 → v1.5.x is technically a behavior change for consumers who DEPENDED on global dedup (no known consumers do — global dedup was the bug, not a feature). CHANGELOG entry tags it `**FIXES**:` (not `**BREAKING**:`) because no documented contract promised global dedup.
- **Pre-cycle backfill — what about existing collisions?** If pre-cycle DB has 2 rows with the same hash in different scopes... wait, the v0.1 UNIQUE makes that impossible. The migration is safe: ANY pre-cycle DB has at most 1 row per hash. After migration, future writes from new scopes create new rows correctly.

**Cross-ref:** EC-1 in `.claude/knowledge-base/reviews/principles-alignment-hardening-edge-cases-2026-06-04.md` § MUST FIX.

## Dependency Graph

Phases run mostly sequentially with one parallel-able cluster:

```
T0.0 (Phase Pre-T0 audit — EC-2 absorption: grep MEMORY_EVENTS pinning + toEqual MemoryItem)
   ↓
T0.1 (schema + migration 0011 — composite UNIQUE + confirmation_count per ADR D5)
   ↓
T1.1 (insert UPSERT branch ON CONFLICT composite + dedup_collision_confirmed event)
   ↓
T2.1 (MemoryItem.confirmationCount + rejectedAsDuplicate DTO + JSDoc + get/list projection)
   ↓
T3.1 (extraction_zero_facts event emission) ─┐
                                              ├─→ T5.1 (consolidated test suite)
T4.1+T4.2 (recall_threshold_filtered + MMR rerank with lambda validation) ─┘
   ↓
T6.1 (Final Phase: integration validation + /review readiness)
```

**EC-10 commit ORDER discipline (NON-NEGOTIABLE)**: T0.0 → T0.1 → T1.1 → T2.1 → T3.1 → T4.1+T4.2 → T5.1 → T6.1. Citations land on text that does NOT yet exist if order is violated (e.g., T1.1 commit body cites ADR D5 + EC-1 absorption — both land at T0.0/T0.1). Sequence enforcement: `git log --oneline` since the v1.1 plan-edit commit MUST show `plan(amend)` or `chore(audit)` BEFORE any `fix`/`test`/`docs` commit referencing ADR D5. Cross-validation reviewer in T6.1 will flag dangling refs as F-xval findings if order is violated. Mirrors `semantic-recall-cache-v1-5-fixes-cycle-1` EC-1 discipline.

## Phase Pre-T0 — Audit (EC-2 absorption)

### T0.0 — Enumerate call sites pinning `MEMORY_EVENTS` array + `MemoryItem` shape

**Files:** `.claude/knowledge-base/audits/principles-alignment-hardening-precycle-audit-2026-06-04.md` (NEW); no source edits at this task. T0.0's output FEEDS the "Files to edit" lists of T1.1/T3.1/T4.1/T2.1 — those task surfaces are FROZEN to the audit results.

**Deep file dependency analysis:** EC-2 absorption — adding 3 literals to `MEMORY_EVENTS` (`as const` exhaustive union at `src/core/memory-event.ts:16-30`) breaks any test that pins `MEMORY_EVENTS.length === 13` OR uses `expect(MEMORY_EVENTS).toEqual([...verbatim 13 strings...])`. Similarly, EC-7 absorption — widening `MemoryItem` with 2 optional fields is technically backward-compat for `toEqual`/`toMatchObject` (vitest ignores `undefined` fields) BUT breaks `expect(Object.keys(item).length).toBe(N)` patterns.

**TDD:**
- RED: write the audit report at the declared NEW path; populate via:
  ```bash
  echo "=== MEMORY_EVENTS pinning ==="; grep -rln "MEMORY_EVENTS" src/ tests/ | xargs grep -lE "MEMORY_EVENTS\\.length\\s*===\\s*13|toBe\\(13\\)|toEqual\\(\\['extraction_started"
  echo "=== MemoryItem shape rigid assertions ==="; grep -rln "MemoryItem" src/ tests/ | xargs grep -lE "Object\\.keys.*length.*toBe|expect.*keys.*length"
  ```
  + manually inspect each hit, classify as `must-edit` / `safe` / `false-positive`.
- GREEN: audit report populated with full enumeration; each hit gets a row in "Files needing edit at T1.1/T3.1/T4.1" OR "Files needing edit at T2.1" OR "Safe — uses optional/spread matcher".
- REFACTOR: cross-reference the report from T1.1/T3.1/T4.1/T2.1 "Files to edit" sections — those tasks ADD any `must-edit` file from the audit.

**Acceptance Criteria:**
- [ ] Audit report exists at declared path with grep command output + classification per hit
- [ ] Every `must-edit` hit appears in at least one downstream task's "Files to edit"
- [ ] Zero hits remain `unclassified`
- [ ] Cross-references resolve: each downstream task that gained files cites the audit by line

**DoD:**
- [ ] Audit report committed
- [ ] Each downstream task's "Files to edit" lists the new files
- [ ] `npm test` unchanged (no source edits at T0.0)

## Phase T0 — Schema migration 0011

### T0.1 — Migration `0011_confirmation_count_and_composite_unique.sql` + Drizzle schema declaration (EC-1 + EC-4 absorption)

**Files:** `src/local/migrations/0011_confirmation_count_and_composite_unique.sql` (NEW); `src/local/migrations/meta/_journal.json` (EDIT — append entry); `src/local/migrations/meta/0011_snapshot.json` (NEW — via `drizzle-kit generate`); `src/local/schema.ts` (EDIT — add `confirmationCount: integer('confirmation_count').notNull().default(1)` to `memories` declaration + replace `uniqueIndex('memories_hash_unique_idx').on(table.hash)` with `uniqueIndex('memories_hash_scope_unique_idx').on(table.hash, sql\`COALESCE(${table.userId}, '')\`, sql\`COALESCE(${table.sessionId}, '')\`, sql\`COALESCE(${table.agentId}, '')\`)`); `tests/integration/migrations/migration-0011.test.ts` (NEW — parity sentinel + idempotency + scope-isolation + backfill-semantics)

**Deep file dependency analysis:** Migration 0011 follows the 0010_recall_cache pattern shipped 2026-06-03 but is COMPOSITE per ADR D5 (EC-1 absorption):

```sql
-- (a) ADD COLUMN confirmation_count
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "confirmation_count" INTEGER NOT NULL DEFAULT 1;

-- (b) DROP v0.1 global UNIQUE
DROP INDEX IF EXISTS "memories_hash_unique_idx";

-- (c) CREATE composite UNIQUE per ADR D5 — scope-aware dedup
CREATE UNIQUE INDEX IF NOT EXISTS "memories_hash_scope_unique_idx"
  ON "memories" ("hash", COALESCE("user_id", ''), COALESCE("session_id", ''), COALESCE("agent_id", ''));
```

Backward-compat: pre-cycle rows keep their existing IDs; the v0.1 UNIQUE made cross-scope collisions impossible, so pre-cycle DB has at most 1 row per hash — the composite index installs cleanly. EC-4 absorption: existing rows get `confirmation_count = 1` via DEFAULT (the v0.1 schema didn't track confirmations, so 1 is the honest floor — NOT a fabricated count; commit body discloses this).

**TDD:**
- RED: `tests/integration/migrations/migration-0011.test.ts` — assert (a) `runMigrations(pool)` on fresh DB applies migration; `confirmation_count` column exists via `information_schema.columns`; (b) idempotent re-run is no-op; (c) DEFAULT 1 applied to backfill rows (EC-4 absorption); (d) `memories_hash_unique_idx` is GONE; (e) `memories_hash_scope_unique_idx` exists with 4-column UNIQUE definition; (f) scope-isolation test: write same `hash` from `user:alice` AND `user:bob` via raw INSERT (bypass pipeline); both succeed — 2 distinct rows persist with `confirmation_count = 1` each (EC-1 absorption).
- GREEN: write the migration SQL with 3 statements above; update journal tag.
- REFACTOR: ensure each ALTER + DROP + CREATE statement is `IF NOT EXISTS` / `IF EXISTS` so re-run on already-migrated DB is a no-op.

**Acceptance Criteria:**
- [ ] `0011_confirmation_count_and_composite_unique.sql` exists with 3 statements: ADD COLUMN + DROP INDEX + CREATE UNIQUE INDEX (all `IF NOT EXISTS` / `IF EXISTS`)
- [ ] `_journal.json` updated; `0011_snapshot.json` created
- [ ] `schema.ts` declares `confirmationCount` + replaces global UNIQUE with composite UNIQUE
- [ ] Idempotent re-run verified
- [ ] **EC-1 absorption**: 4 assertions — composite UNIQUE present; old global UNIQUE absent; cross-scope same-hash writes succeed; cross-scope same-hash bumps confirmation_count of WRONG row does NOT occur
- [ ] **EC-4 absorption**: pre-cycle rows have `confirmation_count = 1` (DEFAULT); commit body explicitly discloses "v0.1 pre-cycle rows lose actual historical count — DEFAULT 1 is honest floor, not fabricated history"
- [ ] `postbuild:copy-migrations` ships `dist/local/migrations/0011_confirmation_count_and_composite_unique.sql`

**DoD:**
- [ ] `npm test` PASS (no regression — count unchanged)
- [ ] `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/migrations/migration-0011.test.ts` PASS (≥ 6 assertions)
- [ ] Typecheck + lint clean
- [ ] CHANGELOG.md `[Unreleased]` § Fixed entry: "v0.1 cross-scope dedup defect — `memories_hash_unique_idx` global UNIQUE replaced by composite `memories_hash_scope_unique_idx` per `principles-alignment-hardening` ADR D5"

## Phase T1 — Dedup-collision UPSERT branch + event

### T1.1 — `PgvectorStore.insert` switches to `ON CONFLICT` composite + `dedup_collision_confirmed` event (EC-1 + EC-2 + EC-5 absorption)

**Files:** `src/local/pgvector-store.ts` (EDIT — insert SQL); `src/local/__tests__/pgvector-store.test.ts` (EDIT — append RED tests); `src/core/memory-event.ts` (EDIT — add `dedup_collision_confirmed` literal); `src/core/__tests__/memory-event.test.ts` (EDIT — pin new literal); **EC-2 audit-driven additions** (populated from T0.0 audit report): `${all files identified at T0.0 as pinning MEMORY_EVENTS.length OR exhaustive toEqual}` (EDIT — bump length pin from 13 → 16 OR add the 3 new literals to verbatim arrays)

**Deep file dependency analysis:** `PgvectorStore.insert` currently issues `INSERT INTO memories (...) VALUES (...) RETURNING id`. Per ADR D5 + EC-1 absorption, the ON CONFLICT clause now keys on the COMPOSITE UNIQUE created at T0.1: `ON CONFLICT (hash, COALESCE(user_id, ''), COALESCE(session_id, ''), COALESCE(agent_id, '')) DO UPDATE SET confirmation_count = memories.confirmation_count + 1 RETURNING id, confirmation_count, (xmax = 0) AS inserted`. The `(xmax = 0)` is the canonical PG trick to know if the row was inserted (`true`) vs updated (`false`). When `inserted=false`, emit `dedup_collision_confirmed` event with attributes `{ memory_id, confirmation_count, scope_tier }`.

**TDD:**
- RED: write the following tests:
  1. `test('dedup collision SAME-scope bumps confirmation_count and returns existing memoryId')` — assert: 2nd insert of same hash + same `user_id` returns SAME id; `confirmation_count` 1→2; `dedup_collision_confirmed` event captured.
  2. **EC-1 absorption** `test('dedup collision DIFFERENT-scope creates NEW row, does NOT bump foreign scope confirmation_count')` — alice writes "I like coffee" (row 1, confirmation_count=1); bob writes same text; assert: row 2 created with different `id`, `user_id='bob'`, `confirmation_count=1`; row 1 (alice) has `confirmation_count=1` UNCHANGED. `rejectedAsDuplicate=false` for bob's MemoryItem.
  3. **EC-5 absorption** `test('dedup_collision_confirmed event no-op when tracer === undefined')` — instantiate PgvectorStore with deps lacking `tracer`; trigger collision; assert (a) operation completes without throw; (b) no span created; (c) memoryId returned correctly.
- GREEN: rewrite the INSERT SQL with composite ON CONFLICT; emit the event in the `inserted=false` branch via existing `emitEvent` infra (handles tracer-absent gracefully per architecture).
- REFACTOR: extract event emission to a private helper if reused across get/list paths in T2.1.

**Acceptance Criteria:**
- [ ] `MEMORY_EVENTS` const includes `dedup_collision_confirmed`
- [ ] `MemoryEvent` exhaustiveness checks PASS in any existing switch (zero `noImplicitReturns` errors)
- [ ] Insert SQL uses composite `ON CONFLICT (hash, COALESCE(user_id, ''), COALESCE(session_id, ''), COALESCE(agent_id, ''))` per ADR D5
- [ ] Event emitted only when `inserted=false` (not on fresh inserts); not emitted at all when tracer absent (EC-5)
- [ ] Event attributes include `memory_id`, `confirmation_count` (post-bump), `scope_tier`
- [ ] **EC-1 absorption**: cross-scope test passes — bob's write creates a new row, doesn't affect alice
- [ ] **EC-2 absorption**: every file identified at T0.0 audit as pinning `MEMORY_EVENTS.length === 13` updated to `=== 16` OR adds the 3 new literals to verbatim arrays
- [ ] **EC-5 absorption**: tracer-undefined test passes

**DoD:**
- [ ] `npm test -- pgvector-store.test.ts` PASS
- [ ] `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/local-runtime.test.ts` PASS (no regression on existing 8-phase write pipeline)
- [ ] Typecheck + lint clean

## Phase T2 — DTO widening (MemoryItem.confirmationCount + rejectedAsDuplicate)

### T2.1 — Widen `MemoryItem` interface + propagate

**Files:** `src/core/memory-item.ts` (EDIT — add 2 optional fields with JSDoc cross-refs to CLAUDE.md § IMPORTANTE); `src/core/index.ts` (EDIT — no change needed; re-exports the interface); `src/local/pgvector-store.ts` (EDIT — populate fields in `RETURNING` projection); `src/core/__tests__/memory-item.test-d.ts` (NEW — type-narrow test); `tests/integration/principles/dto-widening.test.ts` (NEW — round-trip integration)

**Deep file dependency analysis:** `MemoryItem` is the leaf DTO of the public contract barrel. Adding 2 optional fields is backward-compatible. The `RETURNING` projection in `PgvectorStore.insert` must include `confirmation_count` so the wrap site can populate `confirmationCount`. The `rejectedAsDuplicate` flag is set by the wrap site (`LocalScopedMemory.remember` reads `inserted` from the UPSERT result and sets the flag).

**TDD:**
- RED: `test-d` asserts `MemoryItem.confirmationCount?: number` and `MemoryItem.rejectedAsDuplicate?: boolean` are narrowable; integration test: `remember()` twice with same text; assert first call returns item with `rejectedAsDuplicate=false|undefined` + `confirmationCount=1`; second call returns item with `rejectedAsDuplicate=true` + `confirmationCount=2`.
- GREEN: widen the interface; thread the values through PgvectorStore + LocalScopedMemory.
- REFACTOR: ensure JSDoc on each new field cites the Princípio that motivates it.

**Acceptance Criteria:**
- [ ] `MemoryItem.confirmationCount?: number` exists with JSDoc citing CLAUDE.md § IMPORTANTE Princípio 1
- [ ] `MemoryItem.rejectedAsDuplicate?: boolean` exists with JSDoc citing CLAUDE.md § IMPORTANTE Princípio 3
- [ ] `src/core/index.ts` re-exports `MemoryItem` (already does — no change needed; sentinel test)
- [ ] `test-d` type-narrowing test passes
- [ ] Round-trip integration test passes (4 assertions across 2 remember() calls)
- [ ] **EC-6 absorption**: `pgvector-store.get` + `pgvector-store.list` projection includes `confirmation_count`; integration test `test_pgvector_store_get_returns_memory_item_with_confirmation_count` + `test_pgvector_store_list_returns_items_with_confirmation_count` assert `confirmationCount = 2` after 2 same-scope writes
- [ ] **EC-7 absorption**: files identified at T0.0 audit as using `Object.keys(memoryItem).length === N` OR `toEqual({ verbatim full shape })` are listed in "Files to edit" preemptively; each gets a 1-line `+ confirmationCount: undefined, rejectedAsDuplicate: undefined` OR switches to `toMatchObject` partial matcher

**DoD:**
- [ ] `npm test` PASS
- [ ] `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/principles/` PASS
- [ ] Typecheck transitive expansion clean (architecture.md § Typecheck scope gotcha)
- [ ] **EC-7 verification**: `grep -rn "Object.keys.*memor.*length" src/ tests/` returns zero unhandled hits after T2.1 lands

## Phase T3 — extraction_zero_facts event

### T3.1 — Emit event when LLM extraction returns drafts=[]

**Files:** `src/core/extraction/pipeline.ts` (EDIT — emit event in zero-drafts branch); `src/core/memory-event.ts` (EDIT — add `extraction_zero_facts` literal); `src/core/__tests__/extraction-pipeline.test.ts` (EDIT — append RED test)

**Deep file dependency analysis:** `runExtractionPipeline` at `src/core/extraction/pipeline.ts` has a `if (extracted.length === 0) return []` early-return path (Phase 2 LLM extraction). Emit `extraction_zero_facts` BEFORE the return with attributes `{ input_length: messages[0].content.length, scope_tier: filters.user_id ? 'user' : ... }`.

**TDD:**
- RED: `test('emits extraction_zero_facts when LLM returns empty drafts')` — stub LLM to return `{ memory: [] }`; call `runExtractionPipeline`; assert (a) result is `[]`; (b) event captured via `vi.spyOn(tracer, 'startSpan')`-style infra OR direct `emitEvent` mock.
- GREEN: insert `emitEvent(tracer, 'extraction_zero_facts', { ... })` call before the early return.
- REFACTOR: extract attribute construction to a pure helper if reused.

**Acceptance Criteria:**
- [ ] `MEMORY_EVENTS` includes `extraction_zero_facts`
- [ ] Event fires exactly when `extracted.length === 0` (not on non-empty extraction)
- [ ] Event attributes include `input_length` + `scope_tier`
- [ ] No regression on existing extraction pipeline tests
- [ ] RED test passes
- [ ] **EC-2 absorption**: files identified at T0.0 audit pinning MEMORY_EVENTS (shared with T1.1 + T4.1) updated
- [ ] **EC-5 absorption**: `test_extraction_zero_facts_no_op_when_tracer_undefined` — pipeline invoked without `tracer` field; no throw; no span; empty drafts returned correctly

**DoD:**
- [ ] `npm test -- extraction-pipeline.test.ts` PASS
- [ ] Typecheck + lint clean

## Phase T4 — recall_threshold_filtered + MMR diversify

### T4.1 — `recall_threshold_filtered` event emission

**Files:** `src/core/retrieval/pipeline.ts` (EDIT — capture pre-threshold count; emit event after threshold filter step); `src/core/memory-event.ts` (EDIT — add `recall_threshold_filtered` literal); `src/core/__tests__/retrieval-pipeline.test.ts` (EDIT — append RED test)

**Deep file dependency analysis:** Step 8 (threshold gating) of the 9-step search applies `combined >= threshold` filter. Capture `preThresholdCount` BEFORE and `postThresholdCount` AFTER; emit `recall_threshold_filtered` with `attributes.filtered_count = preThresholdCount - postThresholdCount` IFF the difference is non-zero (avoid emission on no-op filter).

**TDD:**
- RED: `test('emits recall_threshold_filtered with filtered_count when sub-threshold rows are dropped')` — seed 5 memories; recall with high threshold so 3 are dropped; assert event captured with `filtered_count=3`.
- GREEN: capture counts; emit event.
- REFACTOR: ensure event NOT emitted when filtered_count === 0 (no-op observability discipline).

### T4.2 — `RecallOptions.diversify?: { lambda: number; topPool?: number }` MMR rerank

**Files:** `src/core/options.ts` (EDIT — add field); `src/core/retrieval/pipeline.ts` (EDIT — add MMR rerank step BEFORE topK truncation); `src/core/retrieval/mmr.ts` (NEW — pure function `mmrRerank(candidates, lambda, topPool, k)`); `src/core/retrieval/__tests__/mmr.test.ts` (NEW — pure-function unit tests); `tests/integration/principles/mmr-diversify.test.ts` (NEW — integration test for redundancy reduction)

**Deep file dependency analysis:** MMR algorithm: greedy selection where each iteration picks the candidate maximizing `lambda * relevance(c) - (1 - lambda) * max(similarity(c, selected))`. Operates on candidates' `embedding` field; reuses cosine similarity already imported. `topPool` defaults to `topK * 3`. File size budget: ~80 LoC for `mmr.ts` (well under 500 LoC budget per architecture.md § Module hygiene).

**TDD:**
- RED: unit tests at `src/core/retrieval/__tests__/mmr.test.ts` — assert: empty input returns empty; lambda=1 returns relevance-only order; lambda=0 returns diversity-only order; lambda=0.7 returns intermediate (specific ordering verified via fixture). Integration test: seed 10 near-paraphrases of "Alice likes coffee" + 5 distinct facts; recall with `diversify: { lambda: 0.7 }`; assert result set has ≤ 3 "Alice coffee" rows (vs 7+ without diversify).
- GREEN: implement `mmrRerank`; wire into `runRetrievalPipeline` AFTER score combine, BEFORE topK.
- REFACTOR: ensure MMR step is no-op when `options.diversify === undefined` (zero contract change for existing callers).
- **EC-3 absorption** `test_mmrRerank_throws_on_lambda_outside_unit_interval` — call `mmrRerank(candidates, lambda=1.5)` AND `mmrRerank(candidates, lambda=-0.1)`; assert both throw typed `InvalidScope` (or new `InvalidDiversifyOption` if a typed error class is preferred — choice deferred to GREEN phase per architecture.md § 8 boundary validation). Validation lives in `RecallOptions` zod schema OR in `runRetrievalPipeline` BEFORE the rerank call.

**Acceptance Criteria for both T4.1 + T4.2:**
- [ ] `MEMORY_EVENTS` includes `recall_threshold_filtered`
- [ ] `RecallOptions.diversify?: { lambda: number; topPool?: number }` exists with JSDoc citing CLAUDE.md § IMPORTANTE Princípio 2
- [ ] `mmr.ts` file ≤ 100 LoC; cyclomatic ≤ 6
- [ ] MMR is no-op when `options.diversify` undefined (regression test asserts byte-identical result against pre-cycle baseline)
- [ ] Integration test demonstrates ≥ 40% near-duplicate reduction on synthetic high-collinearity set — **EC-9 DOCUMENT absorption**: threshold is fixture-dependent. If empirical run measures < 40%, options are (a) retune fixtures (more collinear paraphrases) with full disclosure in commit body, OR (b) adjust threshold to observed value with rationale paragraph in commit body. NOT acceptable: silent fixture padding. Inquebrável Rule 3 enforces honest disclosure.
- [ ] **EC-2 absorption**: files identified at T0.0 audit pinning MEMORY_EVENTS (shared with T1.1 + T3.1) updated
- [ ] **EC-3 absorption**: `lambda ∉ [0, 1]` validation throws typed error at boundary
- [ ] **EC-5 absorption**: `test_recall_threshold_filtered_no_op_when_tracer_undefined` — retrieval pipeline invoked without `tracer` field; no throw; no span; result returned correctly

**DoD:**
- [ ] `npm test -- retrieval-pipeline.test.ts mmr.test.ts` PASS
- [ ] `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/principles/mmr-diversify.test.ts` PASS
- [ ] Typecheck + lint clean

## Phase T5 — Integration test suite

### T5.1 — `tests/integration/principles-alignment-hardening.test.ts`

**Files:** `tests/integration/principles-alignment-hardening.test.ts` (NEW); `tests/fixtures/principles/near-paraphrases.ts` (NEW — fixture set)

**Deep file dependency analysis:** Single integration test file consolidates the 4 sub-goals into a real-pgvector round-trip. Fixtures include 10 near-paraphrases + 5 distinct facts (the same set used by T4.2 integration but reusable here for the combined assertion suite).

**TDD:** This task IS the integration test — it asserts the combined behavior of T0-T4. Already covered by per-task RED+GREEN; this file is the consolidated assertion suite.

**Acceptance Criteria (THE GOAL TEST per the plan Goal):**
- [ ] ≥ 18 assertions verifying the 4 sub-goals end-to-end (was 16; EC-1 absorption adds 2 cross-scope assertions)
- [ ] Assertion 1-4 (Princípio 1 confirmation_count SAME-scope): alice writes same fact 3× → 1 row with confirmation_count=3; `MemoryItem.confirmationCount` surfaces correctly
- [ ] **EC-1 absorption Assertion 5-6 (Princípio 1 scope isolation)**: bob writes the SAME fact alice wrote; assert (a) NEW row created with `confirmation_count = 1`, (b) alice's row's `confirmation_count` UNCHANGED, (c) `rejectedAsDuplicate=false` returned to bob
- [ ] Assertion 7-10 (Princípio 3 IGNORE auditability): 3 IGNORE events captured (`extraction_zero_facts`, `dedup_collision_confirmed`, `recall_threshold_filtered`) with correct attribute shapes
- [ ] Assertion 11-14 (Princípio 3 rejectedAsDuplicate flag): 2nd write SAME scope returns `rejectedAsDuplicate=true`; 1st write does not; cross-scope 2nd write returns `rejectedAsDuplicate=false`
- [ ] Assertion 15-18 (Princípio 2 diversify): with `diversify: { lambda: 0.7 }`, near-paraphrase redundancy reduction meets the empirical threshold per **EC-9 disclosure policy** — if 40% target not met, commit body explains rationale and either retunes fixtures OR adjusts target with rationale; silent fixture padding NOT acceptable

**DoD:**
- [ ] `THEOMEM_PG_URI=... npm run test:integration -- tests/integration/principles-alignment-hardening.test.ts` exits 0
- [ ] 18/18 assertions PASS (was 16; EC-1 absorption adds 2 cross-scope assertions per v1.1 amendment)

## Phase T6 — Final Phase: Integration Validation (MANDATORY)

### T6.1 — Run all gates + /review readiness

```bash
npm test                                                    # ~1000-1010 contract / 2 skipped
npm run typecheck                                           # 0 errors
npm run lint                                                # 0 warnings
THEOMEM_PG_URI=... npm run test:integration                 # all PASS including new principles tests
npm run build && ls dist/local/migrations/0011*.sql         # postbuild verified
```

Then check: `grep -c "PRIORITY 0" CLAUDE.md` ≥ 19 (no accidental erosion of the P0 lock during this cycle).

**Acceptance Criteria:**
- [ ] All 5 gates above exit 0
- [ ] Coverage on `src/core/extraction/pipeline.ts` + `src/core/retrieval/pipeline.ts` + `src/core/retrieval/mmr.ts` ≥ 90% — **EC-8 DOCUMENT absorption**: `package.json` does NOT ship a `test:coverage` script (pre-existing repo gap). Coverage gate is MANUAL via `npx vitest run --coverage --include='src/core/extraction/**/*.ts' --include='src/core/retrieval/**/*.ts'`. If `npx vitest --coverage` requires the c8 dependency (not currently in devDeps), gate is SKIPPED-WITH-DISCLOSURE in commit body (mirrors `dogfood-golden-rule.md` precedent for unverifiable gates). Adding c8 to devDeps would require a separate `/deps-audit` cycle — out of scope for THIS plan per Inquebrável Rule 11 YAGNI.
- [ ] CHANGELOG.md `[Unreleased]` § Added entry for confirmation_count + diversify + 3 new events
- [ ] CHANGELOG.md `[Unreleased]` § Fixed entry for the v0.1 global UNIQUE → composite UNIQUE per ADR D5 / EC-1
- [ ] CHANGELOG entry cites CLAUDE.md § IMPORTANTE principles by name
- [ ] No new `// TODO` / `// FIXME` introduced (`git diff main..HEAD | grep -cE "^\+.*//\s*(TODO|FIXME)"` returns 0)
- [ ] **EC-10 absorption**: `git log --oneline` since v1.1 plan-edit commit shows the order: `plan(amend)` → `chore(audit)` (T0.0) → `fix(local)` (T0.1) → `feat(local)` (T1.1) → `feat(core)` (T2.1) → `feat(core)` (T3.1) → `feat(core)` (T4.1+T4.2) → `test(integration)` (T5.1). NO `feat`/`fix` commit predates the `plan(amend)` commit referencing ADR D5. Manually verified by cross-validation reviewer at `/review`.

**DoD:**
- [ ] Final integration validation passes
- [ ] `/review principles-alignment-hardening` returns `READY_TO_MERGE` OR `READY_TO_MERGE_WITH_CAVEATS` with 0 NEW MAJOR

## Coverage Matrix

| # | Requirement | Source | Task(s) |
|---|---|---|---|
| 1 | Princípio 1 — `confirmação` factor as queryable signal | CLAUDE.md § IMPORTANTE (lines 2-3) + 2026-06-04 audit | T0.1 + T1.1 + T2.1 |
| 2 | Princípio 2 — priorização > volume via diversification | CLAUDE.md § IMPORTANTE (lines 5-6) + 2026-06-04 audit | T4.2 + T5.1 |
| 3 | Princípio 3 — IGNORE auditability (3 decisions) | CLAUDE.md § IMPORTANTE (lines 8-9) + 2026-06-04 audit | T1.1 (dedup_collision_confirmed) + T3.1 (extraction_zero_facts) + T4.1 (recall_threshold_filtered) |
| 4 | Princípio 3 — `rejectedAsDuplicate` consumer-visible flag | CLAUDE.md § IMPORTANTE + 2026-06-04 audit | T2.1 |
| 5 | Public API audit — every new field has @see cross-ref | CLAUDE.md § PRIORITY 0 Sub-goal 1 | T2.1 (JSDoc + cross-refs) |
| 6 | Integration test ≥ 18 assertions THE GOAL TEST | this plan Goal (v1.1 — was 16; EC-1 adds 2 cross-scope) | T5.1 |
| 7 | Final validation gates | cycle-plan.md § Phase contracts | T6.1 |
| 8 | EC-1 `MUST FIX` — v0.1 scope leak via global `hash` UNIQUE → composite UNIQUE per ADR D5 | edge-cases review § MUST FIX | T0.1 (migration + index swap) + T1.1 (ON CONFLICT composite + cross-scope test) + T5.1 (cross-scope assertions 5-6) |
| 9 | EC-2 `MUST FIX` — `MEMORY_EVENTS` pinning audit precedes literal additions | edge-cases review § MUST FIX | T0.0 (grep audit + classification) + T1.1 + T3.1 + T4.1 (downstream literal additions consume audit) |
| 10 | EC-3 `SHOULD-TEST` — `mmrRerank` throws on `lambda ∉ [0, 1]` | edge-cases review § SHOULD-TEST | T4.2 (boundary validation per architecture.md § 8) |
| 11 | EC-4 `SHOULD-TEST` — pre-cycle row backfill semantics (DEFAULT 1 is honest floor, not fabricated history) | edge-cases review § SHOULD-TEST | T0.1 (commit body disclosure + semantic test) |
| 12 | EC-5 `SHOULD-TEST` — events no-op when `tracer === undefined` | edge-cases review § SHOULD-TEST | T1.1 + T3.1 + T4.1 (shared sibling test pattern) |
| 13 | EC-6 `SHOULD-TEST` — `pgvector-store.get` + `.list` project `confirmation_count` into returned MemoryItems | edge-cases review § SHOULD-TEST | T2.1 (get/list projection + 2 integration tests) |
| 14 | EC-7 `SHOULD-TEST` — rigid `toEqual` / `Object.keys` shape pinning audit precedes `MemoryItem` widening | edge-cases review § SHOULD-TEST | T0.0 (audit) + T2.1 (preemptive matcher upgrades) |
| 15 | EC-8 `DOCUMENT` — `test:coverage` script absent; gate is manual via `npx vitest --coverage` SKIP-WITH-DISCLOSURE if unsupported | edge-cases review § DOCUMENT | T6.1 (manual invocation + disclosure policy) |
| 16 | EC-9 `DOCUMENT` — `≥ 40%` MMR redundancy threshold is fixture-dependent; honest disclosure if not met (retune OR adjust, NOT silent pad) | edge-cases review § DOCUMENT | T4.2 (integration test) + T5.1 (assertion 15-18 disclosure clause) |
| 17 | EC-10 `DOCUMENT` — commit ORDER discipline: `git log --oneline` sentinel mirrors fixes-cycle-1 EC-1 pattern; cross-validation reviewer verifies | edge-cases review § DOCUMENT | T6.1 (cross-validation discipline + Dependency Graph EC-10 callout) |

**Coverage: 17/17 = 100%** (was 7/7; v1.1 absorption adds 10 EC rows — 2 `MUST-FIX` + 5 `SHOULD-TEST` + 3 `DOCUMENT` — each mapped to ≥ 1 task per cycle-plan.md hard gate).

## Dependencies

### Existing

| Package | Version | Used by |
|---|---|---|
| `pg` | `^8.13.0` | Existing PgvectorStore — UPSERT SQL uses native `ON CONFLICT` syntax |
| `drizzle-orm` | `^0.45.0` | Existing schema declaration + migration toolchain |
| `@opentelemetry/api` | `^1.9.0` | Existing `emitEvent` infrastructure |
| `vitest` | `^4.0.0` | Existing test runner |

### New

None — Inquebrável Rule 11 (YAGNI). MMR is implemented as a pure ≤ 100 LoC function over existing `number[]` embeddings + cosine similarity. No external diversification library.

### Removed

None.

### Accepted Risks (inherited from v1.5.0 envelope)

Per `/deps-audit` baseline 2026-06-03: 8 active allowlist CVEs (1 CRITICAL `protobufjs` + 7 HIGH/MODERATE) inherited from prior cycles; 9 outdated MAJORs untouched by this plan. NOT introduced by this hardening cycle.

## Global Definition of Done

- [ ] All T0/T1/T2/T3/T4/T5/T6 tasks complete with per-task DoD satisfied
- [ ] `npm test` exits 0 with count climbing from ~999 to ~1010 PASS
- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0 (zero warnings)
- [ ] `THEOMEM_PG_URI=... npm run test:integration` exits 0 with new principles tests included
- [ ] **File-size budget honored per `architecture.md § Module hygiene`**: no new source file exceeds 500 LoC. New file `src/core/retrieval/mmr.ts` targeted ≤ 100 LoC. Existing files getting field additions (`memory-item.ts`, `memory-event.ts`, `options.ts`, `pgvector-store.ts`, `pipeline.ts`) gain net +5 to +20 LoC each — well within budget.
- [ ] CHANGELOG.md `[Unreleased]` § Added entry cites CLAUDE.md § IMPORTANTE principles by name + lists 4 sub-goal closures
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/principles-alignment-hardening-plan.md` post-merge
- [ ] `/review principles-alignment-hardening` returns `READY_TO_MERGE` OR `READY_TO_MERGE_WITH_CAVEATS` with 0 NEW MAJOR

## Followups

| # | Item | Why deferred |
|---|---|---|
| F-1 | Consumer-side `recall<DerivedFrom>` narrowing for derived memories (provenance reveal at type level) | Out of P0 scope; pure type-narrowing improvement |
| F-2 | `confirmation_count` consumption by `TriadicScoringPolicy` (Princípio 1 closes loop) | Out of P0 scope — this plan EXPOSES the signal; scoring strategy that CONSUMES it is a v0.4b+ extension |
| F-3 | MMR `lambda` per-scope-tier defaults via `RecallCacheStoreConfig`-style configuration | Out of P0 scope — opt-in flag suffices for v1.5.x |
| F-4 | REST API surface (`@usetheo/memory/server`) exposes `diversify` + `rejectedAsDuplicate` via OpenAPI 3.1 schema | Plan as `principles-alignment-hardening-rest-followup` after T6 lands |
| F-5 | MCP tool `remember` exposes `rejectedAsDuplicate` in tool output | Plan as `principles-alignment-hardening-mcp-followup` after T6 lands |

## Related

- Cycle rule: `.claude/rules/cycle-plan.md` (this is phase 1 of cycle-plan; cycle-implement next under PRIORITY 0 hardening discipline)
- Cycle rule: `.claude/rules/cycle-review.md` (T6.1 invokes `/review`)
- Source-of-truth: `CLAUDE.md` § IMPORTANTE (lines 2-9) + § PRIORITY 0 (locked 2026-06-04)
- Architecture: `.claude/rules/architecture.md` § 2 ADD-only + § 3 DIP boundaries + § 4 Mem0-shape + § 9 Public API surface + § Module hygiene
- Testing: `.claude/rules/testing.md` § TDD Red-Green-Refactor + § Pyramid + § Determinism
- Prior cycle precedent for migration + schema discipline: `semantic-recall-cache-v1-5-plan.md` task `T0.2` (migration 0010 with parity sentinel)
- Inquebrável rules cited: Rule 3 (extreme honesty), Rule 11 (YAGNI), Rule 4 (git safety), architecture.md § 2 ADD-only
