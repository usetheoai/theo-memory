# Review: voyager-skill-library

**Date:** 2026-05-30
**Reviewers (spawned agents):** 7 — architecture, tests, wiring, cross-validation, domain-pgvector-schema, domain-memory-layer, domain-db-migrations
**Findings:** 41 total (after dedup across agents) — **BLOCKER: 0 · CRITICAL: 2 · MAJOR: 8 · MINOR: 13 · INFO: 18**
**Verdict:** **NEEDS_FIXES** — 2 CRITICAL findings block merge per cycle-review.md § Hard gates; loop back to `/implement` to address (or dismiss with ADR rationale).

---

## BLOCKER findings (must fix before merge)

(none)

## CRITICAL findings — must address before merge OR dismiss with ADR

### F1: Derived-skill `code` field holds LLM prose, not executable code

- **Severity:** CRITICAL
- **Found by:** architecture (F-arch-1), domain-memory-layer (F-dom-mem-4)
- **File:** `src/local/skills/consolidate.ts:401-426` (Phase 3)
- **Plan reference:** ADR D2 ("Code-as-skill payload as primary representation"); plan T3.1 Deep Dives
- **Summary:** Phase 3 of `consolidate()` assigns `code = description = draft.text` for the derived skill. The LLM-merged text (a natural-language description) ends up in the `code` column labeled `codeLanguage: 'typescript'`. A `TheoCode` consumer executing the recall result runs prose as TypeScript. The orchestrator's inline comment ("LLM produces a single merged text; code = description until v0.6.1 expands the draft shape") acknowledges the gap but the plan does NOT carry an accepted-risk row, and **the Goal-metric test does not exercise the `code` field** — it asserts only `derivedFrom`, masking the regression.
- **Evidence:**
  ```ts
  // consolidate.ts:419-422
  code: description,           // ← LLM prose written to code column
  description,
  codeLanguage: 'typescript',  // ← claimed executable, isn't
  ```
- **Recommended action:** either (a) extend the LLM extraction draft shape to return `{code, description}` separately + adjust the reflection prompt + validateProvenance signature + Phase 3 mapping; OR (b) add an explicit ADR-style accepted-risk note to the plan + JSDoc + dogfood-blocked annotation; OR (c) defer consolidation-with-execution to v0.6.1 and document `code` as "LLM-merged narrative — NOT executable" in v0.6.

### F2: `LocalScopedSkillMemory.add()` throws the wrong error class for empty description

- **Severity:** CRITICAL
- **Found by:** architecture (F-arch-3), wiring (F-wire-1), domain-memory-layer (F-dom-mem-1)
- **File:** `src/local/scoped-skill-memory.ts:117`
- **Plan reference:** T4.1 Acceptance Criteria ("empty repoId throws EmptyScopeError"); T2.1 `InvalidSkillError` contract
- **Summary:** When `draft.description` is empty, `add()` throws `EmptyScopeError` — a class whose message is "Scope is empty: at least one of userId / sessionId / agentId must be non-empty. All-NULL scopes cannot be persisted in reflection_counters per the table CHECK constraint." This is the reflection-counters contract, completely unrelated to a skill's empty description. The correct error already exists: `InvalidSkillError('empty-description', ...)` — and the **store layer correctly throws it**, so the early-throw in the façade is both wrong-typed AND dead code.
- **Evidence:**
  ```ts
  // scoped-skill-memory.ts:116-118
  if (draft.description.trim().length === 0) {
    throw new EmptyScopeError();  // ← wrong class; message is about scope keys
  }
  ```
- **Recommended action:** delete the early throw entirely (store-layer `assertSkillArgs` already rejects with `InvalidSkillError('empty-description', ...)`) OR replace with `throw new InvalidSkillError('empty-description', '...')`. Either path fixes the API contract; deleting is cleanest.

---

## MAJOR findings — surface to human; accept WITH_CAVEATS in PR OR fix

### F3: `src/local/pgvector-store.ts` exceeds 500 LoC budget (734 LoC; 47% over)

- **Severity:** MAJOR
- **Found by:** architecture (F-arch-2)
- **File:** `src/local/pgvector-store.ts` (734 LoC total)
- **Plan reference:** T2.1 Acceptance Criteria: "pgvector-store.ts still ≤ 500 LoC (or split into a `pgvector-skill-store.ts` sibling if budget exceeded)"
- **Summary:** Plan literally lists the split fallback as an acceptance criterion; the split never happened. `architecture.md § Module hygiene` budget is 500.
- **Recommended action:** extract skill-specific methods (`insertSkill`, `insertDerivedSkill`, `markSuperseded`, `insertDerivedSkillAtomic`, `assertSkillArgs`) to `src/local/pgvector-skill-store.ts`; main file delegates via composition.

### F4: Orient phase N+1 dead `get()` + sequential `embed()` loop bypasses `embedBatch`

- **Severity:** MAJOR
- **Found by:** architecture (F-arch-4), domain-memory-layer (F-dom-mem-2), wiring (F-wire-2 MINOR)
- **File:** `src/local/skills/consolidate.ts:322` (the `get()` call) + the per-row `embed()` loop
- **Summary:** Orient phase iterates `list()` rows; for each row, calls `vectorStore.get(row.id)` (dead — only used to test non-null, impossible because the row came from `list()`) AND calls `embedder.embed(skill.description)` sequentially. At the 500-skill page-size cap that's 500 wasted SQL round-trips + 500 sequential LLM/HTTP calls. `embedBatch` exists on the Embedder DIP for this exact case.
- **Recommended action:** delete the dead `get()` call; replace per-row `embed()` with a single `embedBatch(descriptions)` call.

### F5: Phase 3 silently drops `drafts[1..]` (v0.4a `reflect` iterates all drafts)

- **Severity:** MAJOR
- **Found by:** architecture (F-arch-5)
- **File:** `src/local/skills/consolidate.ts:351-360`
- **Summary:** v0.4a `LocalScopedMemory.reflect()` iterates `for (const draft of drafts)`. v0.6 `consolidate()` uses only `drafts[0]` for each cluster, silently discarding the rest. No ADR justifies the regression; no test exercises the multi-draft path. If the LLM proposes 2 merged skills for the same cluster, only one survives.
- **Recommended action:** either iterate all drafts (mirror v0.4a) OR add an explicit ADR + plan-level accepted-risk row + a unit test that locks single-draft-per-cluster behavior.

### F6: Derived-skill `hash` uses `Date.now() + Math.random()` — non-deterministic; breaks dedup invariant

- **Severity:** MAJOR
- **Found by:** architecture (F-arch-6)
- **File:** `src/local/skills/consolidate.ts:408`
- **Summary:** `architecture.md § 4` mandates content-derived hash for dedup. The `hashFact` helper from `src/core/dedup.ts` is the canonical MD5. Using `Date.now()+Math.random()` means running `consolidate()` twice on identical clusters produces two distinct rows that pass the UNIQUE-hash index by accident, breaking idempotency. The EC-3 invariant (no double-consolidation) holds only because the supersession filter excludes the first derived row, masking the hash regression.
- **Recommended action:** use `hashFact(draft.text)` or `hashFact(sortedSourceIds.join('|') + '|' + draft.text)`.

### F7: `LocalScopedSkillMemory.add()` uses MD5 over `code|description` instead of `hashFact()`

- **Severity:** MAJOR (related to F6 but distinct site)
- **Found by:** architecture (similar to F-arch-6)
- **File:** `src/local/scoped-skill-memory.ts:121`
- **Summary:** `add()` computes hash as `createHash('md5').update(draft.code).update('|').update(draft.description)`. Inconsistent with the project's canonical `hashFact()` (which does MD5 of normalized text). Two skills with whitespace variations in description produce different hashes when they shouldn't.
- **Recommended action:** use `hashFact(draft.description)` (the embedding target IS the dedup target) OR document the divergence rationale.

### F8: `src/local/skills/index.ts` is a dead barrel (`consolidate` never re-exported through any used path)

- **Severity:** MAJOR
- **Found by:** wiring (F-wire-3)
- **File:** `src/local/skills/index.ts`
- **Summary:** The barrel exports `consolidate` + `ConsolidateDeps`. No in-project caller imports through `src/local/skills/index.js`. `LocalScopedSkillMemory.consolidate` imports directly from `./skills/consolidate.js`. The barrel is unused.
- **Recommended action:** either delete `src/local/skills/index.ts` OR import through it from `LocalScopedSkillMemory` AND re-export the orchestrator types from the public barrel so external consumers can extend it.

### F9: `payloadToSkill` (scoped-skill-memory.ts:48) + `rowToSkill` (consolidate.ts:240) duplicate decoding knowledge

- **Severity:** MAJOR
- **Found by:** domain-memory-layer (F-dom-mem-3)
- **File:** `src/local/scoped-skill-memory.ts:48` + `src/local/skills/consolidate.ts:240`
- **Summary:** Both functions duplicate (a) `kind` discriminator check, (b) `codeLanguage` narrowing to `'typescript' | 'javascript'`, (c) `derived_from` `JSON.parse` with try/catch. Rule-of-three not yet hit (two sites) but the knowledge is identical AND likely to be needed by a future cloud-runtime adapter — extract proactively.
- **Recommended action:** extract `decodeSkillPayload(payload, scope, score?)` to `src/local/skills/payload.ts`; both call sites delegate.

### F10: `forget()` JSDoc contradicts impl + skips history-table write that `LocalMemory.forget` does

- **Severity:** MAJOR
- **Found by:** domain-memory-layer (F-dom-mem-5)
- **File:** `src/core/skill.ts:147` (JSDoc) + `src/local/scoped-skill-memory.ts:193` (impl)
- **Summary:** JSDoc says "soft-delete via supersession-by-self OR bi-temporal `tInvalid`"; impl hard-deletes via `store.delete(id)`. Also: `LocalMemory.forget` writes a `FORGET` event to the history table; `ScopedSkillMemory.forget` does not — breaks the audit trail for skill DELETE events at scale.
- **Recommended action:** align JSDoc with hard-delete impl (or implement soft-delete); ALSO write a `FORGET` history event mirroring `LocalMemory.forget`.

---

## MINOR findings (13 — non-blocking; see findings YAML files for details)

- **F-arch-7 / F-dom-mem-6** — `RepoScope` adds a 4th tier; `architecture.md § 1` says "Never introduce a fourth tier without a strategic review." No strategic-review trail recorded — recommend adding ADR-0010 documenting the v0.6 four-tier expansion + the user/session/agent locked three-tier framing in CLAUDE.md.
- **F-arch-8** — `LocalMemory.skills()` casts VectorStore via `as ... & VectorStoreWithSkillInsert` without runtime guard; symmetric with v0.4a `VectorStoreWithDerivedInsert` pattern.
- **F-arch-9** — `rowToSkill` synthesizes `createdAt`/`updatedAt`/`tValid` instead of reading from the row (pre-existing v0.4a defect, amplified at v0.6).
- **F-arch-10** — `'code' | 'nl-spec'` divergence from plan T1.2's `'voyager' | 'procmem'` cites a "no-paper-names-in-code policy" that does not exist in `.claude/rules/` (lives only in session memory `no_paper_names_in_code.md`). Recommend promoting to `.claude/rules/` or referencing the session memory path in the JSDoc.
- **F-tests-1** (`scoped-skill-memory.test.ts:66`), **F-tests-2** (`recall-filters.test.ts:115`) — test names contain "and" (testing.md § Anti-patterns); both describe single behaviors — cosmetic.
- **F-tests-3** — `fixtures/two-similar-skills.ts:28,44` both share byte-identical description (load-bearing invariant for deterministic embedder threshold) — add guard comment.
- **F-tests-4** — `scope.test-d.ts:44` EC-4 absorption isn't tagged with inline `EC-4` comment marker (audit-trail nit only).
- **F-dom-pgvec-11** — `insertDerivedMemory` (v0.4a path) shadows module-level `vectorLiteral` without NaN/Infinity guard (v0.6 paths route through guarded function correctly).
- **F-dom-pgvec-12** — Store-internal `Filters.excludeSuperseded` inverts polarity from API-surface `includeSuperseded` (intentional, undocumented; recommend bridging JSDoc).
- **F-xval-1** — `consolidate.ts` at 468 LoC vs plan's 250 target (under architecture.md 500 hard cap; acknowledged in commit body).
- **F-dom-mig-9** — No down-migration files in project (LOW; consistent with 0000/0001/0002; document forward-only convention once).

---

## INFO findings (18 — clean absorptions)

- EC-1 (constraint name verbatim) — honored
- EC-2 (atomic INSERT+UPDATE via withTransaction) — honored on pgvector; in-memory documented best-effort
- EC-3 (filter parity onlySkills+includeSuperseded on both RecallOptions+GetAllOptions) — honored
- EC-4 (4 switch sites on Scope.kind) — all absorbed
- Deliberate T2.1 DIP divergence (skill methods OFF VectorStore DIP) — sound AND documented
- ADR D1 / D2 / D3 / D4 / D5 — all 5 honored
- 4-verb ScopedSkillMemory parity (no reflect exposed) — correct
- ADD-only invariant (Rule 3) — preserved
- HNSW index survives schema extension
- Self-FK ON DELETE SET NULL — proper audit-trail invariant
- Goal metric observable — verified

---

## Edge-case coverage report (deterministic)

`edge_case_coverage.py` extracted 37 edge-case mentions from the plan via keyword scan + matched against `tests/`:

- **Covered (script-judged):** 1/37 (2.7%)
- **Missing (script-judged):** 36/37

**Caveat:** The script's keyword matching is brittle — multiple "missing" entries ARE covered semantically in `src/local/__tests__/` or `tests/integration/` but the script doesn't cross src/ unit tests. Example: "description empty → reject with `InvalidSkillError`" IS covered at `vector-store-conformance.ts:236` (in-memory tier + pgvector tier transitively). Recommend human spot-check before treating this as authoritative.

**Genuinely uncovered edge cases worth tracking (sample):**
- "a skill is its own supersedor (sanity check — would mean a circular FK; reject at insert)" — no test asserts the rejection
- "v0.4a-only database (no skill rows) — migration is a pure schema extension" — covered transitively by GOAL TEST seeding fresh container, but not asserted directly

---

## Cross-validation summary

- Plan tasks: 9 (T0.1 → T5.1)
- Fully implemented: 9 ✓
- Partially: 0
- Missing: 0
- Diverged (documented in code): 3 (T1.2 discriminator names; T2.1 DIP placement; T5.1 scope-mapping bug+fix — all with inline rationale in JSDoc or commit body)
- Acceptance Criteria checkboxes met: 9/9
- DoD checkboxes met: 9/9
- ADRs (D1–D5) honored: 5/5
- Coverage Matrix: 10/10 honored end-to-end
- Goal metric observable in `tests/integration/skills/consolidate-two-skills.test.ts:135-137`

---

## Quality gates summary

- `npm test`: PASS — 468 passed, 2 skipped, 0 type errors
- `npm run typecheck`: PASS — 0 errors
- `npm run lint`: PASS — 0 warnings
- `npm run test:integration`: PASS for THE GOAL TEST + 67 other integration tests; 2 pre-existing failures logged in followups (verified against develop HEAD, NOT v0.6 regressions)
- Wiring triad aggregation: pillar (a) 11/11 functional callers; pillar (b) 11/11 transitive PASS (script under-reports indirection); pillar (c) vacuous per plan declaration

---

## Spawned agents (audit trail — PERSISTED for 30 days per audit-trail-rotation.md)

- `.claude/agents/review-voyager-skill-library-2026-05-30/architecture.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30/tests.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30/wiring.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30/cross-validation.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30/domain-pgvector-schema.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30/domain-memory-layer.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30/domain-db-migrations.md`

Per-agent findings (YAML) under `.claude/agents/review-voyager-skill-library-2026-05-30/findings/`.

---

## Handoff decision

**VERDICT: NEEDS_FIXES**

**Rationale:** 0 BLOCKER but 2 CRITICAL findings present. Per `cycle-review.md § Hard gates`, CRITICAL HALTs merge unless explicitly dismissed with ADR-style rationale in this report. Neither CRITICAL is security-related (so the secondary BLOCKER-treatment escalation does not apply), but both deserve a real fix before v0.6 PR opens:

- **F1** (`code = description` semantic gap) — either fix Phase 3 to preserve executable code OR add explicit accepted-risk note to plan + JSDoc + dogfood-blocked annotation. Without one of those, v0.6 ships a method whose name lies (`codeLanguage: 'typescript'` on prose).
- **F2** (wrong error class in `add()`) — trivial fix (delete the early throw OR swap error class). 1-line change.

**Next steps:**
1. Loop back to `/implement` for the 2 CRITICAL fixes (likely 1 iteration each, < 30 minutes total).
2. Address as many of the 8 MAJOR findings as feasible in the same loop-back — most are 1-5 line edits. F3 (LoC budget) is the biggest at ~150 LoC moved into a sibling file.
3. Open PR with WITH_CAVEATS notes for any MAJOR not fixed; MINOR/INFO findings flow into follow-up issues OR `voyager-skill-library-followups.md`.
4. Re-run `/review voyager-skill-library` once /implement loop completes to verify CRITICAL count = 0.
5. **NO merge until CRITICAL count = 0 OR each remaining CRITICAL carries explicit ADR-style dismissal in this report appendix.**

**`/dogfood` status (cross-reference):** `EVIDENCE_INSUFFICIENT` — anchor scenario S1 not yet `running`. v0.6 ships no production-ready claim, so dogfood gate does not block merge; it only blocks future v1.0 promotion.

---

## Appendix — files reviewed (diff vs `develop`)

10 commits, 32 files changed across `src/core/`, `src/local/`, `tests/integration/skills/`, `CHANGELOG.md`. Full diff: `git diff develop..HEAD --stat`.
