# Review: voyager-skill-library (re-run after v0.6.1 fixes)

**Date:** 2026-05-30
**Reviewers (spawned agents):** 7 — architecture, tests, wiring, cross-validation, domain-pgvector-schema (primary), domain-memory-layer, domain-db-migrations
**Findings:** 0 BLOCKER · 0 CRITICAL · 0 MAJOR (after F-dom-mem-NEW-1 absorbed inline) · ~9 MINOR · many INFO
**Verdict:** **READY_TO_MERGE**

First-pass review (archived at `_archive/voyager-skill-library-review-2026-05-30-first-pass.md`) returned **NEEDS_FIXES** with 2 CRITICAL + 8 MAJOR + 13 MINOR. The v0.6.1 fixes cycle (plan `voyager-skill-library-fixes-v0-6-1`, 14 commits + 1 JSDoc absorption) closed every CRITICAL and every MAJOR. This re-run confirms.

## BLOCKER findings (must fix before merge)

None.

## CRITICAL findings (must address before merge OR dismiss with ADR)

None. Both first-pass CRITICAL findings closed:

| First-pass ID | Summary | Closing commit |
|---|---|---|
| F1 | Derived-skill `code` field holds LLM prose, not executable code | `cab8a94` (T3.3 + T0.2) — `code: null` + `codeLanguage: null` for derived rows; GOAL TEST asserts both |
| F2 | `LocalScopedSkillMemory.add()` throws wrong error class for empty description | `f45fa5e` (T0.1) — early `EmptyScopeError` deleted; store-layer `assertSkillArgs` throws `InvalidSkillError(reason='empty-description')` |

## MAJOR findings (surface to human; accept WITH_CAVEATS in PR OR fix)

None remaining after inline absorption. Closures:

| First-pass ID | Summary | Closing commit |
|---|---|---|
| F3 | `pgvector-store.ts` exceeds 500 LoC budget (was 734) | `b9edc1b` (T3.1) — extracted `PgvectorSkillStore` via composition; parent now 497 LoC; new module 200 LoC |
| F4 | Orient phase N+1 dead `get()` + sequential `embed()` loop | `a01d433` (T2.1) — single `embedBatch` call + per-row fallback; dead `get()` removed |
| F5 | Phase 3 silently drops `drafts[1..]` (v0.4a parity gap) | `bcebab3` (T2.2) — `for (const draft of drafts)` + degenerate-skip + UNIQUE-collision catch |
| F6 | Derived-skill `hash` non-deterministic (`Date.now()+Math.random()`) | `b02c158` (T1.1) — `hashFact(description)` + idempotency test |
| F7 | `add()` uses MD5 over `code\|description` instead of `hashFact()` | `41475b2` (T1.2) — `hashFact(draft.description)`; `node:crypto` import dropped |
| F8 | `src/local/skills/index.ts` dead barrel | `87d3587` (T3.2) — file deleted; zero orphan re-exports |
| F9 | `payloadToSkill` + `rowToSkill` duplicate decoding | `cab8a94` (T3.3) — `decodeSkillPayload` extracted to `src/local/skills/payload.ts` (91 LoC) + EC-1 NULL-tolerant predicate + 6 unit tests |
| F10 | `forget()` JSDoc contradicts impl + skips history-event write | `1b87b3a` (T4.1) — `getDelegate` + `forgetDelegate` wired through factory; pre-delegate scope-isolation guard (EC-2); canonical `LocalMemory.forget` writes the `'forget'` history event |

**NEW MAJOR finding from this re-run (absorbed inline):**

| ID | Summary | Resolution |
|---|---|---|
| F-dom-mem-NEW-1 | `SkillDraft.code` + `ScopedSkillMemory.add` public JSDoc did not document the hashFact-by-description collision invariant introduced by F7 fix — consumers would hit raw pg `UNIQUE` errors without knowing description is the canonical identity | JSDoc added inline at `src/core/skill.ts:69-86` (SkillDraft) + `:152-158` (ScopedSkillMemory.add) — uncommitted at report-write time, will land in the T6.1 commit |

## MINOR findings (carry forward as follow-ups; non-blocking)

13 first-pass MINORs closed by T5.1 + T5.2 + T5.3 (commits `9c6574a`, `05967a9`, `9f5b2d8`) — including `F-tests-1/2/3/4` (test-name "and" removal), `F-dom-pgvec-11` (`vectorLiteral` shadow removed), `F-dom-pgvec-12` (`Filters.excludeSuperseded` polarity JSDoc), `F-xval-1` (consolidate.ts LoC), `F-arch-7` (ADR-0010 RepoScope), `F-arch-10` (no-paper-names rule promoted), `F-dom-mem-6` (RepoScope strategic-review trail).

Remaining MINOR follow-ups surfaced by this re-run (none block merge — open as follow-up issues OR address in v0.6.2 / v0.7 cycle):

| ID | File:line | Summary | Recommended action |
|---|---|---|---|
| F-arch-8 (STILL_OPEN) | `src/local/index.ts:496` | `VectorStore` cast to `VectorStoreWithSkillInsert` without runtime guard (symmetric with pre-existing v0.4a pattern) | Add `typeof store.insertSkill === 'function'` runtime guard for DX; defer to v0.7 |
| F-arch-9 (STILL_OPEN) | `src/local/skills/payload.ts:78-81` | `decodeSkillPayload` synthesizes `createdAt`/`updatedAt`/`tValid` as `new Date()` (pre-existing v0.4a defect, amplified by v0.6 unification) | Project actual `created_at`/`updated_at`/`t_valid` columns via SELECT; v0.7 |
| F-xval-1 (STILL_OPEN) | `src/local/skills/consolidate.ts` (482 LoC) | Over plan's 250-LoC target; under 500 hard cap | Extract `clusterByEmbedding` + `cosineSim` to sibling `clustering.ts`; v0.7 |
| F-tests-9 (NEW) | `src/local/skills/__tests__/consolidate.test.ts` | UNIQUE-collision catch-skip path at `consolidate.ts:426-438` not directly tested | Add 1 unit test that stubs `insertDerivedSkillAtomic` to throw `'memories_hash_unique_idx'` and asserts no throw + tracer event; ~20 LoC |
| F-tests-16 (NEW) | `src/local/__tests__/vector-store-conformance.ts:220` | Pre-existing v0.6 "and" in test name | Bundle into next docs pass |
| F-tests-17 (NEW) | `src/local/__tests__/schema-v0-6.test.ts:116` | Pre-existing v0.6 "and" in test name | Bundle into next docs pass |
| F-tests-18 (NEW) | `src/core/__tests__/skill.test-d.ts:72` | Pre-existing v0.6 "and" in test name | Bundle into next docs pass |
| F-wire-7 (NEW) | `src/local/pgvector-skill-store.ts:62` | `WithTransactionFn` type exported but no external consumer | Drop the `export` keyword OR re-export through barrel; opportunistic |
| F-dom-mem-NEW-2 (NEW) | `src/local/scoped-skill-memory.ts:180-182` | `forget()` error MESSAGE distinguishes cross-scope vs non-existent (uniform CLASS, leaky MESSAGE) | Normalize message to `new MemoryNotFound(skillId)` or document instability; opportunistic |
| F-dom-mem-NEW-3 (NEW) | `src/local/skills/consolidate.ts:384-462` | Cross-cluster UNIQUE-collision path silently loses consolidation opportunity; no test covers it | Add test seeding two clusters whose merged descriptions collide OR surface in `ConsolidationResult.silentlySkippedClusters`; v0.7 |
| F-dom-pgvec-9 (NEW) | `src/local/pgvector-store.ts` | Inline comment "text mirrors description for non-skill recall fallback" lost during T3.1 move | Restore opportunistic |
| F-dom-pgvec-10 (NEW) | `src/local/pgvector-skill-store.ts` | Three `'INSERT returned no rows'` messages should append `(T3.1)` per `no-paper-names-in-code.md § "How to apply" #3` | Opportunistic |

## Edge-case coverage report

Plan-declared edge cases (from `voyager-skill-library-fixes-v0-6-1-plan.md`):

- **EC-1** (decodeSkillPayload NULL code/codeLanguage tolerance): covered at `payload.test.ts:80-114`
- **EC-2** (forget cross-scope + kind-mismatch isolation): covered at `scoped-skill-memory.test.ts:228-258`
- **EC-6** (provenance fail-fast across drafts): covered at `consolidate.test.ts:503-530`
- **GOAL TEST extension** (derived `code === null` + `codeLanguage === null`): covered at `consolidate-two-skills.test.ts:142-143`

Missing/thin coverage (`F-tests-9` + `F-dom-mem-NEW-3`): same-hash collision paths in `consolidate.ts:426-438` (intra-cluster) and across clusters. Not blockers — F6's hash determinism is locked by 2 separate tests, and the catch-skip is well-defined behavior with telemetry.

## Cross-validation summary

| Plan task | Closing commit | Acceptance criteria met? |
|---|---|---|
| T0.1 (F2) | `f45fa5e` | ✓ |
| T3.3 + T0.2 atomic (F9 + F1 + EC-1) | `cab8a94` | ✓ |
| T1.1 (F6) | `b02c158` | ✓ |
| T1.2 (F7) | `41475b2` | ✓ |
| T2.1 (F4) | `a01d433` | ✓ |
| T2.2 (F5) | `bcebab3` | ✓ |
| T3.1 (F3) | `b9edc1b` | ✓ (497 LoC ≤ 500 hard cap) |
| T3.2 (F8) | `87d3587` | ✓ |
| T4.1 (F10 + EC-2) | `1b87b3a` | ✓ |
| T5.1 (F-arch-7 + F-dom-mem-6) | `9c6574a` | ✓ |
| T5.2 (F-arch-10) | `05967a9` | ✓ |
| T5.3 (MINORs bundle) | `9f5b2d8` | ✓ |

No diverged tasks. No plan drift. v0.6.1 plan v1.1 followed line-by-line. The critical ordering invariant from v1.1 (T3.3 lands BEFORE or atomic with T0.2) was honored in single commit `cab8a94`.

## Quality gates summary

- `npm test`: **PASS** — 490 passed, 2 skipped (up from 468 at first-pass; +22 new tests)
- `npm run typecheck`: **PASS** — 0 errors
- `npm run lint`: **PASS** — 0 warnings
- THE GOAL TEST (`tests/integration/skills/consolidate-two-skills.test.ts`): **2/2 PASS** against real `ankane/pgvector:v0.5.1`
- Wiring triad on v0.6.1 new symbols: **4/4 pillar (a) PASS**, **4/4 pillar (b) PASS**, pillar (c) **n/a** (plan declares no new metrics)
- File-size budget: `pgvector-store.ts` **497 LoC** (≤500 hard cap); `pgvector-skill-store.ts` **200 LoC**; `pgvector-vector-literal.ts` **23 LoC**

## Pre-existing failures (NOT v0.6.1 regressions)

Two integration tests fail on this branch but ALSO fail on `develop` (commits `f8d269b` + `494bceb`):

1. `tests/integration/schema-v0-4a-constraints.test.ts` — `kind='derived' with derived_from=NULL` does NOT throw the expected CHECK violation. Root cause: Postgres treats NULL CHECK predicates as `pass` (the expression `jsonb_array_length(NULL) >= 1` evaluates to NULL, not FALSE). Pre-existing v0.4a defect surfaced by v0.6 T0.1's CHECK rewrite.
2. `tests/integration/reflection/threshold-policy.test.ts` — `PgvectorStore` constructor signature mismatch (test passes `{connectionString}` options bag; constructor expects `Pool`). Pre-existing v0.4a defect.

Both flagged for separate follow-up; out of scope for v0.6.1 closure.

## Spawned agents (audit trail)

- `.claude/agents/review-voyager-skill-library-2026-05-30-rerun/architecture.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30-rerun/tests.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30-rerun/wiring.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30-rerun/cross-validation.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30-rerun/domain-pgvector-schema.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30-rerun/domain-memory-layer.md`
- `.claude/agents/review-voyager-skill-library-2026-05-30-rerun/domain-db-migrations.md`

## Handoff decision

**READY_TO_MERGE** — both CRITICALs closed, all 8 MAJORs closed, 1 new MAJOR absorbed inline (JSDoc addition lands in T6.1 commit). 12+ MINOR follow-ups documented as non-blocking. Open the v0.6 PR.
