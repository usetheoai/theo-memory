# Plan: voyager-skill-library v0.6 — code-as-skill procedural memory with provenance

> **Version 1.1** — Ship `memory.skills(repoId)` as a code-as-skill procedural-memory layer in `@usetheo/memory`. REUSES the v0.4a `Memory.reflect()` chain (no sibling chain) and extends it additively with `kind='skill'` discriminator, `superseded_by` Voyager-style versioning, and a 4-phase orchestrator wrapper inspired by Mem0 memory-dream. Consumes the blueprint at `.claude/knowledge-base/discoveries/blueprints/voyager-skill-library-blueprint.md` v1.0 (SHIPPABLE_WITH_CAVEATS verdict 2026-05-29).
>
> **Change log:**
> - **v1.0 (2026-05-29):** initial draft. 5 ADRs, 9 tasks across 6 phases, Coverage Matrix 10/10.
> - **v1.1 (2026-05-29):** absorbed 4 MUST FIX from `voyager-skill-library-edge-cases-2026-05-29.md`. EC-1 names the CHECK constraint `memories_kind_derived_from_check` explicitly in T0.1 DDL. EC-2 adds withTransaction atomicity sub-item to T3.1. EC-3 extends Orient phase to filter `includeSuperseded:false` + extends `GetAllOptions` in T2.2. EC-4 expands T4.1 Files to edit with 2 missing switch sites (`src/local/reflection/threshold-reflection-policy.ts`, `src/core/reflection/prompt.ts`) — discriminant exhaustiveness across 4 sites is non-trivial.

## Goal

> "Ship `memory.skills(repoId)` enabling code-agents to persist, recall, and consolidate executable TypeScript skills with `derived_from` provenance + Voyager-style versioning, measured by an integration test `tests/integration/skills/consolidate-two-skills.test.ts` that proves consolidation of 2 syntactically-different but semantically-equivalent skills yields 1 derived skill whose `derived_from = [src1.id, src2.id]` against real `ankane/pgvector:v0.5.1`."

The action verb is **ship**; the named observable metric is the integration test name + the verified `derived_from` invariant. Single sentence. Pulled directly from CLAUDE.md roadmap Item 8 acceptance criterion.

## Context

### What exists today (v0.4a baseline shipped 2026-05-29)

- `src/local/index.ts:189-280` — `LocalScopedMemory.reflect()` chain: `vectorStore.list → executeReflection → validateProvenance → insertDerivedMemory → ReflectionResult { sourceIds[] }`
- `src/local/schema.ts:1-30+` — memories table with v0.4a columns: `kind varchar(20)`, `derivedFrom jsonb`, `llmImportanceScore real`
- `src/core/dip/` — 6 DIPs: VectorStore, LLM, Embedder, HistoryManager, ReflectionPolicy, ScoringStrategy
- `src/core/memory-store.ts` — `ScopedMemory { remember, recall, reflect, getAll }` + `Memory { user, session, agent, forget, get, getAll, history }`
- `src/local/migrations/` — `0000_crazy_mimic.sql` + `0001_reflection_columns.sql`
- 416 contract tests passing (`npm test`)

### What the blueprint v1.0 settled (already-resolved decisions)

The 3 blueprint ADRs (`.claude/knowledge-base/discoveries/blueprints/voyager-skill-library-blueprint.md`) are the load-bearing inputs for this plan:

- **Blueprint D1 — REUSE v0.4a `Memory.reflect()` chain** + 3 additive extensions (skill payload, `superseded_by`, 4-phase orchestrator). NO sibling chain.
- **Blueprint D2 — Code-as-skill (Voyager pattern)** as primary representation. ProcMEM NL-spec deferred to v0.6.1+ via reserved `SkillRepresentationStrategy` DIP slot.
- **Blueprint D3 — REUSE pgvector + Drizzle schema** with `kind='skill'` discriminator. NO separate skill store.

### Evidence that triggers this work NOW

1. v0.4a (PR #22, merged 2026-05-29) unblocked v0.6's `Depends: Item 5` line in CLAUDE.md roadmap.
2. Blueprint v1.0 scored SHIPPABLE_WITH_CAVEATS (89.0/100 — `discover-confidence` report 2026-05-29). 4/4 corners populated; 0/13 fabricated citations; 3 ADRs synthesized; 9 recommendations decision-ready.
3. CoALA verbatim anchor recovered (Survey §6.8): _"Software engineering agents lean heavily on procedural memory (verified code patterns and architecture decisions)."_ The framing is canonical, not project-internal.
4. SWE-Skills-Bench (arXiv:2603.15401) identified as external validation target for v0.8 milestone — this plan ships the artifact that future benchmark milestone consumes.

## Objective

- [ ] **Sub-goal 1** — Schema migration `0002_skill_columns.sql` extends `memories` table with `superseded_by UUID NULL FK`, `code TEXT NULL`, `description TEXT NULL`, `code_language VARCHAR(20) NULL`; extends `kind` CHECK constraint to include `'skill'`. Verified via `drizzle-kit push` succeeding against a fresh `ankane/pgvector:v0.5.1` + the existing migrations idempotency assertion.
- [ ] **Sub-goal 2** — `src/core/skill.ts` declares the `Skill` interface + `SkillRepresentationStrategy` DIP slot (interface only). `src/core/memory-store.ts` extends `Memory` with `skills(repoId: string): ScopedSkillMemory` method.
- [ ] **Sub-goal 3** — `src/local/index.ts` implements `LocalMemory.skills(repoId)` returning a `LocalScopedSkillMemory` that exposes `add(skill)`, `recall(query)`, `consolidate()`, and `forget(id)` — composing the existing pgvector store with kind/supersession filters.
- [ ] **Sub-goal 4** — `src/local/skills/consolidate.ts` ships the 4-phase orchestrator (Orient → Gather → Consolidate → Report) wrapping `Memory.reflect()` to produce `kind='skill'` derived rows with both source skill IDs in `derived_from`.
- [ ] **Sub-goal 5** — Public-API surface: `src/index.ts` re-exports `Skill` type from `./core`; `package.json` `exports` map unchanged (no new subpath in v0.6 per blueprint Rec #6 deferred to interop work). `@usetheo/memory/contract` carries the type only.
- [ ] **Sub-goal 6** — Integration test `tests/integration/skills/consolidate-two-skills.test.ts` proves the Goal metric: 2 semantically-equivalent skills → 1 derived skill with `derived_from = [src1.id, src2.id]` against real pgvector.
- [ ] **Sub-goal 7** — CHANGELOG.md `[Unreleased]` updated under `Added` per Inquebrável Rule 6.

## ADRs

### D1 — REUSE v0.4a `Memory.reflect()` chain for skill consolidation (blueprint anchor)

**Decision:** Skill consolidation reuses the existing `executeReflection() + validateProvenance() + insertDerivedMemory()` pipeline cited at `src/local/index.ts:57-58, 230, 253, 269`. NO sibling chain.

**Rationale:** Three converging signals require REUSE: (a) the CLAUDE.md v0.6 acceptance criterion phrase "both source IDs in `derived_from`" is verbatim the v0.4a `sourceIds[]` shape; (b) blueprint Q5 shows Mem0 memory-dream's in-place mutation pattern loses rollback (violates Inquebrável Rule 7); (c) the chain ships with 416 tests + DIP boundary discipline per `architecture.md` § DIP boundaries — inventing a sibling violates Rule 9 (Não Reinvente).

**Alternatives considered:** (1) ship a `Skills.reflect()` sibling — rejected, duplicates the LLM-extraction + provenance scaffolding for no semantic gain; (2) adopt mem0ai npm package as backend — rejected, inverts TheMemory's positioning as the runtime layer (per CLAUDE.md § Locked names); (3) skip consolidation in v0.6 and ship only `add` + `recall` — rejected, blueprint Recommendation #1 + acceptance test require it.

**Consequences:** v0.6 implementation surface shrinks; the new code is additive (orchestrator wrapper + schema extension + payload fields) on top of a tested chain. The 3 extensions (D2/D3/D4 below) are the only net-new mechanism.

### D2 — Code-as-skill (Voyager pattern) is primary; ProcMEM NL-spec deferred (blueprint anchor)

**Decision:** v0.6 skill payload is `{code: string, description: string, codeLanguage: 'typescript' | 'javascript'}`. The `description` field is the embedding target (per Voyager Q4 finding — embedding of description, code as value). ProcMEM-style NL 3-tuple (Activation/Execution/Termination) is NOT shipped in v0.6; the `SkillRepresentationStrategy` DIP slot is declared as a future extension point.

**Rationale:** Voyager paper Pseudocode 1 + Survey §6.8 + CoALA (`procedural = "explicit knowledge written in agent's code"`) all converge on code-as-skill for software-engineering agents. TheoCode (the primary consumer per CLAUDE.md Item 8) needs code skills, not NL specs. ProcMEM's NL approach shines in bounded sequential decisions (its experimental domain — blueprint Q4); v0.6's domain is open-ended code agent. Different fit. KISS: ship one representation now, leave the DIP slot for v0.6.1+ demand.

**Alternatives considered:** (1) Mem0 openclaw Markdown protocols as primary — rejected per blueprint Q3, they are READ-ONLY protocols, not write/refactor candidates; (2) ProcMEM NL 3-tuple as primary — deferred (not rejected); (3) hybrid Voyager-code + ProcMEM-NL fields per row — rejected for v0.6 (YAGNI; couples without proven demand).

**Consequences:** Schema adds `code` + `description` + `code_language` columns rather than a generic `payload jsonb`. Embedding target switches from `text` (v0.4a) to `description` (v0.6, for `kind='skill'` rows only). Skill execution sandbox is OUT OF SCOPE — consumer decides exec strategy (TheoCode wires `node:vm` or Node child-process worker; other consumers may not exec at all).

### D3 — REUSE pgvector + Drizzle schema with `kind='skill'` (blueprint anchor)

**Decision:** v0.6 extends the existing `memories` table with 4 nullable columns (`superseded_by UUID NULL`, `code TEXT NULL`, `description TEXT NULL`, `code_language VARCHAR(20) NULL`) and extends the `kind` CHECK constraint to allow `'skill'`. NO separate `skills` table.

**Rationale:** Voyager's 4-store filesystem layout (per blueprint Q3) is single-tenant + filesystem-coupled; TheMemory v0.5+ ships TheoCloud (multi-tenant). pgvector already handles vector retrieval; Drizzle handles SQL. Adding a `skills` table proliferates JOINs (KISS); the `kind` discriminator on the existing table sidesteps that. Survey §6.8 audit-trail requirement is satisfied by `derived_from` (existing v0.4a column).

**Alternatives considered:** (1) Voyager 4-store layout adopted verbatim — rejected (single-tenant incompatible); (2) separate `skills` table — rejected (KISS, JOINs); (3) `payload jsonb` generic column on `memories` — rejected, loses index-friendliness for `description` embedding lookups.

**Consequences:** Existing pgvector index on the `embedding` column SHOULD index on `description` instead when `kind='skill'`. The migration adds the 4 columns + relaxes the `kind` CHECK to include `'skill'`. `recall()` filter logic gains opt-in `includeSuperseded` (default false) and `onlySkills` (default false) parameters.

### D4 — 4-phase orchestrator (`consolidate()`) lives at `src/local/skills/consolidate.ts`; protocol-as-code, not protocol-as-markdown

**Decision:** The Orient → Gather → Consolidate → Report orchestration (per blueprint Q5 + Mem0 memory-dream Markdown protocol shape) ships as a TypeScript function `consolidate({memory, scope, options}): Promise<ConsolidationResult>` at `src/local/skills/consolidate.ts`. NOT as a Markdown protocol loaded by Claude Code.

**Rationale:** Mem0 openclaw's Markdown protocol pattern requires an LLM-host (Claude Code) to interpret. TheMemory is the runtime layer (per Locked names) — orchestration is deterministic TS code, observable via OTel tracer per `architecture.md` § Telemetry. The 4 phases map directly to TS function calls: Orient = `scoped.getAll({onlySkills: true})`; Gather = build candidate cluster list via similarity threshold; Consolidate = call `memory.reflect()` with the candidates as source memories; Report = return a typed `ConsolidationResult`.

**Alternatives considered:** (1) ship as Markdown protocol consumed by Claude Code via Skills Standard — deferred to v0.6.1 interop work per blueprint Rec #6; (2) inline the orchestration inside `LocalScopedSkillMemory.consolidate()` method — rejected, breaks single-responsibility (the scoped class becomes a god-object) per `architecture.md` § SRP.

**Consequences:** New file `src/local/skills/consolidate.ts` (~150-200 LoC, under the 500 LoC budget per `architecture.md` § Module hygiene). Integration test exercises the full chain. Unit tests cover each phase in isolation per `testing.md` TDD pyramid.

### D5 — Public-API surface stays in `@usetheo/memory` default barrel; NO new subpath in v0.6

**Decision:** `Skill` type is re-exported from `@usetheo/memory/contract` (the existing types-only subpath). The new `memory.skills(repoId)` method ships in the default barrel. NO new subpath like `@usetheo/memory/skills` is created.

**Rationale:** Blueprint Recommendation #6 mentions a future `@usetheo/memory` ↔ Mem0 Skills Standard interop concern, but that's a serialization-format task, not a runtime-API task. KISS for v0.6: extend the existing surface. v0.6.1+ may add `@usetheo/memory/skills` as an opt-in subpath if interop demand justifies it.

**Alternatives considered:** (1) ship `@usetheo/memory/skills` subpath in v0.6 — rejected, YAGNI; (2) ship under `@usetheo/memory/voyager` namespace — rejected, leaks an upstream paper name into the public API.

**Consequences:** `package.json` `exports` map is unchanged in v0.6. `src/index.ts` re-exports the `Skill` type. Documentation surface remains compact.

## Dependency Graph

```
Phase 0: Pre-flight + migration
    │
    ▼
Phase 1: Core contracts (Skill type + ScopedSkillMemory + SkillRepresentationStrategy DIP)
    │
    ▼
Phase 2: Local store extensions (pgvector + in-memory parity)
    │
    ▼
Phase 3: Skills orchestrator (consolidate wrapper)
    │
    ▼
Phase 4: Public API surface (Memory.skills + barrel re-exports)
    │
    ▼
Phase 5 (Final): Integration Validation — THE GOAL METRIC TEST
```

All phases are sequential. No parallel work — each phase builds on the previous (schema → types → impl → orchestrator → API → integration). Time budget: estimated 8-12 hours of focused work; equivalent to v0.4a's halt-loop budget (13 tasks, shipped 2026-05-29 in 14 iterations).

---

## Phase 0: Pre-flight + migration scaffold

**Objective:** Land the schema extension (`0002_skill_columns.sql`) before any code touches the new fields. Closes the `/implement` Stop Condition #4 risk (Files-to-edit unreachable) by ensuring the column writes target an existing table shape.

### T0.1 — Migration `0002_skill_columns.sql` extends memories with skill columns

#### Objective
Add 4 nullable columns + relax `kind` CHECK constraint to allow `'skill'`, idempotently applicable to a database that has v0.4a applied.

#### Evidence
- Existing schema at `src/local/schema.ts` shows v0.4a columns: `kind varchar(20)`, `derivedFrom jsonb`, `llmImportanceScore real`
- Migration journal at `src/local/migrations/meta/_journal.json` already has 2 entries (0000 + 0001)
- Blueprint ADR D3 grounds the choice; pgvector v0.5.1 supports CHECK constraints + nullable JSONB FK columns

#### Files to edit

```
src/local/migrations/0002_skill_columns.sql                                  (NEW) — DDL extending memories table
src/local/schema.ts                                                          — add 4 column definitions + relaxed CHECK
src/local/migrations/meta/0002_snapshot.json                                 (NEW — emitted by drizzle-kit generate)
src/local/migrations/meta/_journal.json                                      — bumped by drizzle-kit
src/local/__tests__/schema.test.ts                                            — RED test added first (asserts new columns present)
```

#### Deep file dependency analysis

- `src/local/migrations/0001_reflection_columns.sql` was the last DDL; 0002 builds on top of that final state (kind already exists, just relaxed CHECK).
- `src/local/schema.ts` is consumed by `src/local/pgvector-store.ts` + `src/local/in-memory-store.ts` + the migration tests. Any new column declared here must be honored by both stores in Phase 2.
- `src/local/__tests__/schema.test.ts` exists today and asserts the v0.4a column set; it must be extended (not replaced) to also assert v0.6 columns.

#### Deep Dives

- DDL idempotency: use `ADD COLUMN IF NOT EXISTS` (pgvector v0.5.1 supports this); the CHECK constraint must be DROP + RE-ADD because Postgres does not support ALTER CHECK in-place.
- **(v1.1 EC-1 absorption) Constraint name is `memories_kind_derived_from_check`** (verified in `src/local/migrations/0001_reflection_columns.sql:16`). The DDL MUST cite this name verbatim, NOT rely on Drizzle re-derivation: `ALTER TABLE "memories" DROP CONSTRAINT IF EXISTS "memories_kind_derived_from_check";` then `ADD CONSTRAINT "memories_kind_derived_from_check" CHECK (kind IN ('extracted', 'derived', 'skill') AND (...derived_from constraint preserved from v0.4a...));` Failure to name explicitly → `DROP CONSTRAINT` fails with `does not exist` → migration aborts → Phase 0-5 blocked.
- The `superseded_by` column uses `REFERENCES memories(id) ON DELETE SET NULL` to preserve audit trail when a parent is hard-deleted (Inquebrável Rule 3 — extreme honesty: a forgotten parent still leaves the supersession link as NULL, not a dangling FK).
- The `description` column is the embedding target ONLY for `kind='skill'` rows. The embedding column itself is unchanged (one column, multiple semantic meanings by row).
- Edge cases: (a) v0.4a-only database (no skill rows) — migration is a pure schema extension, no data backfill; (b) re-run on already-migrated database — `IF NOT EXISTS` makes it a no-op.

#### Tasks
1. Author `0002_skill_columns.sql` with the 4 `ADD COLUMN IF NOT EXISTS` statements + CHECK relaxation
2. Extend `src/local/schema.ts` with the 4 column declarations + `check()` constraint updated
3. Run `npm run db:generate` to emit `meta/0002_snapshot.json` + bump `_journal.json`
4. Extend `src/local/__tests__/schema.test.ts` asserting the new column list

#### TDD

```
RED:     src/local/__tests__/schema.test.ts → asserts memories table has columns ['superseded_by','code','description','code_language'] in addition to v0.4a set. Initially fails because schema.ts doesn't declare them.
RED:     src/local/__tests__/schema.test.ts → asserts kind CHECK constraint accepts 'skill' as a valid value. Initially fails for the same reason.
GREEN:   Implement schema.ts column additions + CHECK; emit DDL via drizzle-kit; tests pass.
REFACTOR: None expected.
VERIFY:  npm test -- src/local/__tests__/schema.test.ts
```

#### Acceptance Criteria
- [ ] `src/local/migrations/0002_skill_columns.sql` exists and applies cleanly via `drizzle-kit push` against fresh `ankane/pgvector:v0.5.1`
- [ ] `src/local/schema.ts` declares the 4 new columns + the updated CHECK constraint
- [ ] Schema test passes asserting new columns present
- [ ] Idempotency: running migrations twice against the same DB produces no error (existing v0.4a test pattern)
- [ ] Pass: complexity — schema.ts cyclomatic complexity ≤ 10
- [ ] Pass: coverage — 100% on the new lines of schema.ts (schema definitions are exercised by tests)
- [ ] Pass: lint — `npm run lint` zero warnings on changed files
- [ ] Pass: size — schema.ts stays ≤ 500 LoC

#### DoD
- [ ] All tasks completed
- [ ] `npm test -- src/local/__tests__/schema.test.ts` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] File-size budget respected

---

## Phase 1: Core contracts (Skill type + ScopedSkillMemory + SkillRepresentationStrategy DIP slot)

**Objective:** Declare the public-facing types that Phase 2-4 implement against. Type-only changes; no runtime code.

### T1.1 — `Skill` type + `ScopedSkillMemory` interface in `src/core`

#### Objective
Add a single new file `src/core/skill.ts` that declares the `Skill` interface (extending `MemoryItem` with skill-specific payload fields) AND a `ScopedSkillMemory` interface that the Memory.skills(repoId) factory returns.

#### Evidence
- `src/core/memory-item.ts` shows `MemoryItem` is the canonical row shape (`id`, `text`, `hash`, `scope`, `createdAt`, `updatedAt`, `metadata`, `tValid`, `tInvalid`)
- `src/core/memory-store.ts` shows `ScopedMemory` exposes 4 verbs: `remember`, `recall`, `reflect`, `getAll`
- Blueprint ADR D2 grounds the `{code, description, codeLanguage}` payload

#### Files to edit

```
src/core/skill.ts                                                            (NEW) — Skill + ScopedSkillMemory interfaces
src/core/__tests__/skill.test-d.ts                                           (NEW) — type-only tests (RED)
src/core/index.ts                                                            — re-export Skill + ScopedSkillMemory
src/core/memory-store.ts                                                     — extend Memory with `skills(repoId): ScopedSkillMemory`
```

#### Deep file dependency analysis

- `src/core/skill.ts` is downstream of `memory-item.ts` (extends MemoryItem) and `scope.ts` (uses Scope type).
- `src/core/memory-store.ts` change requires every Memory implementation (`LocalMemory` in `src/local/index.ts`) to provide the `skills()` method — caught by the typecheck.
- `src/core/index.ts` is the contract barrel; re-exports are part of the public contract subpath `@usetheo/memory/contract`.

#### Deep Dives

- `Skill extends MemoryItem` with discriminated `kind: 'skill'`, `code: string`, `description: string`, `codeLanguage: 'typescript' | 'javascript'`, `supersededBy: string | null`.
- `ScopedSkillMemory` exposes 4 verbs matching the Voyager-paper API + the new orchestrator:
  - `add(skill: SkillDraft): Promise<Skill>` — write a new skill
  - `recall(query: string, options?: SkillRecallOptions): Promise<readonly SkillWithScore[]>` — semantic search using description embedding
  - `consolidate(options?: ConsolidateOptions): Promise<ConsolidationResult>` — invoke the 4-phase orchestrator (D4)
  - `forget(skillId: string, options?: ForgetOptions): Promise<void>` — soft-delete (sets `superseded_by` to NULL with self-reference convention, OR uses bi-temporal `tInvalid` per ADR-0006)
- Edge cases: (a) `Skill.text` field — set to a normalized form of `description` for `MemoryItem` superinterface compatibility; (b) bi-temporal columns (`tValid`, `tInvalid`) inherited from `MemoryItem` are honored.

#### Tasks
1. Author `src/core/skill.ts` with `Skill`, `SkillDraft`, `SkillWithScore`, `SkillRecallOptions`, `ConsolidateOptions`, `ConsolidationResult`, `ScopedSkillMemory` types
2. Author `src/core/__tests__/skill.test-d.ts` as type-only RED tests (use `expectTypeOf` per existing vitest typecheck pattern)
3. Extend `src/core/memory-store.ts` Memory interface with `skills(repoId: string): ScopedSkillMemory`
4. Re-export from `src/core/index.ts`

#### TDD

```
RED:     src/core/__tests__/skill.test-d.ts → expectTypeOf<Skill>().toMatchTypeOf<MemoryItem>() — fails because skill.ts doesn't exist yet
RED:     src/core/__tests__/skill.test-d.ts → expectTypeOf<ScopedSkillMemory['add']>().parameter(0).toEqualTypeOf<SkillDraft>() — fails
RED:     src/core/__tests__/skill.test-d.ts → expectTypeOf<Memory['skills']>().toBeFunction() — fails because Memory hasn't been extended
GREEN:   Implement skill.ts + Memory extension. Type-tests pass.
REFACTOR: None expected.
VERIFY:  npm test -- src/core/__tests__/skill.test-d.ts
```

#### Acceptance Criteria
- [ ] `src/core/skill.ts` declares 7 named types (Skill, SkillDraft, SkillWithScore, SkillRecallOptions, ConsolidateOptions, ConsolidationResult, ScopedSkillMemory)
- [ ] `src/core/memory-store.ts` Memory interface includes `skills(repoId: string): ScopedSkillMemory`
- [ ] Type tests pass
- [ ] Pass: complexity — N/A (type-only)
- [ ] Pass: coverage — type-only file; coverage gate is typecheck pass
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — skill.ts ≤ 200 LoC (target small; under 500 LoC budget)

#### DoD
- [ ] Type tests green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

### T1.2 — `SkillRepresentationStrategy` DIP slot (interface only, no impls)

#### Objective
Reserve the 7th DIP slot in `src/core/dip/` for future ProcMEM-style NL-spec skill representation. Declare the interface; do NOT ship an implementation in v0.6.

#### Evidence
- 6 DIPs already exist at `src/core/dip/` (vector-store, llm, embedder, history-manager, reflection-policy, scoring-strategy)
- Blueprint ADR D2 explicitly reserves this DIP for v0.6.1+
- Blueprint Recommendation #2: "Defer ProcMEM-style NL-spec representation to v0.6.1+ via a `SkillRepresentationStrategy` DIP slot"

#### Files to edit

```
src/core/dip/skill-representation-strategy.ts                                (NEW) — interface + 'voyager' built-in tag
src/core/dip/__tests__/skill-representation-strategy.test-d.ts               (NEW) — type test
src/core/dip/index.ts                                                        (NEW or EXTEND) — re-export DIP
```

#### Deep file dependency analysis
- The DIP is consumed (eventually) by `src/local/skills/consolidate.ts` when a non-default representation is configured. In v0.6 it stays unused — only the type slot lands.

#### Deep Dives
- The interface declares: `readonly kind: 'voyager' | 'procmem'`, `serialize(skill: SkillDraft): string`, `deserialize(raw: string): SkillDraft`. Default `'voyager'` strategy lives inline in the orchestrator (kept simple per KISS); future `'procmem'` lands as a separate impl.
- This is a YAGNI-edge declaration: we ship the interface ONLY because blueprint Rec #2 made it an explicit reservation; the implementation surface is zero v0.6 LoC.

#### Tasks
1. Author the DIP interface file
2. Author the type test
3. Wire the re-export

#### TDD

```
RED:     skill-representation-strategy.test-d.ts → expectTypeOf<SkillRepresentationStrategy['kind']>().toEqualTypeOf<'voyager' | 'procmem'>() — fails
GREEN:   Implement interface. Test passes.
REFACTOR: None expected.
VERIFY:  npm test -- src/core/dip/__tests__/skill-representation-strategy.test-d.ts
```

#### Acceptance Criteria
- [ ] Interface declared with 1 readonly + 2 methods
- [ ] Type test passes
- [ ] Size ≤ 100 LoC

#### DoD
- [ ] Type tests green
- [ ] `npm run typecheck` zero errors

---

## Phase 2: Local store extensions (pgvector + in-memory parity)

**Objective:** Extend `PgvectorStore` and `InMemoryVectorStore` to honor the new payload + filter shape. Both stores share a conformance test suite per existing pattern.

### T2.1 — `insertSkill` + `insertDerivedSkill` on stores

#### Objective
Add 2 methods to both `PgvectorStore` and `InMemoryVectorStore` that wrap the existing `insert` + `insertDerivedMemory` with skill payload semantics (kind='skill' + code/description/code_language fields).

#### Evidence
- `src/local/pgvector-store.ts` already exposes `insert` (v0.1) and `insertDerivedMemory` (v0.4a)
- `src/local/__tests__/vector-store-conformance.ts` is the shared test suite — extending it covers both stores

#### Files to edit

```
src/core/dip/vector-store.ts                                                 — extend VectorStore interface with insertSkill + insertDerivedSkill
src/local/pgvector-store.ts                                                  — implement both methods (raw SQL via pg)
src/local/in-memory-store.ts                                                 — parity impl
src/local/__tests__/vector-store-conformance.ts                              — add 4 RED tests (2 per method)
```

#### Deep file dependency analysis
- `vector-store.ts` is a DIP (8th method on the interface — was 11 methods at v0.4a per ADR-0008). Adding 2 grows it; this is the kind of change that requires an ADR-0008 note acknowledging the count change. The ADR D1 of THIS plan covers this consequence.

#### Deep Dives
- `insertSkill(args: InsertSkillArgs): Promise<string>` — vector, id, payload with `kind='skill'`, `code`, `description`, `code_language`. Description gets embedded (consumer pre-embeds — store is dumb).
- `insertDerivedSkill(args: InsertDerivedSkillArgs): Promise<string>` — adds `derived_from: string[]`.
- Edge cases: (a) `description` empty → reject with `InvalidSkillError` (the embedding target cannot be empty); (b) `code_language` not in the allowed enum → reject; (c) parent skill IDs in `derived_from` that don't exist → defer to `validateProvenance()` upstream.

#### Tasks
1. Extend DIP interface
2. Implement on pgvector (raw SQL INSERT with the 4 new columns)
3. Implement on in-memory store (Map-backed parity)
4. Extend conformance test suite

#### TDD

```
RED:     vector-store-conformance.ts → insertSkill writes a row with kind='skill' + code field populated — fails because method doesn't exist
RED:     vector-store-conformance.ts → insertSkill rejects empty description — fails
RED:     vector-store-conformance.ts → insertDerivedSkill writes a row with derived_from set — fails
RED:     vector-store-conformance.ts → both stores produce equivalent results from the same input — fails
GREEN:   Implement both methods on both stores.
REFACTOR: Extract shared SQL builder if duplication ≥ 3 sites (Rule of 3 per architecture.md).
VERIFY:  npm test -- src/local/__tests__/vector-store-conformance.ts
```

#### Acceptance Criteria
- [ ] Both stores implement both methods with identical observable behavior
- [ ] Conformance test suite has 4 new test cases all green
- [ ] DIP interface updated; ADR-0008 reference noted in the file header
- [ ] Pass: complexity ≤ 10 per method
- [ ] Pass: coverage 100% on new lines
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — pgvector-store.ts still ≤ 500 LoC (or split into a `pgvector-skill-store.ts` sibling if budget exceeded)

#### DoD
- [ ] All tasks completed
- [ ] `npm test -- src/local/__tests__/vector-store-conformance.ts` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

### T2.2 — recall + getAll filters: `includeSuperseded` + `onlySkills`

#### Objective
Extend the existing retrieval pipeline at `src/local/retrieval/` (or wherever `recall()` lives) AND the `getAll()` path to honor 2 new opt-in filters: `includeSuperseded` (default false — exclude rows whose `superseded_by IS NOT NULL`) and `onlySkills` (default false — when true, filter to `kind='skill'`). **(v1.1 EC-3 absorption)** `GetAllOptions` MUST also gain `includeSuperseded` so T3.1 Phase 1 (Orient) can call `scope.getAll({onlySkills: true, includeSuperseded: false})` — single-source-of-truth filter shape between recall and getAll.

#### Evidence
- v0.4a recall pipeline at `src/local/index.ts:182-189` calls `runRetrievalPipeline()`. The filter shape is `Filters` from `src/core/types.ts`
- Blueprint ADR D3 grounds the filter additions
- Edge-case review EC-3 (2026-05-29) requires `GetAllOptions` parity to prevent superseded re-clustering in T3.1

#### Files to edit

```
src/core/options.ts                                                          — extend RecallOptions with `includeSuperseded?: boolean` + `onlySkills?: boolean`; ALSO extend GetAllOptions with same 2 fields (v1.1 EC-3)
src/local/pgvector-store.ts                                                  — SQL filter additions in the recall AND list/getAll paths
src/local/in-memory-store.ts                                                 — parity
src/local/__tests__/recall-filters.test.ts                                   (NEW) — RED tests for the 2 new filter behaviors on BOTH recall and getAll
```

#### Deep file dependency analysis
- `RecallOptions` is consumed by `LocalScopedMemory.recall()` AND will be by `LocalScopedSkillMemory.recall()` (Phase 3). Single shape, two consumers.

#### Deep Dives
- Default behavior unchanged: existing recall callers see no difference.
- `onlySkills: true` + `includeSuperseded: false` is the canonical skill-library query — returns the latest version of each skill.
- Edge case: a skill is its own supersedor (sanity check — would mean a circular FK; reject at insert).

#### Tasks
1. Extend RecallOptions
2. Add WHERE clause additions to pgvector recall SQL
3. Add filter to in-memory recall
4. Author the RED tests

#### TDD

```
RED:     recall-filters.test.ts → recall with onlySkills=true returns only kind='skill' rows
RED:     recall-filters.test.ts → recall with includeSuperseded=false excludes superseded rows
RED:     recall-filters.test.ts → recall with includeSuperseded=true returns ALL skills (current + superseded)
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  npm test -- src/local/__tests__/recall-filters.test.ts
```

#### Acceptance Criteria
- [ ] 3 RED tests pass after implementation
- [ ] Pass: complexity ≤ 10
- [ ] Pass: coverage 100% on new lines
- [ ] Pass: lint zero
- [ ] Pass: size budget respected

#### DoD
- [ ] All tasks complete
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

---

## Phase 3: Skills orchestrator (4-phase wrapper)

**Objective:** Implement the `consolidate()` orchestrator that wraps `Memory.reflect()` with the Orient → Gather → Consolidate → Report protocol from blueprint ADR D4.

### T3.1 — `src/local/skills/consolidate.ts` — 4-phase orchestrator

#### Objective
Ship a single function `consolidate({memory, scope, options})` that runs the 4 phases by composing existing primitives, producing a typed `ConsolidationResult` and writing the derived skill via `insertDerivedSkill`.

#### Evidence
- Blueprint Q5 + ADR D4 specify the 4-phase protocol borrowed from Mem0 memory-dream
- Blueprint Recommendation #7: "Borrow Mem0 memory-dream 4-phase orchestration as PROTOCOL for `consolidate()`, NOT as storage pattern"
- v0.4a `LocalScopedMemory.reflect()` at `src/local/index.ts:189-280` is the chain to wrap

#### Files to edit

```
src/local/skills/consolidate.ts                                              (NEW) — the orchestrator (~200 LoC target)
src/local/skills/index.ts                                                    (NEW) — public barrel
src/local/skills/__tests__/consolidate.test.ts                               (NEW) — unit tests for each phase
```

#### Deep file dependency analysis
- `consolidate.ts` calls into `LocalScopedMemory.reflect()` (composition, not inheritance — keeps SRP per `architecture.md`)
- The barrel `src/local/skills/index.ts` exposes only `consolidate`; the `LocalScopedSkillMemory` class in Phase 4 internally calls it

#### Deep Dives
- **Phase 1 (Orient):** call `scope.getAll({onlySkills: true, includeSuperseded: false})` → count total skills (TIP-OF-VERSION-CHAIN only — never re-cluster a skill that already has `superseded_by` set), identify candidate clusters via embedding similarity ≥ `clusterThreshold` (default 0.85, configurable). NO modifications. **(v1.1 EC-3 absorption)** Without the `includeSuperseded: false` filter, `consolidate()` chamado N vezes pode produzir branching versions: `skill_v1` (superseded by `v2`) re-entering a cluster with `skill_v3` (new) → derived `skill_v4` with `derived_from=[v1.id, v3.id]` → `skill_v1` agora tem DOIS sucessores (`v2` AND `v4`) → provenance corruption. Filter MANDATORY; assertion enforced via integration test that runs `consolidate()` twice and verifies the second call's `ConsolidationResult.derivedSkills.length === 0` (no double-consolidation).
- **Phase 2 (Gather Targets):** for each candidate cluster (≥ 2 skills), build a `SourceCluster` with the source skill IDs + their description + code. NO modifications.
- **Phase 3 (Consolidate):** for each cluster, call `memory.reflect({sourceMemories: cluster.skills})`. The existing v0.4a `executeReflection()` LLM call extracts a higher-order skill (with new code body + description); `validateProvenance()` ensures the drafts cite real source IDs; `insertDerivedSkill()` writes with `derived_from = cluster.sourceIds`. ALSO update source skills to set `superseded_by = newSkill.id` via a new `markSuperseded(ids, newId)` store method.
- **Phase 4 (Report):** return `ConsolidationResult { sourceClusters, derivedSkills, supersededIds, durationMs }`.
- Invariants: (a) every derived skill has `derived_from.length ≥ 2`; (b) every source-skill row gets `superseded_by` set to the derived skill's ID; (c) the orchestrator NEVER deletes source rows (Inquebrável Rule 3 — extreme honesty + ADR D1 append-only).
- **(v1.1 EC-2 absorption) Atomicidade `insertDerivedSkill` + `markSuperseded` via transaction.** Phase 3 (Consolidate) MUST wrap the pair in `withTransaction()` (the helper already exists in `src/local/pgvector-store.ts` shipped during v0.4a `Memory.reflect()` persistence work — see the `withTransaction` method exported from `src/local/pgvector-store.ts`). Failure mode if NOT wrapped: `insertDerivedSkill` succeeds but `markSuperseded` fails (network blip, deadlock, race with concurrent `forget()`) → derived skill exists but sources NOT marked → `recall({onlySkills:true, includeSuperseded:false})` returns 3 rows (2 sources + 1 derived) instead of 1 → THE GOAL TEST flaky. For `InMemoryVectorStore`: declare best-effort transactional semantics in `consolidate.ts` JSDoc (in-memory Map state cannot truly atomic across 2 method calls; documented as accepted-risk for tests-only use; production path is always pgvector per ADR D3).
- Edge cases: (a) zero clusters above threshold → return empty `ConsolidationResult` with `derivedSkills: []`; (b) LLM extraction returns empty drafts → log + skip + ZERO `markSuperseded` calls (do not partial-consolidate); (c) provenance check fails → throw `ReflectionProvenanceMissingError` (existing v0.4a error type); (d) transaction rollback on any step inside `withTransaction` re-throws to caller AND leaves DB state at pre-orient snapshot.

#### Tasks
1. Author the `consolidate()` function with phase helpers as private fns
2. Add `markSuperseded(ids: string[], supersedorId: string): Promise<void>` method on stores (T2.x complement — could fold into T2.1 if budget permits; otherwise separate)
3. Author unit tests covering each phase in isolation + the integration of all 4
4. Author the barrel `src/local/skills/index.ts`

#### TDD

```
RED:     consolidate.test.ts → Orient phase counts skills and identifies 1 cluster of 2 similar skills
RED:     consolidate.test.ts → Consolidate phase produces 1 derived skill with derived_from=[s1.id, s2.id]
RED:     consolidate.test.ts → source skills get superseded_by = derived.id
RED:     consolidate.test.ts → recall({onlySkills:true, includeSuperseded:false}) excludes the 2 sources, returns only the derived
RED:     consolidate.test.ts → empty clusters → empty ConsolidationResult, no LLM call
GREEN:   Implement consolidate.ts + markSuperseded.
REFACTOR: Extract cluster builder + report formatter if needed.
VERIFY:  npm test -- src/local/skills/__tests__/consolidate.test.ts
```

#### Acceptance Criteria
- [ ] 5 RED tests pass
- [ ] `consolidate.ts` ≤ 250 LoC (target tight; budget 500 per `architecture.md`)
- [ ] Pass: complexity — every helper fn cyclomatic ≤ 10
- [ ] Pass: coverage 100% on new file
- [ ] Pass: lint zero warnings
- [ ] OTel tracer spans emitted (per `architecture.md` § Telemetry): one parent span `skills.consolidate`; child spans per phase

#### DoD
- [ ] All tasks complete
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] Runtime-metric proof — `consolidate.test.ts` asserts non-zero `derivedSkills.length` after a cluster-of-2 input (proves the chain wires + LLM mock fires)

---

## Phase 4: Public API surface (Memory.skills + barrel re-exports)

**Objective:** Wire the public-facing `memory.skills(repoId)` method on `LocalMemory` + re-export the `Skill` type. After this phase, consumers can write `const skill = await memory.skills(repoId).add({code, description})`.

### T4.1 — `LocalMemory.skills(repoId)` implementation

#### Objective
Add the `skills(repoId)` factory method on `LocalMemory` that returns a `LocalScopedSkillMemory` instance bound to that `repoId` scope.

#### Evidence
- `src/local/index.ts:307+` is where `LocalMemory` class lives; `user(userId)`, `session(sessionId)`, `agent(agentId)` already exist as factory methods
- The `repoId` scope is a NEW scope kind, distinct from User/Session/Agent (per CLAUDE.md Item 8: "Opt-in tier `memory.skills(repoId)`")

#### Files to edit

```
src/core/scope.ts                                                            — add `RepoScope { kind: 'repo'; repoId: string }` + add to Scope union
src/local/index.ts                                                           — implement LocalMemory.skills(repoId) factory + add 'repo' case to filtersFromScope + assertScopeIsNonEmpty
src/local/reflection/threshold-reflection-policy.ts                          — (v1.1 EC-4) add 'repo' case to scopeToCounterTuple at line :46 (verified 2026-05-29 via grep)
src/core/reflection/prompt.ts                                                — (v1.1 EC-4) add 'repo' case to scope identifier formatting at line :18; returns "repo:<repoId>"
src/local/scoped-skill-memory.ts                                             (NEW) — LocalScopedSkillMemory class implementing ScopedSkillMemory
src/local/__tests__/scoped-skill-memory.test.ts                              (NEW) — unit tests for the class
```

#### Deep file dependency analysis
- `Scope` union extension caught by every existing `switch(scope.kind)`. **(v1.1 EC-4 absorption)** Verified 2026-05-29 via `grep -rn "switch.*scope.kind"` that there are **4 switch sites**, not 2 as v1.0 implied. All 4 MUST gain a `case 'repo':` arm OR typecheck FAILS:
  1. `src/local/index.ts:77` — `filtersFromScope()` — translate RepoScope to `{ repo_id: scope.repoId, kind: 'skill' }`
  2. `src/local/index.ts:111-149` — `assertScopeIsNonEmpty()` — reject empty `repoId`
  3. `src/local/reflection/threshold-reflection-policy.ts:46` — `scopeToCounterTuple()` — return `(NULL, NULL, NULL, repoId)` shape (counter table extension may also be needed depending on schema 0001 — verify in T0.1)
  4. `src/core/reflection/prompt.ts:18` — scope identifier formatting in LLM reflection prompts — return `"repo:<repoId>"`
- `LocalScopedSkillMemory` composes `LocalScopedMemory` (does NOT extend it — composition over inheritance per `architecture.md` § SOLID)
- **Discriminant exhaustiveness gate:** the typechecker's exhaustive `switch` checks (via `never`-returning default case OR TypeScript's `--strict`) will FAIL until all 4 sites are updated. Treat as atomic landing — do not split T4.1 into "Scope union" + "skill class" sub-tasks because the typecheck cycle is unbreakable until all 4 switches are extended.

#### Deep Dives
- `RepoScope.repoId` translates to filter `{ repo_id: scope.repoId, kind: 'skill' }` in the store
- The `add()` method calls `vectorStore.insertSkill(...)` directly (NOT through `remember()` — the v0.4a 2-stage write pipeline is for natural-text facts, not pre-formed skill code)
- The `recall()` method calls existing `runRetrievalPipeline` with `onlySkills: true` filter
- The `consolidate()` method calls `consolidate({memory: this, scope: this.scope})` from Phase 3
- Edge cases: (a) `repoId` empty string → reject with `EmptyScopeError`; (b) calling `.skills(repoId).reflect()` — NOT exposed; consolidation is the skill-specific verb

#### Tasks
1. Extend Scope union with RepoScope
2. Update `filtersFromScope` + `assertScopeIsNonEmpty`
3. Implement `LocalScopedSkillMemory` class
4. Implement `LocalMemory.skills(repoId)` factory
5. Unit tests

#### TDD

```
RED:     scoped-skill-memory.test.ts → memory.skills('repo-1').add({code, description}) returns Skill with valid id
RED:     scoped-skill-memory.test.ts → memory.skills('repo-1').recall('payment retry') returns the most-similar skill scoped to repo-1
RED:     scoped-skill-memory.test.ts → memory.skills('repo-2').recall returns nothing for skills added under repo-1
RED:     scoped-skill-memory.test.ts → memory.skills('').add throws EmptyScopeError
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  npm test -- src/local/__tests__/scoped-skill-memory.test.ts
```

#### Acceptance Criteria
- [ ] 4 RED tests pass
- [ ] LocalScopedSkillMemory ≤ 200 LoC
- [ ] Pass: complexity ≤ 10
- [ ] Pass: coverage 100%
- [ ] Pass: lint zero warnings
- [ ] Pass: size respected

#### DoD
- [ ] All tasks complete
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

### T4.2 — Public barrel re-exports + CHANGELOG entry

#### Objective
Re-export `Skill`, `ScopedSkillMemory`, `ConsolidationResult` etc from the public barrels. Update CHANGELOG.

#### Files to edit

```
src/index.ts                                                                  — re-export Skill type from ./core
src/core/index.ts                                                             — ensure all new types in skill.ts are re-exported
CHANGELOG.md                                                                  — [Unreleased] Added entry per Inquebrável Rule 6
```

#### Tasks
1. Add re-exports
2. Author CHANGELOG entry: "Added: v0.6 `memory.skills(repoId)` — code-as-skill procedural memory with `derived_from` provenance + Voyager-style versioning. (#PR-NUMBER)"

#### Acceptance Criteria
- [ ] Types exported from both `@usetheo/memory` and `@usetheo/memory/contract`
- [ ] CHANGELOG entry present and follows Keep-a-Changelog format

#### DoD
- [ ] `npm run typecheck` zero errors
- [ ] CHANGELOG validated

---

## Phase 5 (Final): Integration Validation — THE GOAL METRIC TEST

**Objective:** Prove the Goal metric is observably met: `tests/integration/skills/consolidate-two-skills.test.ts` runs against real `ankane/pgvector:v0.5.1` and proves consolidation yields `derived_from = [src1.id, src2.id]`.

### T5.1 — Integration test asserting Goal metric

#### Files to edit

```
tests/integration/skills/consolidate-two-skills.test.ts                      (NEW) — THE GOAL TEST
tests/integration/skills/fixtures/two-similar-skills.ts                      (NEW) — fixture: 2 syntactically-different, semantically-equivalent code skills
```

#### Deep Dives
- The 2 skills express the same idea (e.g., one writes "retry an HTTP fetch on 5xx with exponential backoff" using `fetch`, the other uses `axios`)
- Real LLM call (or scoped stub returning a deterministic merged skill) — pattern follows existing integration tests for v0.4a reflect
- Real pgvector container (docker-compose service `pgvector` per existing `compose:up` script)

#### Tasks
1. Author the fixture
2. Author the integration test asserting:
   - `derivedSkills.length === 1`
   - `derivedSkills[0].derivedFrom.sort() === [src1.id, src2.id].sort()`
   - `recall('payment retry', {onlySkills:true, includeSuperseded:false}).length === 1` and equals the derived skill
   - Source skills' `supersededBy === derivedSkills[0].id`

#### TDD

```
RED:     consolidate-two-skills.test.ts — the full assertion chain. Fails before Phase 3+4 land.
GREEN:   Phases 0-4 deliver the impl; this test goes green naturally as the final wiring proof.
REFACTOR: None expected.
VERIFY:  npm run compose:up && npm run db:push && npm run test:integration -- tests/integration/skills/consolidate-two-skills.test.ts
```

#### Acceptance Criteria
- [ ] THE GOAL TEST is green against real pgvector
- [ ] `npm run test:integration` overall green (no regression from v0.4a's 28 integration tests)
- [ ] Pass: all phases' Acceptance Criteria above

#### DoD
- [ ] All Phase 0-5 DoDs satisfied
- [ ] Integration test green
- [ ] CHANGELOG entry shipped
- [ ] PR ready for `/review`

---

## Coverage Matrix

Every original sub-goal maps to at least one task:

| # | Gap / Requirement (from Objective) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Schema migration `0002_skill_columns.sql` | T0.1 | DDL + drizzle-kit emit + schema test |
| 2 | `Skill` type + `ScopedSkillMemory` + `SkillRepresentationStrategy` DIP | T1.1, T1.2 | Two new core type files + DIP slot |
| 3 | `LocalMemory.skills(repoId)` factory + class | T4.1 | New LocalScopedSkillMemory class + factory |
| 4 | 4-phase orchestrator `consolidate.ts` | T3.1 | Composition over LocalScopedMemory.reflect() |
| 5 | Public-API re-exports | T4.2 | src/index.ts + src/core/index.ts |
| 6 | Integration test asserting Goal metric | T5.1 | THE GOAL TEST against real pgvector |
| 7 | CHANGELOG `[Unreleased]` Added entry | T4.2 | Single entry per Inquebrável Rule 6 |

Additional coverage rows for ancillary implementation requirements:
| # | Requirement | Task(s) | Resolution |
|---|---|---|---|
| 8 | Vector-store extensions (insertSkill + insertDerivedSkill) | T2.1 | Both pgvector + in-memory; conformance suite extended |
| 9 | Recall filters (includeSuperseded + onlySkills) | T2.2 | RecallOptions extension + SQL/in-memory filter |
| 10 | RepoScope union extension | T4.1 | scope.ts + filtersFromScope update |

**Coverage: 10/10 gaps covered (100%)**

## Dependencies

Existing TheMemory deps (v0.4a baseline at `package.json`):
- `drizzle-orm@^0.45.0` — schema + migration tooling
- `pg@^8.13.0` — Postgres client
- `zod@^3.25.0` — runtime validation
- `croner@^10.0.1` — cron scheduler (v0.4a, reused if SleepTimeReflectionPolicy ever drives skill consolidation)

NEW deps required: **NONE**. v0.6 ships on the v0.4a dep set per ADR D1 (REUSE chain) + ADR D3 (REUSE schema).

REMOVED deps: **NONE**.

Per `/deps-audit` golden rule v1.1: no new deps means zero CVE scan delta. Plan-confidence's `architecture_compliance` is satisfied by the architecture.md citations in ADRs above + the testing.md TDD discipline per task.

## Global Definition of Done

- [ ] All 5 phases completed (T0.1 → T5.1)
- [ ] All tests passing — `npm test` green (contract + integration), unit `vitest.contract.config.ts` includes the new test paths under `src/{core,local}/__tests__/` and `tests/integration/skills/`
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (per `architecture.md § Module hygiene`): every changed file ≤ 500 LoC; `consolidate.ts` ≤ 250 LoC target
- [ ] CHANGELOG.md `[Unreleased]` updated under `Added` (Inquebrável Rule 6)
- [ ] Backward compatibility preserved: existing `Memory.user(...)`, `Memory.session(...)`, `Memory.agent(...)` factories unchanged; new `Memory.skills(...)` added; v0.4a `Memory.reflect()` chain unchanged.
- [ ] Plan-specific criteria:
  - [ ] THE GOAL TEST `tests/integration/skills/consolidate-two-skills.test.ts` green against real `ankane/pgvector:v0.5.1`
  - [ ] `derived_from` invariant verified by assertion in the integration test (the Goal metric)
  - [ ] CLAUDE.md roadmap Item 8 description revised per blueprint Recommendation #4 — "no one shipped this as infra" claim corrected to "no one shipped code-as-skill procedural memory with full provenance + versioning as infra" (this is a docs-only update; may ship in same PR or follow-up)
- [ ] **Runtime-metric proof** — THE GOAL TEST exercises the full chain (Orient → Gather → reflect() → insertDerivedSkill → markSuperseded → recall filter) end-to-end against real pgvector. The `derived_from` assertion is the metric; observability is the OTel span tree emitted by `consolidate()`.
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has been merged to `main`, move `.claude/knowledge-base/plans/voyager-skill-library-plan.md` to `.claude/knowledge-base/plans/completed/voyager-skill-library-plan.md`. Blueprint stays in `discoveries/blueprints/` per `audit-trail-rotation.md` (KEEP forever).

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER all implementation phases T0-T4 are complete. The plan is NOT done until the integration validation chain passes.

**Objective:** Validate that v0.6 works in a real workload — not just isolated unit tests.

### Execution

```
npm run compose:up                            # start pgvector container
npm run db:push                                # apply 0002_skill_columns.sql to fresh DB
npm test                                       # contract tests (vitest.contract.config.ts)
npm run test:integration                       # integration tests against pgvector (includes THE GOAL TEST)
npm run test:coverage                          # coverage report (≥ 90% on changed files)
npm run typecheck                              # zero TS errors
npm run lint                                   # zero lint warnings
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Coverage ≥ 90% on changed files; **100% on critical paths** (consolidate.ts, scoped-skill-memory.ts, schema migration)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] **Runtime-metric proof** — `derivedSkills[0].derivedFrom.length === 2 && derivedSkills[0].derivedFrom` contains both source IDs (THE GOAL METRIC observed in `tests/integration/skills/consolidate-two-skills.test.ts`)
- [ ] `recall({onlySkills: true, includeSuperseded: false})` after consolidation returns ONLY the derived skill (not the 2 sources) — proving the supersession + filter work end-to-end

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures before declaring the plan complete
3. Re-run the validation chain to confirm fixes
4. Pre-existing issues are logged but do NOT block plan completion (document them in the PR description)
