# Plan: voyager-skill-library-fixes-v0-6-1 — close `/review` findings on the v0.6 surface

> **Version 1.1** — Close every BLOCKER/CRITICAL/MAJOR finding from `.claude/knowledge-base/reviews/voyager-skill-library-review-2026-05-30.md` (2 CRITICAL + 8 MAJOR + 13 MINOR after cross-agent dedup) before the v0.6 voyager-skill-library PR opens. Ships as point-release **v0.6.1** on the same `feat/v0-6-voyager-skill-library` feature branch, so a single PR carries the merged result.
>
> **Change log:**
> - **v1.0 (2026-05-30):** initial draft. 5 ADRs, 14 tasks across 6 phases, Coverage Matrix 12/12.
> - **v1.1 (2026-05-30):** absorbed 2 MUST FIX from `voyager-skill-library-fixes-v0-6-1-edge-cases-2026-05-30.md`. **EC-1 (T0.2 + T3.3):** post-T0.2 derived skills carry `code_language = NULL` at the DB layer; `decodeSkillPayload` (T3.3) must accept `code_language` ∈ `{null, undefined, 'typescript', 'javascript'}` when `kind = 'skill'` — without this fix, derived skills become invisible to recall + Orient phase and THE GOAL TEST regresses. **EC-2 (T4.1):** `LocalScopedSkillMemory.forget()` must enforce scope isolation — fetch the row first and reject (with `MemoryNotFound`) any `skillId` whose `agent_id !== this.scope.repoId` OR `kind !== 'skill'`. Pre-existing cross-scope deletion gap from v0.6 that T4.1 is the natural place to close.

## Goal

> "Close every CRITICAL + MAJOR finding from `voyager-skill-library-review-2026-05-30.md` so that `/review voyager-skill-library` re-run reports `CRITICAL: 0` and `MAJOR: 0`, measured by the consolidated review verdict transitioning from `NEEDS_FIXES` to `READY_TO_MERGE` AND the existing GOAL TEST `tests/integration/skills/consolidate-two-skills.test.ts` staying green against real `ankane/pgvector:v0.5.1`."

The action verb is **close**; the named observable metric is the `/review` verdict transition + GOAL TEST stays green. Single sentence.

## Context

### What exists today (post v0.6 implementation, post `/review`)

Branch state at plan-time:
- 10 commits on `feat/v0-6-voyager-skill-library` shipping T0.1 → T5.1 of the v0.6 plan
- 468 contract tests pass, 0 type errors, 0 lint warnings
- THE GOAL TEST passes against real `ankane/pgvector:v0.5.1`
- 7-reviewer `/review` consolidated report at `.claude/knowledge-base/reviews/voyager-skill-library-review-2026-05-30.md` returned `NEEDS_FIXES`

### Findings to close (verbatim from the review report)

**CRITICAL (2):**
- **F1** — `consolidate.ts:401-426` Phase 3 writes `code = description = draft.text` to derived-skill rows. LLM prose persists as `codeLanguage: 'typescript'`. ADR D2 violation; GOAL TEST doesn't assert on `code`, masking the regression.
- **F2** — `scoped-skill-memory.ts:117` `add()` throws `EmptyScopeError` (a reflection-counters contract about scope keys) for empty `description`. `InvalidSkillError('empty-description', ...)` already exists and is correctly thrown by the store layer.

**MAJOR (8):**
- **F3** — `pgvector-store.ts` 734 LoC, 47% over 500 budget. Plan T2.1 acceptance criterion called the split out.
- **F4** — `consolidate.ts:322` dead `vectorStore.get(row.id)` + per-row `embed()` loop bypasses `embedBatch`. 500 wasted SQL + 500 sequential LLM calls at page-size cap.
- **F5** — `consolidate.ts:351-360` silently drops `drafts[1..]`. v0.4a `reflect()` iterates all drafts; regression without ADR.
- **F6** — `consolidate.ts:408` derived-skill `hash = "derived-skill-" + Date.now() + Math.random()`. Non-deterministic; breaks `architecture.md § 4` content-derived dedup invariant.
- **F7** — `scoped-skill-memory.ts:121` `add()` hash uses manual `createHash('md5')` chain instead of canonical `hashFact()`.
- **F8** — `src/local/skills/index.ts` exports `consolidate` + `ConsolidateDeps` but never imported through any path. Dead barrel.
- **F9** — `payloadToSkill` (scoped-skill-memory.ts:48) and `rowToSkill` (consolidate.ts:240) duplicate payload-decoding knowledge (kind check, codeLanguage narrowing, derived_from JSON.parse).
- **F10** — `forget()` JSDoc at `src/core/skill.ts:147` says "soft-delete"; impl hard-deletes. Also skips the history-table `'forget'` event that `LocalMemory.forget` writes.

**MINOR (13)** — bundled into Phase 5; full enumeration in `voyager-skill-library-review-2026-05-30.md § MINOR findings`.

### Evidence that triggers this work NOW

1. `/review` verdict `NEEDS_FIXES` (date: 2026-05-30) explicitly halts merge per `cycle-review.md § Hard gates`.
2. 2/2 CRITICAL findings reproduce on the branch — verified via grep at the cited lines.
3. F3 is the most concrete: `wc -l src/local/pgvector-store.ts` returns 734; budget is 500.
4. F4 is observable: GOAL TEST runtime would drop measurably when `embedBatch` replaces the per-row loop.

## Objective

- [ ] **Sub-goal 1 (CRITICAL F2)** — Drop the early `EmptyScopeError` throw in `LocalScopedSkillMemory.add()`. Store-layer `assertSkillArgs` already rejects empty description with the correct `InvalidSkillError`.
- [ ] **Sub-goal 2 (CRITICAL F1 + v1.1 EC-1)** — Relax `Skill.code` + `Skill.codeLanguage` to `string | null` + `SkillLanguage | null`. Phase 3 of `consolidate()` writes `code: null, codeLanguage: null` for derived skills (the LLM-merged narrative stays in `description` only). JSDoc + new ADR-D6 document the accepted-risk; v0.7 extends the LLM extraction draft shape to produce structured `{code, description}` for derived skills. **(v1.1 EC-1 absorption):** the post-T3.3 `decodeSkillPayload` MUST accept `code_language` ∈ `{null, undefined, 'typescript', 'javascript'}` when `kind = 'skill'` so derived skills are not silently filtered out of recall + Orient results.
- [ ] **Sub-goal 3 (MAJOR F3)** — Extract `insertSkill / insertDerivedSkill / markSuperseded / insertDerivedSkillAtomic / assertSkillArgs` from `pgvector-store.ts` into a sibling `pgvector-skill-store.ts`. Main file delegates via composition. Both classes pass the conformance suite.
- [ ] **Sub-goal 4 (MAJOR F4)** — Replace the Orient phase per-row `vectorStore.get(row.id)` + sequential `embed()` loop with a single `embedBatch(descriptions)` call.
- [ ] **Sub-goal 5 (MAJOR F5)** — Phase 3 of `consolidate()` iterates ALL `drafts` per cluster (matching v0.4a `reflect()` shape), not just `drafts[0]`.
- [ ] **Sub-goal 6 (MAJOR F6 + F7)** — Both `consolidate.ts:408` and `scoped-skill-memory.ts:121` hashes route through canonical `hashFact()` from `src/core/dedup.ts`.
- [ ] **Sub-goal 7 (MAJOR F8)** — Delete `src/local/skills/index.ts` (dead barrel).
- [ ] **Sub-goal 8 (MAJOR F9)** — Extract `decodeSkillPayload(payload, scope, score?): Skill | SkillWithScore | null` to `src/local/skills/payload.ts`; `payloadToSkill` and `rowToSkill` call sites delegate.
- [ ] **Sub-goal 9 (MAJOR F10 + v1.1 EC-2)** — `LocalScopedSkillMemory.forget()` JSDoc + impl aligned on hard-delete; writes a `'forget'` `HistoryEntry` via the configured `HistoryManager` mirroring `LocalMemory.forget` at `src/local/index.ts:390-410`. **(v1.1 EC-2 absorption):** before delegating, fetch the row and reject (`throw new MemoryNotFound(skillId)`) any `skillId` whose `agent_id !== this.scope.repoId` OR `kind !== 'skill'` — closes the cross-scope deletion gap so `memory.skills('repo-A').forget(skillFromRepoB.id)` correctly behaves as "skill not found in this scope".
- [ ] **Sub-goal 10 (MINOR bundle)** — ADR-D7 docs `RepoScope` 4th-tier strategic decision (closes F-arch-7 / F-dom-mem-6); update CLAUDE.md three-tier framing. Promote no-paper-names-in-code policy from session memory to `.claude/rules/` (closes F-arch-10). Bridging JSDoc + inline comments for F-dom-pgvec-11, F-dom-pgvec-12, F-tests-1/2/3/4, F-xval-1. (See plan task T5.1 / T5.2 / T5.3.)
- [ ] **Sub-goal 11** — `/review voyager-skill-library` re-run returns `CRITICAL: 0` and `MAJOR: 0`.
- [ ] **Sub-goal 12** — CHANGELOG.md `[Unreleased]` updated under `Changed` with a v0.6.1 entry describing the fixes per Inquebrável Rule 6.

## ADRs

### D1 — Ship fixes as v0.6.1 on the SAME `feat/v0-6-voyager-skill-library` branch (not a sibling branch)

**Decision:** All fixes land as additional commits on the existing `feat/v0-6-voyager-skill-library` branch; PR opens once both the v0.6 implementation AND the v0.6.1 fixes are committed.

**Rationale:** Inquebrável Rule 4 forbids `git checkout` to switch branches mid-work. `cycle-review.md § Stop conditions` says findings loop back to `/implement` on the SAME branch. Splitting fixes to a sibling branch would force a second PR ceremony for what is logically a single feature delivery. KISS + reviewer fatigue.

**Alternatives considered:** (1) sibling branch `fix/voyager-skill-library-fixes` + dependent PR — rejected, doubles the ceremony for a logical-unity feature; (2) hold fixes for v0.7 — rejected per cycle-review.md, CRITICAL halts the v0.6 PR, can't ship v0.6 without them.

**Consequences:** Branch grows from 10 commits to ~15-18 commits before PR opens. PR commit list reads as a coherent v0.6 narrative (the original v0.6 task series shipped at T0.1 → T5.1, followed by this fixes plan's task series). `/review` re-run validates the merged tree.

### D2 — Derived-skill `code` is NULL in v0.6.1; structured-draft LLM extraction defers to v0.7

**Decision:** For derived skills produced via `consolidate()`, write `code: null, codeLanguage: null` to the database. `Skill.code` and `Skill.codeLanguage` are relaxed to `string | null` and `SkillLanguage | null` respectively at the type contract. The LLM-merged narrative lives in `description` only; consumers know "code === null" means "not directly executable; refer to `derivedFrom` sources".

**Rationale:** v0.6's LLM extraction draft shape is `{text, derivedFrom}` — there is no structured place for the LLM to return separate `code` and `description` parts. Forcing `code = description` (as v0.6 ships today) is the F1 CRITICAL bug. Extending the draft shape + reflection prompt + `parseDraftsResponse` + `validateProvenance` to handle structured drafts is real engineering (plan ADR D1 of the voyager-skill-library plan said REUSE the v0.4a chain). v0.7 is the natural milestone for that work because v0.7's distillation pipeline (CLAUDE.md Roadmap Item 9) already touches that chain.

The schema already supports NULL on both columns (set in T0.1 of the voyager-skill-library plan); the type contract was the only blocker.

**Alternatives considered:** (a) extend the LLM draft shape in v0.6.1 — rejected, scope creep + breaks REUSE invariant from voyager-skill-library plan ADR D1; (b) keep `code = description` + label with `codeLanguage: 'merged-narrative'` — rejected, requires new union member that lies about TS-ness; (c) keep `code: string` (non-null) + use empty string `''` for derived skills — rejected, empty string is a real distinct value users might write via `add({code: '', description: '...'})` and the discriminator becomes ambiguous.

**Consequences:** Type-level breaking change to `Skill.code` and `Skill.codeLanguage`. Consumers iterating skills must handle `null` (TypeScript surfaces it). `SkillDraft` remains required-non-nullable (consumers writing skills must still provide code). 2 tests update: GOAL TEST asserts `derived?.code === null`; `scoped-skill-memory.test.ts` asserts `add()` result `code` is non-null.

### D3 — Extract `pgvector-skill-store.ts` as a sibling class (composition over inheritance)

**Decision:** Create `src/local/pgvector-skill-store.ts` containing `class PgvectorSkillStore` with `insertSkill / insertDerivedSkill / markSuperseded / insertDerivedSkillAtomic / assertSkillArgs`. `PgvectorStore` constructor accepts an optional `skillStore?: PgvectorSkillStore`; when absent, `PgvectorStore` constructs one internally so it still satisfies `VectorStoreWithSkillInsert` via delegation. Tests run against `PgvectorStore` (which transparently includes the skill methods).

**Rationale:** `pgvector-store.ts` is 734 LoC, over `architecture.md § Module hygiene` 500 budget. Plan T2.1 of the voyager-skill-library plan explicitly listed the split as an acceptance-criterion fallback. Composition keeps the consumer-facing API (`PgvectorStore` as the single import) while making the skill code-path independently testable + smaller.

**Alternatives considered:** (a) inheritance `class PgvectorSkillStore extends PgvectorStore` — rejected per `architecture.md § OCP` (prefer composition over inheritance); (b) free-functions module instead of class — rejected, the methods close over `this.pool` so a class boundary is natural; (c) skip the split + just add eslint-disable on the file-size warn — rejected, plan acceptance criterion explicitly called the split.

**Consequences:** `pgvector-store.ts` drops to ~470 LoC. `pgvector-skill-store.ts` lands at ~250 LoC. `VectorStoreWithSkillInsert` consumers see no change (PgvectorStore still satisfies it). The conformance suite continues to run against `PgvectorStore` only.

### D4 — `LocalScopedSkillMemory.forget()` writes a `'forget'` history event

**Decision:** `forget()` delegates the deletion through the existing `LocalMemory.forget(skillId)` path (which already writes the history event) instead of calling `vectorStore.delete` directly.

**Rationale:** `architecture.md § 4` says ADD-only semantics + history audit trail. v0.6 skill rows live in the same `memories` table as regular memories — they MUST appear in `history(skillId)` results so the audit trail is uniform. Calling `LocalMemory.forget` directly is the canonical path; reimplementing the history write inside `LocalScopedSkillMemory.forget` would duplicate knowledge (DRY).

**Alternatives considered:** (a) write the history event inline in `LocalScopedSkillMemory.forget` — rejected, duplicates `LocalMemory.forget` logic; (b) skip history events for skills — rejected, breaks audit-trail symmetry across kind values.

**Consequences:** `LocalScopedSkillMemory` constructor needs a reference to the parent `LocalMemory` (or to a `forget(id): Promise<void>` callback). The cleanest path: `LocalMemory.skills()` factory passes its own `forget` method down as a `forgetDelegate` dep. `scoped-skill-memory.ts` 1 LoC change in `forget()` impl + 1 LoC change in the constructor.

### D5 — `RepoScope` is the 4th tier — documented via ADR-0010 (separate file under `.claude/knowledge-base/adrs/`)

**Decision:** The Scope union expansion from 3 → 4 tiers (introduced in v0.6 T4.1) is documented in a new `ADR-0010-repo-scope-fourth-tier.md` under `.claude/knowledge-base/adrs/`. The ADR explains why the locked three-tier `architecture.md § 1` rule was relaxed for code-as-skill memory + cites the strategic review that occurred via this fixes plan + the original voyager-skill-library plan. `architecture.md § 1` gets a one-line edit pointing to ADR-0010.

**Rationale:** F-arch-7 / F-dom-mem-6 surfaced that the 4th-tier addition was not preceded by an explicit strategic review. The fixes plan IS that strategic review; ADR-0010 is its documented output.

**Alternatives considered:** (a) revert RepoScope and persist `repoId` only as a payload key — rejected, the 4th tier already shipped in v0.6 and rolling back forces a schema/type breaking change across 4 switch sites; (b) leave the divergence undocumented — rejected, MINOR finding from `/review`; would re-fire on every future architecture audit.

**Consequences:** New ADR file at `.claude/knowledge-base/adrs/ADR-0010-repo-scope-fourth-tier.md` (~80 LoC). One-line edit to `architecture.md § 1`. CLAUDE.md three-tier framing stays for `User / Session / Agent` (those are the user-facing tiers); `Repo` is an internal scope kind used by `memory.skills(repoId)`.

## Dependency Graph

```
Phase 0: CRITICAL fixes (block PR merge)
  T0.1 (F2)  ─┐
              │
  T0.2 (F1)  ─┤  ←── CROSS-TASK DEP (v1.1): T0.2 depends on T3.3's EC-1 absorption.
              │      T3.3 + T0.2 land in the same atomic commit OR T3.3 lands first.
              │      Without T3.3 EC-1, T0.2 derived skills become invisible to recall.
              │
              ├─→ Phase 1: Hash + dedup correctness (independent of Phase 0)
              │    T1.1 (F6)  ─┐
              │    T1.2 (F7)  ─┘
              │                     ├──→ Phase 2: Performance + correctness
              │                     │     T2.1 (F4)  — depends on Phase 0 + 1 (touches consolidate.ts)
              │                     │     T2.2 (F5)  — depends on Phase 0 + 1 (touches consolidate.ts)
              │                     │
              │                     └──→ Phase 3: Module organization
              │                           T3.1 (F3)        — independent (mechanical extract)
              │                           T3.2 (F8)        — independent
              │                           T3.3 (F9 + EC-1) — load-bearing for T0.2; land FIRST (or atomic with T0.2)

Phase 4: forget() audit trail + scope isolation
  T4.1 (F10 + EC-2) — independent of all Phases 0-3 except T0.1 (both touch scoped-skill-memory.ts)

Phase 5: MINOR bundle (docs + policy)
  T5.1 (ADR-0010 + architecture.md update)
  T5.2 (.claude/rules/no-paper-names-in-code.md promotion)
  T5.3 (JSDoc + inline-comment hygiene — bundled commit)

Phase 6: Integration validation
  T6.1 — /review re-run; CHANGELOG.md updated; GOAL TEST still green
```

**v1.1 ordering invariant:** T3.3 MUST land before or atomic with T0.2. Recommended sequence: T0.1 → T3.3 (with EC-1) → T0.2 (with the post-T3.3 decoder in place) → remaining phases in any order. This serializes the only load-bearing cross-task dependency.

Phase 0 + 1 + 2 + 3 + 4 can land in parallel (different files, except T0.1+T4.1 both touch `scoped-skill-memory.ts` which must serialize). Phase 5 is docs-only (no code dependencies). Phase 6 is the final gate.

Time budget: ~6-10 hours total focused work — most tasks are 1-line to 20-line edits; T3.1 (split) is the biggest at ~250 LoC moved.

---

## Phase 0: CRITICAL fixes

### T0.1 — Drop wrong `EmptyScopeError` throw in `LocalScopedSkillMemory.add()` (F2)

#### Objective

Remove the early `throw new EmptyScopeError()` for empty `description`. The store-layer `assertSkillArgs` already rejects with `InvalidSkillError('empty-description', ...)`.

#### Evidence

- Review finding F2 — verified at `src/local/scoped-skill-memory.ts:116-118`
- Existing correct guard at `src/local/in-memory-store.ts:assertSkillArgs` + `src/local/pgvector-skill-store.ts:assertSkillArgs` (post T3.1) throws the right `InvalidSkillError`

#### Files to edit

```
src/local/scoped-skill-memory.ts                                  — delete lines 116-118 (the if + throw)
src/local/__tests__/scoped-skill-memory.test.ts                   — add 1 RED test: empty description -> InvalidSkillError (not EmptyScopeError)
```

#### Deep file dependency analysis

- `LocalScopedSkillMemory.add` is called only by consumers of `Memory.skills(repoId).add(...)`. No internal caller. Removing the early throw lets the call reach the store layer which throws the typed error.
- `EmptyScopeError` import becomes unused in scoped-skill-memory.ts — drop it too.
- Test file `scoped-skill-memory.test.ts` currently has no assertion on the empty-description case; adding one closes the test gap simultaneously.

#### Deep Dives

- Edge cases: (a) `description = ''` — store throws `InvalidSkillError('empty-description', ...)` ✓; (b) `description = '   '` (whitespace only) — `assertSkillArgs` uses `.trim().length === 0` so it catches this too; (c) `description = null/undefined` — TypeScript catches at compile.

#### Tasks
1. Delete the early throw + the now-unused `EmptyScopeError` import
2. Add a RED test asserting `await memory.skills('repo').add({code:'c', description:'', codeLanguage:'typescript'})` rejects with `InvalidSkillError` and `reason === 'empty-description'`
3. Run the test, confirm GREEN

#### TDD

```
RED:     scoped-skill-memory.test.ts → memory.skills('repo').add({code, description:'', codeLanguage}) rejects with InvalidSkillError(reason='empty-description'). Currently fails because EmptyScopeError is thrown first.
GREEN:   Delete the early throw. Test passes.
REFACTOR: None expected (1-3 LoC deletion).
VERIFY:  npm test -- src/local/__tests__/scoped-skill-memory.test.ts
```

#### Acceptance Criteria
- [ ] `scoped-skill-memory.ts:116-118` deleted
- [ ] `EmptyScopeError` import removed from scoped-skill-memory.ts
- [ ] New RED test passes
- [ ] All existing tests still pass
- [ ] Pass: lint zero warnings
- [ ] Pass: typecheck zero errors

#### DoD
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

### T0.2 — Derived-skill `code = null`, `codeLanguage = null` (F1)

#### Objective

Relax `Skill.code` to `string | null` and `Skill.codeLanguage` to `SkillLanguage | null`. Phase 3 of `consolidate()` writes `null` for both on derived skills. Add ADR-D6 (now ADR-D2 of this plan) JSDoc on the orchestrator + on `Skill.code`/`.codeLanguage` fields explaining the v0.6.1 contract. GOAL TEST extends to assert `derived?.code === null`.

#### Evidence

- Review finding F1 — verified at `src/local/skills/consolidate.ts:401-426` (code = description = draft.text)
- Schema at `src/local/schema.ts:67-73` — both columns ARE nullable already (no migration needed)
- ADR D2 of the original voyager-skill-library plan = "code-as-skill primary representation"; v0.6.1 accepted-risk: derived skills don't yet carry executable code, structured-draft extraction shipped at v0.7

#### Files to edit

```
src/core/skill.ts                                                 — relax `code: string` to `code: string | null` + `codeLanguage: SkillLanguage` to `codeLanguage: SkillLanguage | null` on `Skill` interface; SkillDraft stays non-nullable; JSDoc updated
src/local/skills/consolidate.ts                                   — Phase 3: insertArgs.code = null, insertArgs.codeLanguage = null (NOT description). Drop the inline "code = description" comment.
src/local/skills/payload.ts                                       (NEW after T3.3) — decoder handles `code === null` + `codeLanguage === null`
src/local/scoped-skill-memory.ts                                  — payloadToSkill: read `code` directly, no String() coercion; same for codeLanguage
src/core/__tests__/skill.test-d.ts                                — assert Skill.code is `string | null`; SkillDraft.code stays `string`
src/local/skills/__tests__/consolidate.test.ts                    — assert derivedSkills[0].code === null AND derivedSkills[0].codeLanguage === null
tests/integration/skills/consolidate-two-skills.test.ts           — add 2 assertions: derived.code === null AND derived.codeLanguage === null
```

#### Deep file dependency analysis

- `Skill.code` is consumed by `projectSkillToMemoryItem` in `consolidate.ts:132-148` — that function builds the LLM source text. Need to handle `code === null`: fall back to description only.
- `payloadToSkill` in `scoped-skill-memory.ts:48` and `rowToSkill` in `consolidate.ts:240` (and post-T3.3 `decodeSkillPayload`): read `code` from payload; payload value is `null` when the column is NULL. The current `String(payload['code'] ?? '')` collapses to `''` — fix to return `null` when the value is null.
- `InsertSkillArgs` and `InsertDerivedSkillArgs` in `src/local/skill-store-args.ts`: `code: string` and `codeLanguage: SkillLanguage` stay required for `add()` (consumers MUST supply code when adding) but consolidate's atomic path needs to pass nulls. Add a separate field shape OR widen the types in `InsertDerivedSkillArgs` (used only by `consolidate`, not by `add`).
- pgvector `insertDerivedSkillAtomic` currently calls `assertSkillArgs(args)` which asserts `codeLanguage` is in the allowed set. Need to skip that check when `codeLanguage === null` OR split assertions: `assertDescription` always runs; `assertCodeLanguage` only when non-null.

#### Deep Dives

- **Type contract diff:** `Skill.code: string` → `Skill.code: string | null`. `Skill.codeLanguage: SkillLanguage` → `Skill.codeLanguage: SkillLanguage | null`. `SkillDraft.code: string` STAYS (required for write). `SkillWithScore` inherits from `Skill` so it gets the nullables for free.
- **`projectSkillToMemoryItem` adjustment** at `consolidate.ts:132`: `const text = skill.code === null || skill.code.length === 0 ? skill.description : ...`.
- **`InsertDerivedSkillArgs` widening:** add `code: string | null` and `codeLanguage: SkillLanguage | null` to the interface in `skill-store-args.ts` ONLY for the derived variant. `InsertSkillArgs` (used by `add()`) stays required-non-null.
- **assertSkillArgs split:** factor out two helpers — `assertDescriptionPresent` (always called) + `assertCodeLanguageIfPresent` (called only when codeLanguage !== null). Same pattern in pgvector + in-memory.
- **Schema invariant:** already accepts NULL on both `code` and `code_language` columns; no migration needed.
- **(v1.1 EC-1 absorption — CROSS-TASK DEPENDENCY)** post-T0.2 derived skills are persisted with `code_language = NULL` at the DB layer. The current `rowToSkill` decoder in `consolidate.ts:240` AND `payloadToSkill` in `scoped-skill-memory.ts:48` (both replaced by `decodeSkillPayload` at T3.3) reject any row whose `codeLanguageRaw !== 'typescript' && codeLanguageRaw !== 'javascript'`. After T0.2 lands, derived skills become invisible to recall + the Orient phase, breaking THE GOAL TEST in Phase 6 + breaking re-runs of `consolidate()`. **T3.3 MUST relax the predicate to:** `codeLanguageRaw == null || codeLanguageRaw === 'typescript' || codeLanguageRaw === 'javascript'` when `kind === 'skill'`. This dependency is now explicit in the Dependency Graph: **T0.2 → T3.3** (T3.3 must land BEFORE T0.2 is GREEN at integration tier, OR they must land in the same atomic commit). Plan dependency graph updated accordingly.
- Edge cases: (a) a consumer reads back a derived skill and expects to execute `code` — they see `code: null` and `codeLanguage: null`, know not to execute. Document this prominently in `Skill.code` JSDoc. (b) recall returns a mix of `add()`-written skills (code populated) and consolidated derived skills (code null) — the type contract handles both uniformly.

#### Tasks
1. Update `Skill.code` and `Skill.codeLanguage` to nullable in `src/core/skill.ts` + JSDoc
2. Widen `InsertDerivedSkillArgs` (not `InsertSkillArgs`) to accept null code/codeLanguage in `src/local/skill-store-args.ts`
3. Split `assertSkillArgs` into `assertDescriptionPresent` + `assertCodeLanguageIfPresent` in `pgvector-skill-store.ts` + `in-memory-store.ts`
4. Phase 3 of `consolidate()` writes `code: null, codeLanguage: null` instead of `code: description`
5. `projectSkillToMemoryItem` handles `code === null` correctly
6. `decodeSkillPayload` (post T3.3) returns `code: null` and `codeLanguage: null` when payload values are null (the projection in `rowToResult` already produces null when the column is null + the merger if-NOT-null pattern handles it)
7. Add 2 RED tests at the consolidate unit + integration tiers
8. Verify type-test file asserts the new shape

#### TDD

```
RED:     consolidate.test.ts → cluster-of-2-skills test asserts derivedSkills[0].code === null AND derivedSkills[0].codeLanguage === null. Currently fails because code = description.
RED:     consolidate-two-skills.test.ts → derived?.code === null AND derived?.codeLanguage === null. Currently fails.
RED:     skill.test-d.ts → expectTypeOf<Skill['code']>().toEqualTypeOf<string | null>(). Currently fails.
GREEN:   Apply all 7 task changes.
REFACTOR: None expected.
VERIFY:  npm test && npm run test:integration -- tests/integration/skills/
```

#### Acceptance Criteria
- [ ] `Skill.code` typed `string | null`; `Skill.codeLanguage` typed `SkillLanguage | null`
- [ ] `SkillDraft.code` STAYS `string` (consumers writing skills must still provide code)
- [ ] Phase 3 of `consolidate()` writes `null` for both fields
- [ ] GOAL TEST asserts `derived?.code === null`
- [ ] All consumers of `Skill.code` handle the null case (TypeScript surfaces them)
- [ ] ADR-D6 (this plan's D2) JSDoc-cited on the relaxed fields + on `consolidate.ts` Phase 3
- [ ] Pass: complexity unchanged (no new branches beyond null checks)
- [ ] Pass: lint zero warnings
- [ ] Pass: size budget — consolidate.ts stays ≤ 500 LoC

#### DoD
- [ ] All tasks complete
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings
- [ ] THE GOAL TEST still passes (with new assertions)

---

## Phase 1: Hash + dedup correctness

### T1.1 — `consolidate.ts:408` derived-skill hash uses `hashFact()` (F6)

#### Objective

Replace `hash = 'derived-skill-${Date.now()}-${Math.random()}'` with `hashFact(description)` so the dedup invariant survives + `consolidate()` is idempotent.

#### Evidence

- Review finding F6
- `architecture.md § 4` content-derived hash invariant
- `src/core/dedup.ts:18` exports `hashFact(text: string): string` — canonical MD5

#### Files to edit

```
src/local/skills/consolidate.ts                                   — drop the timestamp+random hash; use hashFact(description)
src/local/skills/__tests__/consolidate.test.ts                    — assert hash is deterministic when consolidate runs twice on identical clusters
```

#### Deep file dependency analysis

- `hashFact` already imported in v0.4a reflect path — verified at `src/local/index.ts`. New import in consolidate.ts: 1 line.
- pgvector `memories_hash_unique_idx UNIQUE` (v0.1) — re-running consolidate with the same derived description produces the same hash → UNIQUE violation. This is the CORRECT behavior (idempotency); test asserts the second run does NOT create a duplicate derived row.

#### Deep Dives

- Edge case: 2 different clusters happen to produce identical merged descriptions (e.g., both LLM calls collapsed to "retry helper"). The UNIQUE hash index rejects the second INSERT. The orchestrator must catch + skip that cluster gracefully.
- Edge case: a derived skill from cluster A is then itself a member of cluster B (transitive consolidation). The hash invariant still holds because new descriptions get fresh hashes.

#### Tasks
1. Import `hashFact` in consolidate.ts
2. Replace the timestamp hash with `hashFact(description)`
3. Wrap `insertDerivedSkillAtomic` in try/catch for the UNIQUE violation; on duplicate, log via tracer + skip the cluster (do NOT throw)
4. RED test: running `consolidate()` twice on the same cluster produces only 1 derived skill (second run is a no-op)

#### TDD

```
RED:     consolidate.test.ts → run consolidate twice; assert derivedSkills.length === 1 on first call, derivedSkills.length === 0 on second call. Currently first call produces 1 with random hash; second call produces 1 MORE with a different random hash (idempotency broken).
GREEN:   Switch to hashFact(description); second call hits UNIQUE constraint; orchestrator catches + skips.
REFACTOR: Extract the UNIQUE-catch wrapper if 3rd consumer emerges.
VERIFY:  npm test -- src/local/skills/__tests__/consolidate.test.ts
```

#### Acceptance Criteria
- [ ] `hashFact` import added
- [ ] Hash computation deterministic
- [ ] Idempotent re-run test passes
- [ ] Pass: complexity ≤ 10
- [ ] Pass: lint + typecheck zero

#### DoD
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

### T1.2 — `scoped-skill-memory.ts:121` `add()` hash uses `hashFact()` (F7)

#### Objective

Replace the manual `createHash('md5').update(code).update('|').update(description)` chain with `hashFact(description)` (description IS the dedup target since it IS the embedding target).

#### Evidence

- Review finding F7
- `architecture.md § 4` MD5 of normalized text

#### Files to edit

```
src/local/scoped-skill-memory.ts                                  — replace createHash chain with hashFact(draft.description)
src/local/__tests__/scoped-skill-memory.test.ts                   — assert two adds with same description but different code throw UNIQUE error (idempotency)
```

#### Deep file dependency analysis

- `node:crypto` import in scoped-skill-memory.ts becomes unused — drop it.

#### Deep Dives

- Question: should the hash include code too? Decision: NO — description IS the embedding target AND the canonical identity of the skill. Two skills with same description but different code SHOULD collide (the user is rewriting the same skill).
- Edge case: a consumer wants to add 2 implementations of "retry helper" with different code — they must use 2 different descriptions. Document.

#### Tasks
1. Replace hash chain with `hashFact(draft.description)`
2. Drop `node:crypto` import
3. Test: add same description twice → UNIQUE violation

#### TDD

```
RED:     scoped-skill-memory.test.ts → adding the same description twice (with different code) throws UNIQUE error. Currently passes because the manual hash includes code (different hashes).
GREEN:   Switch to hashFact(description); test now passes (second add throws).
REFACTOR: None.
VERIFY:  npm test -- src/local/__tests__/scoped-skill-memory.test.ts
```

#### Acceptance Criteria
- [ ] `createHash` removed from scoped-skill-memory.ts
- [ ] Test asserts dedup-on-description behavior
- [ ] Pass: lint + typecheck zero

#### DoD
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

---

## Phase 2: Performance + correctness

### T2.1 — Orient phase: drop dead `get()` + use `embedBatch` (F4)

#### Objective

In `consolidate.ts:Phase 1 (Orient)`, remove the per-row `vectorStore.get(row.id)` call AND replace the sequential `embed()` loop with a single `embedBatch(descriptions)` call.

#### Evidence

- Review finding F4 — verified at `consolidate.ts:322-335`
- `Embedder` DIP has `embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>` (v0.1)
- At 500-skill page size: 500 SQL `get()` + 500 sequential `embed()` → 1 `list()` already done + 1 `embedBatch`

#### Files to edit

```
src/local/skills/consolidate.ts                                   — delete the get() call; replace per-row embed loop with embedBatch
src/local/skills/__tests__/consolidate.test.ts                    — verify embedBatch is called once with N descriptions (use vi.spyOn)
```

#### Deep file dependency analysis

- `embedBatch` is called by the existing v0.1 extraction pipeline; pgvector + in-memory both implement it. No DIP change.
- The test fixture `FixtureEmbedder` already has `embedBatch` implemented.

#### Deep Dives

- Edge case: `embedBatch` rejects → wrap in try/catch and fall back to per-row `embed` (matches v0.1 pipeline pattern at `runExtractionPipeline`).
- Edge case: `descriptions.length === 0` → return empty result before calling embedBatch.

#### Tasks
1. Delete the `get()` call + the null-guard
2. Build `descriptions: string[]` array from skills found by `list()`
3. Call `embedder.embedBatch(descriptions)` once; pair each result with its skill
4. Fallback: catch + per-row `embed`
5. Spy test asserts `embedBatch` called once with N items

#### TDD

```
RED:     consolidate.test.ts → spy on embedder.embedBatch; assert it's called once with 3 descriptions when 3 skills exist. Currently fails because the impl calls embed() N times instead.
GREEN:   Apply changes.
REFACTOR: None.
VERIFY:  npm test -- src/local/skills/__tests__/consolidate.test.ts
```

#### Acceptance Criteria
- [ ] Dead `get()` removed
- [ ] `embedBatch` used in Orient phase
- [ ] Fallback path covered by 1 test
- [ ] Pass: complexity ≤ 10
- [ ] Pass: lint zero warnings

#### DoD
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors

### T2.2 — Phase 3 of `consolidate()` iterates ALL drafts (F5)

#### Objective

Replace `const draft = drafts[0]` with iteration over the full `drafts` array. For each draft passing `validateProvenance` + `derivedFrom.length >= 2`, persist a derived skill.

#### Evidence

- Review finding F5 — verified at `consolidate.ts:351-360`
- v0.4a `LocalScopedMemory.reflect()` iterates: see `src/local/index.ts:297`

#### Files to edit

```
src/local/skills/consolidate.ts                                   — loop over drafts instead of taking drafts[0]
src/local/skills/__tests__/consolidate.test.ts                    — RED test: LLM returns 2 valid drafts → 2 derived skills produced
```

#### Deep file dependency analysis

- Each derived skill calls `insertDerivedSkillAtomic` independently. Each one marks the SAME source cluster as superseded — the second call's `markSuperseded` is a no-op (already set). NOT a problem semantically.
- Question: do we want multiple derived skills from one cluster? Voyager pattern says yes — multiple "perspectives" can derive from the same source.

#### Deep Dives

- Edge case: 5 drafts returned; 3 pass provenance + length checks; 2 fail. Only 3 derived skills materialized. Test covers this.
- Edge case: 1st draft succeeds but `insertDerivedSkillAtomic` throws on UNIQUE (duplicate hash from another cluster): catch + continue to next draft.

#### Tasks
1. Replace `const draft = drafts[0]` with `for (const draft of drafts) { ... }`
2. Each iteration: validateProvenance + length≥2 check + insertDerivedSkillAtomic
3. RED test: LLM returns 2 valid drafts → result.derivedSkills.length === 2
4. RED test: LLM returns 3 drafts where 1 has degenerate provenance → result.derivedSkills.length === 2

#### TDD

```
RED:     consolidate.test.ts → 2-skill cluster + LLM returns 2 distinct valid drafts → result.derivedSkills.length === 2.
GREEN:   Iterate.
REFACTOR: None.
VERIFY:  npm test -- src/local/skills/__tests__/consolidate.test.ts
```

#### Acceptance Criteria
- [ ] Iteration over drafts implemented
- [ ] 2 new RED tests pass
- [ ] Existing tests still pass
- [ ] Pass: complexity ≤ 12 (one nested loop OK)

#### DoD
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors

---

## Phase 3: Module organization

### T3.1 — Extract `pgvector-skill-store.ts` (F3)

#### Objective

Move `insertSkill / insertDerivedSkill / markSuperseded / insertDerivedSkillAtomic / assertSkillArgs / ALLOWED_SKILL_LANGUAGES` from `pgvector-store.ts` to a new `pgvector-skill-store.ts`. `PgvectorStore` delegates via composition so `VectorStoreWithSkillInsert` is still satisfied.

#### Evidence

- Review finding F3 — `wc -l src/local/pgvector-store.ts` returns 734
- T2.1 acceptance criterion of voyager-skill-library plan said "split into pgvector-skill-store.ts sibling if budget exceeded"

#### Files to edit

```
src/local/pgvector-skill-store.ts                                 (NEW) — class with the 4 skill methods + assertSkillArgs + ALLOWED_SKILL_LANGUAGES
src/local/pgvector-store.ts                                       — drop skill methods; constructor creates an internal PgvectorSkillStore; delegate the 4 methods to it
src/local/__tests__/pgvector-skill-store.test.ts                  (NEW) — direct unit tests on the extracted class
src/local/__tests__/vector-store-conformance.ts                   — unchanged (still runs against PgvectorStore which delegates)
```

#### Deep file dependency analysis

- Both files import from `src/core/skill.ts` + `src/core/errors.ts` + `src/local/skill-store-args.ts`. Imports stay symmetric.
- `PgvectorStore.withTransaction` is needed by `PgvectorSkillStore.insertDerivedSkillAtomic`. Either: (a) expose `withTransaction` on PgvectorStore for the skill class to call OR (b) pass a `withTransaction` callback into PgvectorSkillStore's constructor. Option (b) is cleaner (lower coupling).
- pgvector `Pool` reference: PgvectorSkillStore needs the pool. Constructor `constructor(private readonly pool: Pool, private readonly withTransactionFn: <T>(fn: (tx: PoolClient) => Promise<T>) => Promise<T>)`.

#### Deep Dives

- File sizes target: pgvector-store.ts drops to ~470 LoC; pgvector-skill-store.ts lands at ~250 LoC. Both under 500.
- Conformance suite still tests through `PgvectorStore` (no test file edit needed) — the delegated methods still satisfy the interface.
- Edge case: a future cloud adapter wants skill semantics — it constructs its own analog of PgvectorSkillStore; the contract surface is small (4 methods + 1 assertion).

#### Tasks
1. Author `pgvector-skill-store.ts` with all 4 methods + assertSkillArgs + ALLOWED_SKILL_LANGUAGES
2. Update `pgvector-store.ts`: drop the skill methods; constructor instantiates PgvectorSkillStore; 4 delegating methods
3. Author unit tests for PgvectorSkillStore (direct injection of mock Pool + withTransaction stub)
4. Verify conformance suite still passes via tests/integration/pgvector-store.test.ts
5. Verify `wc -l` on both files

#### TDD

```
RED:     pgvector-skill-store.test.ts → instance constructed with a stub pool throws InvalidSkillError on empty description (existing assertSkillArgs behavior, now at the new class). Currently fails because the class doesn't exist.
RED:     pgvector-skill-store.test.ts → insertDerivedSkillAtomic calls withTransaction once when called.
GREEN:   Author the new class. Delegation in PgvectorStore.
REFACTOR: None expected.
VERIFY:  npm test && wc -l src/local/pgvector-store.ts src/local/pgvector-skill-store.ts
```

#### Acceptance Criteria
- [ ] `pgvector-store.ts` ≤ 500 LoC
- [ ] `pgvector-skill-store.ts` ≤ 300 LoC
- [ ] Conformance suite passes (in-memory + pgvector integration tier)
- [ ] PgvectorSkillStore has 4 unit tests
- [ ] Pass: lint + typecheck zero
- [ ] DIP: PgvectorSkillStore imports only from `../core/` and `./skill-store-args.ts`

#### DoD
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

### T3.2 — Delete dead barrel `src/local/skills/index.ts` (F8)

#### Objective

Remove `src/local/skills/index.ts`. No in-project caller imports through it; `LocalScopedSkillMemory` imports `consolidate` directly from `./skills/consolidate.js`.

#### Evidence

- Review finding F8 — verified via grep: zero in-project callers of the barrel

#### Files to edit

```
src/local/skills/index.ts                                         — DELETE
```

#### Deep file dependency analysis

- Pre-flight grep: `grep -rn "from.*skills/index" src/` — must return zero hits before deletion.
- Post-grep: `grep -rn "from.*skills/consolidate" src/` — verifies callers go direct.

#### Deep Dives

- Question: should consolidate be re-exported through the public barrel `src/index.ts` so external consumers can call it? Decision: NO — consumers use `memory.skills(repoId).consolidate()`; the function is internal. Future v0.7+ may expose it if a use case emerges.

#### Tasks
1. Confirm zero in-project callers
2. Delete the file
3. Verify build still works

#### TDD

```
N/A — file deletion. Test discipline: existing tests continue passing.
VERIFY:  test ! -f src/local/skills/index.ts && npm test
```

#### Acceptance Criteria
- [ ] File deleted
- [ ] `npm test` still green
- [ ] `npm run lint` clean
- [ ] No new import errors

#### DoD
- [ ] File absent from tree
- [ ] All tests + typecheck + lint clean

### T3.3 — Extract `decodeSkillPayload` helper + absorb EC-1 codeLanguage-null path (F9 + v1.1 EC-1)

#### Objective

Centralize the payload-to-Skill decoding (kind discriminator check, codeLanguage narrowing, derived_from JSON.parse with try/catch) in a single helper at `src/local/skills/payload.ts`. `payloadToSkill` (scoped-skill-memory.ts:48) and `rowToSkill` (consolidate.ts:240) call sites delegate. **(v1.1 EC-1 absorption)** the new decoder accepts `code_language` ∈ `{null, undefined, 'typescript', 'javascript'}` when `kind === 'skill'` so derived skills (which carry NULL post-T0.2) survive the decode path. Without this, recall + Orient phase silently lose derived skills + THE GOAL TEST regresses in Phase 6.

#### Evidence

- Review finding F9 — verified: identical decoding logic in both files
- **v1.1 EC-1** — verified at `src/local/skills/consolidate.ts:222-225` AND `src/local/scoped-skill-memory.ts:56-59` (both have the strict `!== 'typescript' && !== 'javascript' → return null` guard). Post-T0.2 derived skills have `code_language = NULL`; without EC-1 absorption, the decoder returns null → row filtered → GOAL TEST breaks.

#### Files to edit

```
src/local/skills/payload.ts                                       (NEW) — decodeSkillPayload(payload, scope, score?): Skill | SkillWithScore | null
src/local/scoped-skill-memory.ts                                  — drop inline payloadToSkill; call decodeSkillPayload
src/local/skills/consolidate.ts                                   — drop inline rowToSkill; call decodeSkillPayload
src/local/skills/__tests__/payload.test.ts                        (NEW) — 6 unit tests for the decoder edge cases (4 original + 2 EC-1)
```

#### Deep file dependency analysis

- `decodeSkillPayload` imports from `src/core/skill.ts` (types) + `src/core/scope.ts` (Scope type). No DIP violation.
- The 6 edge cases to test: (1) valid skill payload (code+codeLanguage non-null) → Skill; (2) `kind !== 'skill'` → null; (3) malformed `derived_from` JSON → empty array (graceful degradation); (4) `score` parameter populates SkillWithScore; **(5) EC-1: derived skill with `code = null` AND `code_language = null` → Skill (not null); (6) EC-1: skill with `code_language` undefined (column missing) → Skill (not null).**

#### Deep Dives

- post-T0.2 handles `code: string | null` + `codeLanguage: SkillLanguage | null` correctly — payload['code'] may be null, decoder returns the field as null without coercion.
- **(v1.1 EC-1 absorption — predicate change)** OLD predicate at `consolidate.ts:222` AND `scoped-skill-memory.ts:56` was:
  ```ts
  if (codeLanguageRaw !== 'typescript' && codeLanguageRaw !== 'javascript') {
    return null;  // ← bug after T0.2: derived skills filtered out
  }
  ```
  NEW predicate (single source of truth in `decodeSkillPayload`):
  ```ts
  // EC-1 absorption (v1.1 of fixes plan): derived skills carry NULL code_language after T0.2.
  // Reject only when the value is a positive non-matching string (data corruption signal).
  if (codeLanguageRaw != null
      && codeLanguageRaw !== 'typescript'
      && codeLanguageRaw !== 'javascript') {
    return null;
  }
  const codeLanguage: SkillLanguage | null = codeLanguageRaw ?? null;
  ```
  Symmetric handling for `code`: `const code: string | null = payload['code'] == null ? null : String(payload['code']);`.
- Edge case: payload has `kind = 'skill'` but missing `description` — decoder returns the row with empty description (useless for recall but won't crash). Test covers.

#### Tasks
1. Author `decodeSkillPayload` in `src/local/skills/payload.ts` with the relaxed code_language predicate (EC-1 absorption)
2. Rewrite `payloadToSkill` in scoped-skill-memory.ts as 1-line delegate
3. Rewrite `rowToSkill` in consolidate.ts as 1-line delegate
4. Write 6 unit tests (4 original + 2 EC-1 coverage)

#### TDD

```
RED (1):  payload.test.ts → valid skill payload with code+codeLanguage non-null decodes to Skill. Fails because payload.ts doesn't exist.
RED (2):  payload.test.ts → payload with kind !== 'skill' → returns null.
RED (3):  payload.test.ts → malformed derived_from JSON string → returns Skill with derivedFrom: [].
RED (4):  payload.test.ts → score parameter populates SkillWithScore.score.
RED (5):  payload.test.ts (EC-1) → payload with `kind='skill'`, `code=null`, `code_language=null` → decodes to Skill (NOT null). Lock the v1.1 absorption.
RED (6):  payload.test.ts (EC-1) → payload with `kind='skill'`, `code_language=undefined` (column missing) → decodes to Skill (NOT null).
GREEN:    Author the decoder + delegate the call sites.
REFACTOR: Inline-comment the EC-1 predicate change with reference to "v1.1 EC-1 absorption / voyager-skill-library-fixes-v0-6-1 plan".
VERIFY:   npm test -- src/local/skills/__tests__/payload.test.ts
```

#### Acceptance Criteria
- [ ] payload.ts ≤ 150 LoC
- [ ] scoped-skill-memory.ts loses ~50 LoC
- [ ] consolidate.ts loses ~60 LoC
- [ ] 6 unit tests pass (4 original + 2 EC-1)
- [ ] Existing tests still pass
- [ ] **(v1.1 EC-1)** integration test: post-T0.2 consolidate run produces a derived skill that IS retrievable via `recall(query)` (THE GOAL TEST extension already covered in T0.2 still passes)
- [ ] Pass: lint + typecheck zero

#### DoD
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors

---

## Phase 4: forget() audit trail

### T4.1 — `LocalScopedSkillMemory.forget()` writes a `'forget'` history event + enforces scope isolation (F10 + v1.1 EC-2)

#### Objective

Align `LocalScopedSkillMemory.forget()` JSDoc with hard-delete impl. The impl (a) **fetches the row + rejects cross-scope `skillId` with `MemoryNotFound` per v1.1 EC-2**, then (b) delegates to `LocalMemory.forget(skillId)` (the existing path that writes the history event) instead of calling `vectorStore.delete` directly.

#### Evidence

- Review finding F10 — verified at `src/core/skill.ts:147` JSDoc + `src/local/scoped-skill-memory.ts:193` impl
- **v1.1 EC-2** — pre-existing v0.6 gap reproducible via integration test: `await memory.skills('A').add({...})` returns `skillA.id`; `await memory.skills('B').forget(skillA.id)` succeeds (deletes A's skill from B's scope). No scope check.
- `LocalMemory.forget` at `src/local/index.ts` writes the `'forget'` event via the configured HistoryManager + is scope-agnostic by design (ADR-0004 — memoryId globally unique)

#### Files to edit

```
src/core/skill.ts                                                 — align JSDoc with hard-delete impl + scope isolation note
src/local/scoped-skill-memory.ts                                  — constructor accepts `forgetDelegate` + `getDelegate` deps; forget() fetches row + scope-checks BEFORE delegate
src/local/index.ts                                                — Memory.skills() factory passes `forget` + `get` bound to LocalMemory
src/local/__tests__/scoped-skill-memory.test.ts                   — assert (a) forget appends 'forget' history event + (b) cross-scope forget rejects with MemoryNotFound
```

#### Deep file dependency analysis

- `LocalMemory.forget(memoryId)` writes the history event via `this.config.historyManager?.append(...)` — same path skill rows should follow.
- `LocalMemory.get(memoryId)` returns the MemoryItem (or null). Used by the pre-delegate scope check.
- `LocalScopedSkillMemory.deps` gains TWO new fields: `forget: (id: string) => Promise<void>` AND `get: (id: string) => Promise<MemoryItem | null>` — both constructor-injected from `LocalMemory.skills()`.
- The scope check reads `row.metadata['agent_id']` (RepoScope persists `repoId` in the `agent_id` column per EC-4 of the v0.6 plan) AND `row.metadata['kind']`. Both must match — `agent_id === this.scope.repoId` AND `kind === 'skill'`. If either fails, throw `MemoryNotFound(skillId)` BEFORE the delegate runs.

#### Deep Dives

- Edge case: `LocalMemory.forget` already calls `this.config.vectorStore.delete(id)` internally — calling it from `LocalScopedSkillMemory.forget` is the canonical delegation, no double-delete risk.
- Edge case: `historyManager` undefined → `LocalMemory.forget` silently skips the history write (existing v0.4a behavior) — `LocalScopedSkillMemory.forget` inherits the same.
- **(v1.1 EC-2 absorption — scope-isolation contract)** Behavior matrix:
  | Caller | `skillId` belongs to | Outcome |
  |---|---|---|
  | `memory.skills('A').forget(id)` | `kind='skill'` AND `agent_id='A'` | row deleted + history event written ✓ |
  | `memory.skills('A').forget(id)` | `kind='skill'` AND `agent_id='B'` | throws `MemoryNotFound(id)` — row in B preserved |
  | `memory.skills('A').forget(id)` | `kind='extracted'` (a regular memory, not a skill) | throws `MemoryNotFound(id)` — scope kind mismatch |
  | `memory.skills('A').forget(id)` | id doesn't exist | throws `MemoryNotFound(id)` — same as v0.4a `LocalMemory.forget` |
  All four cases throw the SAME error class — consumer can't distinguish "you don't own it" from "doesn't exist" (intentional: information-leak prevention).
- Edge case: race condition — caller A and B both call `forget(id)` simultaneously where id belongs to A. B's call MAY pass its scope check if A's delete hasn't committed yet, then B's delegate hits the now-deleted row → throws `MemoryNotFound`. Acceptable: the second caller sees the correct error class anyway.

#### Tasks
1. Update `src/core/skill.ts` JSDoc on `ScopedSkillMemory.forget` — say "hard-delete (scope-isolated); appends 'forget' to history; throws MemoryNotFound for cross-scope or non-existent ids"
2. `LocalScopedSkillMemory` constructor accepts `forgetDelegate: (id) => Promise<void>` AND `getDelegate: (id) => Promise<MemoryItem | null>`
3. `forget()` impl: `const row = await this.deps.getDelegate(skillId); if (row === null || row.metadata['agent_id'] !== this.scope.repoId || row.metadata['kind'] !== 'skill') throw new MemoryNotFound(skillId); await this.deps.forgetDelegate(skillId);`
4. `LocalMemory.skills()` passes `forget: this.forget.bind(this)` + `get: this.get.bind(this)`
5. Test: after `scoped.forget(id)`, `memory.history(id)` returns a result whose latest entry has `action: 'forget'`
6. **(EC-2)** Test: `memory.skills('A').forget(skillFromBId)` rejects with `MemoryNotFound`; subsequent `memory.skills('B').get(skillFromBId)` returns the row (untouched)
7. **(EC-2)** Test: `memory.skills('A').forget(idOfRegularUserMemory)` rejects with `MemoryNotFound` (kind mismatch, not 'skill')

#### TDD

```
RED (1): scoped-skill-memory.test.ts → after scoped.forget(id), memory.history(id) returns entries containing one with action === 'forget'.
RED (2): scoped-skill-memory.test.ts (EC-2) → const skillA = await memory.skills('A').add(...); await expect(memory.skills('B').forget(skillA.id)).rejects.toBeInstanceOf(MemoryNotFound); const stillExists = await memory.skills('A').recall('...'); expect(stillExists.map(s=>s.id)).toContain(skillA.id).
RED (3): scoped-skill-memory.test.ts (EC-2) → const userMemId = await memory.user('alice').remember('...').then(m=>m[0].id); await expect(memory.skills('A').forget(userMemId)).rejects.toBeInstanceOf(MemoryNotFound).
GREEN:   Wire the 2 delegates + scope-check guard.
REFACTOR: None.
VERIFY:  npm test -- src/local/__tests__/scoped-skill-memory.test.ts
```

#### Acceptance Criteria
- [ ] JSDoc aligned with impl + scope isolation note
- [ ] forgetDelegate + getDelegate deps wired
- [ ] History assertion passes (F10)
- [ ] **(v1.1 EC-2)** Cross-scope forget rejects with `MemoryNotFound`; victim row untouched
- [ ] **(v1.1 EC-2)** Forget on non-skill memory id rejects with `MemoryNotFound` (kind mismatch)
- [ ] Existing forget test still passes
- [ ] Pass: lint + typecheck zero

#### DoD
- [ ] `npm test` green
- [ ] `npm run typecheck` zero errors

---

## Phase 5: MINOR bundle (docs + policy)

### T5.1 — ADR-0010 + architecture.md update for `RepoScope` (F-arch-7 / F-dom-mem-6)

#### Objective

Document the v0.6 3-tier → 4-tier Scope union expansion via `ADR-0010-repo-scope-fourth-tier.md`. Update `architecture.md § 1` with a one-line pointer.

#### Files to edit

```
.claude/knowledge-base/adrs/ADR-0010-repo-scope-fourth-tier.md    (NEW) — strategic-review record
.claude/rules/architecture.md                                     — § 1 gets a one-line "RepoScope is the 4th tier added by v0.6 — see ADR-0010" pointer
CLAUDE.md (project)                                               — Architectural Decisions Locked: append a row for RepoScope
```

#### Tasks
1. Author ADR-0010 explaining the 4th-tier decision + cite the original voyager-skill-library plan + this fixes plan
2. One-line edit in architecture.md
3. One row in CLAUDE.md's locked-decisions table

#### TDD

N/A — docs only. Test discipline: existing tests stay green.

#### Acceptance Criteria
- [ ] ADR exists
- [ ] architecture.md updated
- [ ] CLAUDE.md updated

### T5.2 — Promote no-paper-names-in-code policy to `.claude/rules/` (F-arch-10)

#### Objective

Move (or copy) the `no_paper_names_in_code.md` session memory at `/home/paulo/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/memory/` to `.claude/rules/no-paper-names-in-code.md` so it becomes a first-class project rule cited by ADRs.

#### Files to edit

```
.claude/rules/no-paper-names-in-code.md                           (NEW) — project rule version of the session memory
src/core/dip/skill-representation-strategy.ts                     — JSDoc reference updated to `.claude/rules/no-paper-names-in-code.md`
```

#### Tasks
1. Author the project rule version (session-memory file stays as the user-personal cache)
2. Update the JSDoc reference in skill-representation-strategy.ts

#### Acceptance Criteria
- [ ] Rule file exists
- [ ] JSDoc reference resolves

### T5.3 — JSDoc + inline-comment hygiene bundle (F-arch-8 / F-arch-9 / F-tests-1/2/3/4 / F-dom-pgvec-11 / F-dom-pgvec-12 / F-xval-1)

#### Objective

A single docs-only commit closing the remaining MINORs: bridging JSDoc for `Filters.excludeSuperseded` polarity, rename `vectorLiteral` shadowing in `insertDerivedMemory`, add EC-N markers in `scope.test-d.ts`, rename test names without "and", inline guard comments in fixtures, etc.

#### Files to edit

```
src/local/pgvector-store.ts                                       — rename shadowing `vectorLiteral` in insertDerivedMemory
src/core/scope.ts                                                 — JSDoc on Filters.excludeSuperseded polarity vs RecallOptions.includeSuperseded
src/core/__tests__/scope.test-d.ts                                — add `EC-4` comment marker
src/local/__tests__/scoped-skill-memory.test.ts                   — rename test removing "and"
src/local/__tests__/recall-filters.test.ts                        — rename test removing "and"
tests/integration/skills/fixtures/two-similar-skills.ts           — add guard comment: "descriptions MUST stay byte-identical; load-bearing invariant"
```

#### Tasks

Bundle all 7+ MINOR items into one `chore(docs)(v0-6-1): close /review MINOR findings` commit.

#### Acceptance Criteria

- [ ] Each MINOR has either a JSDoc or inline-comment fix
- [ ] No behavior change
- [ ] Tests stay green

---

## Phase 6: Integration validation — `/review` re-run

### T6.1 — Re-run `/review voyager-skill-library` + CHANGELOG entry + GOAL TEST re-run

#### Objective

Verify the consolidated review verdict transitions from `NEEDS_FIXES` to `READY_TO_MERGE`. Update CHANGELOG.md `[Unreleased]` under `Changed` with the v0.6.1 fix narrative. Re-run THE GOAL TEST against real pgvector to confirm no regression.

#### Files to edit

```
CHANGELOG.md                                                       — [Unreleased] Changed: v0.6.1 fix entry
.claude/knowledge-base/reviews/voyager-skill-library-review-{date}.md  (NEW from re-run)
```

#### Tasks

1. Run `npm test && npm run typecheck && npm run lint && npm run test:integration`
2. Run `/review voyager-skill-library`
3. Confirm `/review` verdict = `READY_TO_MERGE` (or document why a remaining MAJOR is accepted-risk via ADR)
4. Append `Changed` entry to CHANGELOG.md
5. Verify THE GOAL TEST `tests/integration/skills/consolidate-two-skills.test.ts` still green

#### Acceptance Criteria

- [ ] `/review` re-run report exists at `.claude/knowledge-base/reviews/voyager-skill-library-review-{new-date}.md`
- [ ] Verdict: `READY_TO_MERGE` (or `READY_TO_MERGE_WITH_CAVEATS` with documented accepted-risk for remaining items)
- [ ] CHANGELOG.md `Changed` entry present
- [ ] All quality gates pass

#### DoD

- [ ] All Phase 0-5 DoDs satisfied
- [ ] `/review` re-run achieves CRITICAL=0 AND MAJOR=0 (or each remaining MAJOR has ADR-dismissal in the report)
- [ ] CHANGELOG updated
- [ ] GOAL TEST green
- [ ] PR ready for human review

---

## Coverage Matrix

Every original Sub-goal maps to at least one task:

| # | Sub-goal | Task(s) | Resolution |
|---|---|---|---|
| 1 | F2 — drop wrong EmptyScopeError | T0.1 | 1-line deletion + RED test |
| 2 | F1 — code/codeLanguage nullable + null for derived | T0.2 | Type relax + ADR-D2 + JSDoc + GOAL TEST extension |
| 3 | F3 — split pgvector-store | T3.1 | New pgvector-skill-store.ts + composition |
| 4 | F4 — drop dead get + embedBatch | T2.1 | Phase 1 Orient refactor |
| 5 | F5 — iterate all drafts | T2.2 | Phase 3 loop |
| 6 | F6 + F7 — hashFact everywhere | T1.1 + T1.2 | Replace timestamp + manual MD5 |
| 7 | F8 — delete dead barrel | T3.2 | File deletion |
| 8 | F9 — decodeSkillPayload helper | T3.3 | Extract DRY |
| 9 | F10 — forget() history event | T4.1 | Delegate to LocalMemory.forget |
| 10 | MINOR bundle | T5.1 + T5.2 + T5.3 | ADR + rules promotion + JSDoc bundle |
| 11 | /review re-run | T6.1 | Re-run + verify verdict transition |
| 12 | CHANGELOG entry | T6.1 | Single Changed row per Inquebrável Rule 6 |
| **13 (v1.1)** | **EC-1 — decodeSkillPayload accepts NULL codeLanguage when kind='skill'** | **T3.3 (extended)** | **Predicate relaxed; 2 new tests cover NULL + undefined paths; cross-task dep with T0.2 explicit** |
| **14 (v1.1)** | **EC-2 — forget() enforces scope isolation (kind='skill' + agent_id === repoId)** | **T4.1 (extended)** | **Pre-delegate fetch + scope check; throws MemoryNotFound on mismatch; 2 new tests (cross-scope + non-skill)** |

**Coverage: 14/14 sub-goals covered (100%)**

## Dependencies

Existing TheMemory deps (v0.4a baseline + v0.6):
- `drizzle-orm@^0.45.0`, `pg@^8.13.0`, `zod@^3.25.0`, `croner@^10.0.1`
- v0.6 added NO new deps (per voyager-skill-library plan)

NEW deps required: **NONE**. The fixes are all refactors + type relaxations + new test files that reuse existing testing infra.

REMOVED deps: **NONE**.

## Global Definition of Done

- [ ] All 5 phases completed (T0.1 → T6.1)
- [ ] All tests passing — `npm test` (contract + type-d) AND `npm run test:integration` (incl. GOAL TEST)
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected per `architecture.md § Module hygiene`:
  - `pgvector-store.ts` ≤ 500 LoC (target ~470 post T3.1)
  - `pgvector-skill-store.ts` ≤ 300 LoC (NEW)
  - `consolidate.ts` ≤ 500 LoC (current 460; post-changes ≤ 480)
  - `payload.ts` ≤ 150 LoC (NEW)
- [ ] CHANGELOG.md `[Unreleased]` updated under `Changed` (Inquebrável Rule 6)
- [ ] Backward compatibility preserved on `SkillDraft` (still required-non-null `code`); `Skill` interface change is type-level breaking but documented
- [ ] `/review voyager-skill-library` re-run returns CRITICAL=0 AND MAJOR=0
- [ ] Plan-specific criteria:
  - [ ] THE GOAL TEST stays green (with extended `code === null` assertion)
  - [ ] All 4 EC absorptions from v0.6 remain verified (EC-1 / EC-2 / EC-3 / EC-4)
  - [ ] No new EC-N absorptions needed (this plan closes /review findings, not edge cases)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has merged, move `.claude/knowledge-base/plans/voyager-skill-library-fixes-v0-6-1-plan.md` to `.claude/knowledge-base/plans/completed/`.

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER all implementation phases T0-T5 complete. Plan NOT done until the full chain passes.

### Execution

```
npm run compose:up                            # start pgvector container
npm run db:push                                # apply migrations (no schema changes in this plan; sanity)
npm test                                       # contract suite (target ~478 passing post-T0.2 + T1.x + T3.3 test additions)
npm run test:integration                       # integration tier (GOAL TEST stays green; pgvector conformance stays green)
npm run typecheck                              # zero TS errors
npm run lint                                   # zero lint warnings
/review voyager-skill-library                  # consolidated review re-run; expect READY_TO_MERGE
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Coverage ≥ 90% on changed files; 100% on critical paths (consolidate.ts, scoped-skill-memory.ts, pgvector-skill-store.ts, payload.ts)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] `/review voyager-skill-library` returns CRITICAL=0 AND MAJOR=0 (or each remaining item has ADR-dismissal in the report)
- [ ] CHANGELOG.md updated
- [ ] PR description references this plan + the closing `/review` report

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures before declaring the plan complete
3. Re-run the validation chain
4. Pre-existing issues are logged in `voyager-skill-library-followups.md` (already exists)
