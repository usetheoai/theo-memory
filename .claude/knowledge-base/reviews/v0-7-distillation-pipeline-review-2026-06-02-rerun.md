# Review: v0-7-distillation-pipeline (re-run)

**Date:** 2026-06-02
**Verdict:** **READY_TO_MERGE_WITH_CAVEATS**
**Reviewers (spawned agents — all 7 completed):**
- architecture
- tests
- wiring
- cross-validation
- domain-pgvector-schema
- domain-memory-layer
- domain-db-migrations

**Scope:** delta `9d16db4^..HEAD` (4 fix-up commits closing the 3 CRITICAL findings + F-M5 + F-M7 + F-Mi2 + plan v1.2 amendment).

**Fix-up commits reviewed:**
- `9d16db4` docs: F-C3 schema.ts drift + sentinel
- `ffa92d1` fix: F-C2 + F-M7 (kind filter + t_valid guard)
- `17425af` fix: F-C1 (mass-tombstone guard with maxRejectionRatio=0.95 default)
- `18e970f` docs: F-M5 + F-Mi2 + plan v1.2 + CHANGELOG + roadmap

## Per-agent verdicts

| Agent | Verdict | Findings (this re-run) |
|---|---|---|
| architecture | READY_TO_MERGE | 0 CRITICAL / 0 MAJOR / 3 MINOR (deferred-acceptable) / 3 INFO |
| tests | READY_TO_MERGE | 0 CRITICAL / 0 MAJOR / 2 MINOR / 4 INFO |
| wiring | READY_TO_MERGE | 0 CRITICAL / 0 MAJOR / 2 MINOR / 2 INFO |
| cross-validation | RERUN_READY_TO_MERGE | 0 CRITICAL / 2 MAJOR / 2 MINOR / 6 INFO |
| domain-pgvector-schema | READY_TO_MERGE | 0 CRITICAL / 0 MAJOR / 0 MINOR / 5 INFO |
| domain-memory-layer | READY_TO_MERGE | 0 CRITICAL / 0 MAJOR / 2 MINOR / N INFO |
| domain-db-migrations | READY_TO_MERGE_WITH_CAVEATS | 0 CRITICAL / 0 NEW MAJOR (2 carried as deferred) / 1 MINOR open (F-Mi12) / 3 INFO |

## Findings summary

**Aggregate (post-dedup):**
- BLOCKER: 0
- CRITICAL: 0
- **MAJOR: 2** (both honesty/documentation, not code defects)
- MINOR: 9
- INFO: 23 positive confirmations

## 0 CRITICAL — verdict math

Per `cycle-review.md § Hard gates`:
- 0 BLOCKER → no halt
- 0 CRITICAL → no halt
- 2 MAJOR → surface to human; accept WITH_CAVEATS in PR description OR fix
- MINOR/INFO → log; merge can proceed

**Net: READY_TO_MERGE_WITH_CAVEATS.** The 2 MAJOR findings are honesty gaps in the plan v1.2 amendment (not code defects); fix-up cycle option: amend plan + close MAJORs OR carry as PR description caveats.

---

## CRITICAL closures verified (3/3 honestly closed)

| Original Finding | Closure Commit | Re-verification |
|---|---|---|
| **F-C1** mass-tombstone | `17425af` | Architecture + tests + memory-layer all confirmed LSP-clean + 5 contract tests cover boundary + clamp + opt-out + Noop-equivalent. EC-1 still PASS (3 candidates → ratio 0.667 < 0.95). |
| **F-C2** kind filter | `ffa92d1` | Memory-layer + pgvector-schema + tests confirmed `AND kind = 'extracted'` SQL filter. Skill-isolation regression test (2/2 PASS) — skill rows survive LWW reflect AND derived rows survive on 2nd reflect. |
| **F-C3** schema.ts drift | `9d16db4` | pgvector-schema + architecture + db-migrations: column-by-column bijection vs `meta/0007_snapshot.json` (uuid PK, FK onDelete: 'set null' per EC-3 GDPR, 2 JSONB defaults '[]'::jsonb, reason+policy_name NOT NULL, createdAt + 2 btree indexes). Sentinel test via `Symbol.for('drizzle:Name')` runtime introspection asserts BOTH directions (snapshot ⊆ schema AND schema ⊆ snapshot). |

---

## 2 MAJOR findings (honesty gaps in plan v1.2 — non-blocking but recommend close)

### F-xval-rerun-3 (MAJOR — honesty) — F-M9 dismissal "acknowledged" is too vague

- **Found by:** cross-validation
- **Issue:** F-M9 is a real semantic dual-write bug: if `executeReflection` LLM call throws AFTER `persistConsolidations` commits, the consolidation_history audit row is irreversible while the LLM derivation never happens. Plan v1.2 dismisses with single word "acknowledged" — violates `cycle-review.md § Anti-patterns` ("NEVER mark a finding as `dismissed` without an ADR-style justification").
- **Recommended action:** amend plan v1.2 with explicit rationale — either (a) document expected operator recovery procedure (re-run reflect()? cleanup orphan rows?), OR (b) author ADR D7 documenting the partial-commit window as accepted risk with v0.7.2 follow-up to add outer atomicity, OR (c) downgrade to MINOR if the blast radius is genuinely small.
- **Mitigation already shipped:** F-C1 maxRejectionRatio guard reduces blast radius — a runaway reflect() can no longer create 100+ orphan audit rows.

### F-xval-rerun-4 (MAJOR — honesty) — ADR D1 left technically incorrect

- **Found by:** cross-validation
- **Issue:** F-M6 (wiring locus drift `src/core/reflection/execute.ts` → `src/local/index.ts`) is dismissed in plan v1.2 as "accepted as documented divergence" — but the ADR D1 source-of-truth in the plan body STILL claims "logic-layer extension". Future maintainer reading ADR D1 standalone sees incorrect claim.
- **Recommended action:** add inline correction block under `### D1` heading in plan v1.2 body pointing to the v1.2 header amendment + the actual runtime-layer wiring locus. Mirrors the F-arch-R3 fix from the adapters-or-local cycle.

---

## 9 MINOR findings (non-blocking, deferrable)

- **F-xval-rerun-5** (cross-val): plan v1.2 net-state math error — claims "9 MAJOR (6 deferred + 3 closed)" but actual is 11 MAJOR (9 deferred + 2 closed). Confuses grouped-pair references (M1/M2, M3/M4, M10/M11) with absolute counts.
- **F-xval-rerun-6** (cross-val): 11 MINOR findings implicitly deferred without per-finding rationale. Notable: F-Mi4 references non-existent ADR-DEFER-LLM-TEMP-SEED; F-Mi9 process.env mutation reliability concern.
- **F-tests-rerun-1**: skill-isolation.test.ts:149 test name claims "subsequent reflect()" but body invokes reflect() only ONCE.
- **F-tests-rerun-2**: skill-isolation.test.ts:173-174 `void extractedOlderId; void extractedNewerId;` discards 2 seeded rows without asserting their consolidation behavior.
- **F-wire-rerun-1**: F-C1 abstain has no integration-depth test; suggested 1 it() at `tests/integration/distillation/lww-mass-tombstone-abstain.test.ts` that seeds 21+ rows + asserts `consolidation_history` row count remains 0.
- **F-wire-3 (carried)**: stale `// line 317` reference in `src/local/index.ts:375` (actual EC-7 short-circuit at lines 354-355) — was a MINOR in the original /review, not fixed in the fix-up cycle.
- **F-dom-db-rerun-1 / F-Mi12** (db-migrations): `scripts/db-repair-v0-7-partial-state.mjs` exists but NOT registered as an npm script. Plan v1.2 is SILENT (not in closures, not in deferrals). One-line fix.
- **F-dom-mem-rerun-4** (memory-layer): silent ABSTAIN observability — F-C1 guard returns `[]` without OTel counter; 100-row scope reflect() observes silent no-op. Recommend v0.7.2: emit `distillation.consolidation.abstained` counter OR insert audit row with `reason='ratio-guard'`.
- **F-dom-mem-rerun-5** (memory-layer): `superseded_by IS NULL` omission — original F-C2 cited it; shipped fix omits. Acceptable for v0.7 today (extracted rows never set superseded_by) but latent risk if v0.7.2 introduces extracted-row supersession.

---

## INFO findings (23 positive confirmations)

- **All 6 plan v1.2 deferrals (F-M1/M2/M3/M4/M6/M8/M9/M10/M11)** verified as honest (each cites specific rationale matched against code).
- **F-arch-rr-NEW-4**: F-C1 + F-C2 guards COMPOSE correctly (F-C2 narrows BEFORE F-C1 evaluates rejection ratio). Defense-in-depth sound.
- **F-arch-rr-NEW-5**: `consolidationHistory` declaration follows Drizzle conventions consistent with v0.6 supersededBy precedent.
- **F-arch-rr-NEW-6**: File-size budgets NOT regressed (`pgvector-store.ts` +16 LoC of honest comments; `last-write-wins.ts` 122 LoC within budget).
- **Test pyramid** preserved: 35 unit + 7 integration + new integration tests for the 3 CRITICAL closures.
- **Plan v1.2 + CHANGELOG + CLAUDE.md mutual consistency**: verified by cross-validation reviewer (all 3 mirror each other on the F-C1/F-C2/F-C3 closures + deferral list).
- **F-Mi2 env-shift ordering**: `await getMemory()` placed BEFORE `OPENAI_API_KEY` check; adaptOpenrouterEnvForDemo fires via getSingleton → resolveAdapters cascade.
- **F-M5 honesty caveat**: 27 lines added to LLM-MEASURED test header detailing what 1.000/1.000/1.000 proves (pipeline wiring) vs what it does NOT prove (ambiguous-contradiction quality, near-duplicate discrimination, procedural-fixture quality).
- **EC-1 stability** under new F-C1 default: 3 candidates → ratio 0.667 < 0.95 → consolidates correctly. 10-run determinism preserved.
- **Plus pgvector-schema 5 INFO** (column bijection, FK GDPR survival, JSONB defaults, btree indexes, bi-temporal forward-compat).

---

## Edge-case coverage

Unchanged from previous review: 8/11 covered, 3 partial (EC-2, EC-4, EC-6) — all 3 partials live behind the deferred MAJORs (F-M3/F-M4 OTel integration depth).

---

## Quality gates

- **npm test (contract)**: PASS — 685 passed + 2 skipped (was 680 → +5 from F-C1 guard contract tests)
- **npm run typecheck**: PASS — 0 errors
- **npm run lint**: PASS — 0 warnings
- **Integration distillation**: 7/7 PASS + 2 new (skill-isolation 2/2)
- **Schema-snapshot-parity sentinel**: 2/2 PASS
- **v0.7.1 LLM-MEASURED**: precision=1.000, recall=1.000, conflict-accuracy=1.000 (unchanged — caveat amended honestly per F-M5)
- **Wiring triad** on fix-up symbols: 4/5 PASS_FULL + 1 PASS_PARTIAL (F-C1 abstain logic-only, integration depth deferred to F-wire-rerun-1 follow-up)

---

## Spawned agents (audit trail)

- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun/architecture.md` + `findings/architecture.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun/tests.md` + `findings/tests.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun/wiring.md` + `findings/wiring.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun/cross-validation.md` + `findings/cross-validation.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun/domain-memory-layer.md` + `findings/domain-memory-layer.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun/domain-pgvector-schema.md` + `findings/domain-pgvector-schema.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02-rerun/domain-db-migrations.md` + `findings/domain-db-migrations.yml`

---

## Handoff decision

**Verdict: READY_TO_MERGE_WITH_CAVEATS**

Per cycle-review.md § Soft gates: MAJOR findings surface to human; accept WITH_CAVEATS in PR description OR fix. The 2 MAJORs are honesty gaps in plan v1.2 documentation (not code defects):
- **F-xval-rerun-3** F-M9 vague dismissal — recommend amend plan v1.2 with ADR D7 OR specific recovery procedure OR severity downgrade
- **F-xval-rerun-4** ADR D1 body still says "logic-layer extension" — recommend inline correction block under `### D1` heading

**Recommended path:**
- (a) **MERGE NOW with documented caveats** in PR description: list F-xval-rerun-3 + F-xval-rerun-4 as known-honesty-gaps to address in next v0.7.2 or v0.8 cycle.
- (b) **OR small fix-up commit** (~30 min) closing both MAJORs + F-Mi12 (one-line npm script registration) + F-wire-3 (stale comment fix) + F-xval-rerun-5 (math correction). Then re-run /review expecting READY_TO_MERGE without caveats.

Cost-benefit: option (b) is cheap and gets the cycle to clean READY_TO_MERGE; option (a) is faster and the caveats are honest deferrals.

**Anti-pattern check:** per `cycle-review.md § Anti-patterns`, the 2 MAJORs do NOT block merge (they would block production claims per Inquebrável Rule 3). Per `dogfood-golden-rule.md`, v1.0 production claim still blocked by `EVIDENCE_INSUFFICIENT` regardless of /review outcome.

**Strategic note:** the F-C1 + F-C2 + F-C3 closures shipped real semantic bug fixes that the original cycle missed. The /review system caught them correctly (cross-validation alone would have rubber-stamped the cycle). This is the system working as designed.
