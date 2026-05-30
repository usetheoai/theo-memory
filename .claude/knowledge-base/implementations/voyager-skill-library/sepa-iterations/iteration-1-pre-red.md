# SEPA brief — task T0.1 (phase: pre-RED) — iteration 1

**Recap of plan declaration:** T0.1 ships migration `0002_skill_columns.sql` adding 4 nullable columns (`superseded_by UUID NULL FK`, `code TEXT NULL`, `description TEXT NULL`, `code_language VARCHAR(20) NULL`) and relaxing the `kind` CHECK to include `'skill'`, idempotently against a v0.4a-applied database; schema.ts updated in parallel; RED tests in `src/local/__tests__/schema.test.ts` assert the new columns + CHECK behavior before any GREEN code lands.

**Watchpoints for this phase:**
- **EC-1 verbatim constraint name (HIGH SEVERITY):** the DDL MUST cite `memories_kind_derived_from_check` BY NAME in `ALTER TABLE "memories" DROP CONSTRAINT IF EXISTS "memories_kind_derived_from_check"` then `ADD CONSTRAINT "memories_kind_derived_from_check" CHECK (...)`. Verified at `0001_reflection_columns.sql:16` + `schema.ts:72`. If migration relies on Drizzle auto-naming or omits explicit name, FLAG `[CRITICAL]`.
- **CHECK semantics expansion:** new CHECK must preserve v0.4a invariants AND add third arm for `'skill'`. Per plan ambiguity, skills from `add()` carry NULL `derived_from`; skills from `consolidate()` carry non-empty array. Recommended: `(kind = 'skill' AND (derived_from IS NULL OR jsonb_array_length(derived_from) >= 1))`.
- **CHECK DROP-then-ADD ordering:** ADD COLUMN IF NOT EXISTS FIRST, THEN DROP+ADD CHECK.
- **`superseded_by` FK semantics:** plan declares `REFERENCES memories(id) ON DELETE SET NULL` self-FK.
- **Idempotency:** running migrations twice = no error.
- **TDD RED shape — behavior not structure:** Per testing.md anti-patterns, prefer behavioral assertions over structural introspection where possible.
- **schema.ts existing CHECK constraint already named** — line 72 has literal `'memories_kind_derived_from_check'`; schema.ts edit extends `check()` SQL template; constraint NAME unchanged.
- **`db:generate` vs hand-written SQL order:** update schema.ts FIRST, run `db:generate` to emit SQL+snapshot+journal, THEN hand-edit SQL to inject explicit `DROP CONSTRAINT IF EXISTS "memories_kind_derived_from_check"` (Drizzle may not auto-emit).

**Cross-references checked:**
- ADR D3 (REUSE pgvector + Drizzle schema with `kind='skill'`)
- EC-1 absorption marker verified in plan v1.1 §T0.1 "Deep Dives"
- `architecture.md` § Module hygiene (schema.ts 149 LoC; under 500 budget)
- `testing.md` § What to test → `src/local/`, § BDD format mandatory
- Inquebrável Rule 5 (TDD-first), Rule 7 (testes não negociáveis)

**Recommendations:**
- **OK** — plan T0.1 structurally sound; EC-1 absorption well-specified. Proceed.
- **CAUTION** — order: update schema.ts FIRST → run `npm run db:generate` → hand-edit SQL to add explicit DROP CONSTRAINT.
- **CAUTION** — CHECK for `kind='skill'` accepts BOTH NULL `derived_from` (from add) AND non-empty array (from consolidate). RED test covers both.
- **CAUTION** — `superseded_by` FK uses `references(() => memories.id, { onDelete: 'set null' })` mirroring `history.memoryId` pattern at schema.ts:138.
- **OK** — extend existing `schema.test.ts` per plan literal; the v0.4a sibling `schema-v0-4a.test.ts` is precedent not contract.
- **OK** — files-to-edit all map; no fabrication risk.
