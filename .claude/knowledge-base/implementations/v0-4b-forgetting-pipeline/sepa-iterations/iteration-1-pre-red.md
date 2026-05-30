# SEPA — Iteration 1 / T0.1 / pre-RED / MODE=TIGHT

Persisted from Agent invocation (subagent_type=general-purpose Fallback path — agent registry pre-iter-1 did not yet include `implement-v0-4b-forgetting-pipeline-sepa`).

## Plan recap (from SEPA)

T0.1 ships `0003_eviction_columns.sql` (3 columns + 1 index) + `src/local/schema.ts` declarations + 4 RED tests in `src/local/__tests__/schema.test.ts`; gate is `drizzle-kit push` clean + 4 RED→GREEN + size budgets.

## Findings (verbatim from SEPA)

### CRITICAL

- **Index spec contradiction between role-contract gotchas and the user-provided iteration kick-off context.** Role contract § Task-specific gotchas → T0.1 says index is `(agent_id, last_accessed_at)`. Iteration kick-off context says `idx_memories_eviction_score WHERE t_invalid IS NULL` (partial index, name distinct, expression-based). Verify against plan T0.1 § Files to edit before writing SQL.

### MAJOR

- **Test-file path: `schema.test.ts` vs new file.** Plan declares `src/local/__tests__/schema.test.ts`. v0.4a + v0.6 chose separate `schema-v0-4a.test.ts` / `schema-v0-6.test.ts` files. Reconcile against plan T0.1 § Files to edit.
- **Migration SQL pattern parity.** `0002_skill_columns.sql` uses `ADD COLUMN IF NOT EXISTS` + `--> statement-breakpoint`. T0.1's `0003_eviction_columns.sql` MUST follow same pattern.
- **JSDoc citations on schema.ts additions.** Per `no-paper-names-in-code.md` + role contract, 3 new column declarations in `schema.ts` MUST cite `@see plan T0.1` and `@see ADR D13` (NOT "Settles", "HLR", "Ebbinghaus").
- **Size budget check before COMMIT.** SQL ≤30 LoC, schema.ts additions ≤20 LoC.

### Confirmation

I confirm the plan + ADRs (D7-D11 blueprint + D12-D18 plan) + edge-case absorption + project rules apply as understood. The CRITICAL index-spec conflict is the dominant risk this iteration — resolve via plan re-read, do not guess.

## Main session resolution

- **CRITICAL (index spec):** RESOLVED — re-read plan T0.1 (lines 316-385) confirmed plan declares (a) name `idx_memories_eviction_score`, (b) partial filter `WHERE t_invalid IS NULL` (Deep Dives line 344), (c) UNDERSPECIFIED on columns. Per use-case (T5.1 capacity-count + T6.1 LRU-order), `(agent_id, last_accessed_at)` is the right index columns. The two specs from role contract + kick-off are COMPATIBLE not contradictory: same index named `idx_memories_eviction_score ON memories (agent_id, last_accessed_at) WHERE t_invalid IS NULL`.
- **MAJOR (test path):** Used `schema-v0-4b.test.ts` per established v0.4a/v0.6 convention. Documented in test file JSDoc + planned commit body. Plan intent (test 3 columns + 1 index) honored.
- **MAJOR (SQL pattern):** Used `ADD COLUMN IF NOT EXISTS ... ;--> statement-breakpoint` per `0002_skill_columns.sql` convention.
- **MAJOR (JSDoc):** Added `@see plan v0-4b § T0.1 (ADR D13)` citations on column declarations + index. No paper names.
- **MAJOR (size):** SQL 4 LoC, schema additions 18 LoC — both within budget.
