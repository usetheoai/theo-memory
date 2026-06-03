# Edge Case Review — v1-1-multi-peer-and-bi-temporal

Data: 2026-06-02
Tasks analisadas: 8 (T0.1, T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T4.1)
Edge cases encontrados: 13 (MUST FIX: 5, SHOULD TEST: 5, DOCUMENT: 3)

Plano analisado: `.claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md` v1.0

---

## MUST FIX

### EC-1: Pre-v1.1 rows lose attribution silently (no backfill in migration 0008)

- **Task afetada:** T1.1
- **Família:** State / Format
- **Cenário:** Memories shipped pre-v1.1 ran through the LLM extraction pipeline which already emits `attributed_to` (per `src/core/extraction/prompt.ts:39` TRINARY vocabulary) and persisted it INTO THE PAYLOAD (not a column). T1.1's ALTER TABLE only adds the column with NULL default; it does NOT backfill from payload. After migration, those existing rows have `attributed_to=NULL` on the column AND the value still sits in payload — invisible to T2.2's filter API.
- **Impacto:** Consumers upgrading to v1.1 lose attribution-filtered recall on historical data (silent regression — no error, just empty results when filtering by `attributedTo: 'user'`).
- **Fix sugerido:** Add to T1.1 migration 0008 SQL: `UPDATE memories SET attributed_to = (payload->>'attributed_to') WHERE payload ? 'attributed_to' AND attributed_to IS NULL;` (idempotent; runs once; NULL stays NULL for rows without payload key).

### EC-2: Verbatim path (`infer: false`) attribution contract undecided

- **Task afetada:** T1.1 + T2.1 (decision must land in T1.1)
- **Família:** Boundary / Format
- **Cenário:** T2.1 Deep Dives explicitly says *"verify scope before editing"* whether `RememberOptions.attributedTo?: string` is added for verbatim-path callers. This is an unresolved contract decision shipped to /implement, which Inquebrável Rule 1 (95% confidence) forbids.
- **Impacto:** Verbatim callers (`remember(text, { infer: false })`) have no way to set attribution; their writes will always have `attributed_to=NULL` on the column. Either accept that intentionally OR widen the API. Failing to decide = inconsistent contract at /implement time.
- **Fix sugerido:** Add to T1.1 ADR D2 an explicit clause: "Verbatim path (`infer: false`) DOES get `RememberOptions.attributedTo?: string` widening — additive, optional, ADR-0008-cap-preserving. T2.1 reads it from options when `infer: false`; from payload when `infer: true`." (1 sentence ADR amendment; T2.1 Files-to-edit + Tasks gain 1 line each).

### EC-3: `asOf` boundary validation missing for Invalid Date / NaN

- **Task afetada:** T3.1
- **Família:** Input / Boundary
- **Cenário:** Caller does `recall(query, { asOf: new Date('not-a-date') })`. `asOf` is type `Date` (non-undefined), so the lifted code-path takes it. `asOf.getTime()` returns `NaN`. Passed as parameter to Postgres, the driver may coerce NaN to NULL or fail with a cryptic type error.
- **Impacto:** Caller gets either silent wrong results (if NaN → NULL → no rows match `t_valid <= NULL`) OR an unintelligible Postgres error masking the real issue (invalid input).
- **Fix sugerido:** Add to T3.1 src/local/index.ts (boundary per architecture.md § 8 Error Handling — validate at boundaries): `if (options?.asOf !== undefined && Number.isNaN(options.asOf.getTime())) throw new InvalidScope('asOf must be a valid Date');` (2 lines; uses existing `InvalidScope` error class).

### EC-4: Stale `BiTemporalNotSupportedLocally` / ADR-0006 references not enumerated

- **Task afetada:** T0.1 + T3.1
- **Família:** Format / State
- **Cenário:** Plan lists T0.1 (ADR-0006 annotation) + T3.1 (options.ts + errors.ts JSDoc + factory.test.ts). But the throw-class is also referenced in `src/agent-tools/tools/recall-schema.ts:44` (`bi-temporal asOf surface v0.5+`) and the `t_valid <= NOW()` comment in `pgvector-store.ts:566` would become stale. A grep audit isn't an Acceptance Criterion.
- **Impacto:** Stale docs ship — consumers reading agent-tools schema or pgvector-store comments see "v0.5+ cloud-only" messaging contradicting the v1.1 contract. /review architecture-reviewer agent will flag this.
- **Fix sugerido:** Add to T3.1 Acceptance Criteria a literal grep gate: `grep -rn "BiTemporalNotSupportedLocally\|ADR-0006\|v0.5+" src/ tests/ | review every hit and update OR justify keep`. Cap audit time at 15min (it's < 30 hits today per current state scan).

### EC-5: Entity-boost path may leak cross-attribution memories in recall

- **Task afetada:** T2.2
- **Família:** State / Permission
- **Cenário:** ADR-0007 entityBoost defaults to `true`. Recall with entityBoost composes a hybrid score: semantic + bm25 + entity_match. The entity_match path queries an entity store and joins to memory rows. T2.2's WHERE clause `AND attributed_to = :attributedTo` may be applied ONLY on the primary memory query, not on the entity-boost subquery. Result: entity-matched memories from `bob`'s attribution may surface in `alice`'s `recall({ attributedTo: 'alice' })` if the entity hit comes from a bob-attributed row.
- **Impacto:** Cross-attribution leakage; the filter isolation advertised in T2.2 ("alice's rows ∩ bob's rows = ∅") is violated in practice when entityBoost is on (which is default).
- **Fix sugerido:** Add to T2.2 Tasks step 3.5: "audit the entity-boost subquery composition in `pgvector-store.ts`; ensure `AND attributed_to = :attributedTo` is applied to the entity-boost SQL fragment too (or to the final UNION ALL filter)." Integration test in T4.1 already covers cross-attribution isolation — verify it exercises entityBoost=true path.

---

## SHOULD TEST

### EC-6: Migration 0008 idempotency

- **Task afetada:** T1.1
- **Teste sugerido:** `test_migration_0008_is_idempotent` in `src/local/__tests__/schema.test.ts` — assert that running `runMigrations(pool)` twice in succession produces no error and yields identical schema state. The SQL should use `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` to guarantee this.

### EC-7: Empty-string vs NULL attribution filter semantics

- **Task afetada:** T2.2
- **Teste sugerido:** `test_attributedTo_empty_string_vs_null_filter` in `src/local/__tests__/pgvector-store.test.ts` — assert `recall({ attributedTo: '' })` matches rows where `attributed_to = ''` (Postgres `'' = ''` → true) and does NOT match rows where `attributed_to IS NULL` (Postgres `NULL = ''` → NULL → no match). Documents the Postgres semantics consumers will encounter.

### EC-8: Stub LLM fixture stability post-prompt-relax

- **Task afetada:** T1.2
- **Teste sugerido:** `test_stub_llm_fixtures_remain_stable_after_prompt_relax` in `src/llms/__tests__/stub.test.ts` — assert that hand-authored stub LLM fixtures (which deterministically emit `attributed_to: 'user'`/`'system'`/`'agent'`) still parse cleanly against the relaxed Zod schema + don't trigger the new N-valent assertions. Locks the regression guard against the prompt change cascading into stub-test failures.

### EC-9: Skill rows + asOf filter interaction

- **Task afetada:** T3.1
- **Teste sugerido:** `test_asOf_filter_applies_to_skill_rows` in `tests/integration/bi-temporal-asof.test.ts` — assert that `memory.skills(repoId).recall(query, { asOf: T })` honors the `t_valid`/`t_invalid` predicate on skill rows (kind='skill') just like memory rows. Confirms the WHERE clause isn't accidentally scoped to kind='memory' only.

### EC-10: Concurrent remember dedup-hash collision with different attributions

- **Task afetada:** T2.1
- **Teste sugerido:** `test_concurrent_remember_same_text_different_attribution` in `tests/integration/multi-peer-roundtrip.test.ts` — assert that two `Promise.all([remember(text, opts1), remember(text, opts2)])` where opts1/opts2 carry different `attributedTo` values produce a consistent result (either both stored with their own attribution OR dedup-collision keeps first writer's attribution — whichever the impl chooses, the behavior must be deterministic and documented).

---

## DOCUMENT

### EC-11: Soft-deleted memories recoverable via `asOf` — GDPR caveat

- **Risco aceito:** Post-T3.1, calling `recall(query, { asOf: T_before_forget })` will return memories that were soft-deleted via `forget(id)` after time T. This is the deliberate bi-temporal semantic (historical-state queries). GDPR-strict consumers must use `forget(id, { hard: true })` (ADR-0006 / v0.4b T7.1) for true erasure. Document in T3.1 JSDoc + add 1-line note in CHANGELOG `### Changed` entry under v1.1 release.

### EC-12: Skill rows inherit `attributed_to` column with NULL (no skill-side hoist)

- **Risco aceito:** Plan's T2.1 hoist logic targets the LLM-extraction path; skill rows (v0.6, kind='skill') don't flow through LLM extraction — they're written directly via `memory.skills(repoId).remember(skillPayload)`. After v1.1, skill rows will have `attributed_to=NULL`. Adding a skill-side attribution path is YAGNI per Rule 11 (no consumer asking). Document in T1.1 ADR D2 Consequences section: "Skill rows ship with `attributed_to=NULL` for v1.1; future v1.x widens `ScopedSkillMemory.remember` if demand surfaces."

### EC-13: TheoKit binding + examples/chat-with-memory UI updates deferred to v1.2

- **Risco aceito:** Plan's blueprint R2 already deferred TheoKit attributedTo support to v1.2. By extension, `examples/chat-with-memory/` UI doesn't surface `attributedTo` in its 4 tabs (User/Session/Skills/History). Acceptable — example is a demo, not a production reference; v1.1 ships the SDK contract; v1.2 ships the consumer-facing UX. Document in T4.1 CHANGELOG `### Added` entry: "SDK contract; TheoKit binding + example UI defer to v1.2."

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | 1 (EC-4 shared with T3.1) | 0 | 0 |
| T1.1 | 3 | 2 (EC-1, EC-2 shared with T2.1) | 1 (EC-6) | 1 (EC-12) |
| T1.2 | 1 | 0 | 1 (EC-8) | 0 |
| T2.1 | 2 | 1 (EC-2 shared with T1.1) | 1 (EC-10) | 0 |
| T2.2 | 2 | 1 (EC-5) | 1 (EC-7) | 0 |
| T3.1 | 4 | 2 (EC-3, EC-4 shared with T0.1) | 1 (EC-9) | 1 (EC-11) |
| T3.2 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 0 | 0 | 1 (EC-13) |

**Veredicto:** PLANO PRECISA DE AJUSTE — 5 MUST FIX items require plan revision (v1.0 → v1.1) before `/plan-confidence` can return ≥ SHIPPABLE_WITH_CAVEATS. EC-1 (backfill) and EC-2 (verbatim-path contract decision) are the highest-priority absorptions — both touch ADR D2 + T1.1 scope. EC-3 (asOf boundary validation) is a small but non-negotiable safety fix per architecture.md § 8. EC-4 (grep audit gate) and EC-5 (entity-boost filter) are scope-completeness gaps that /review would flag.

The SHOULD TEST items can stay in their respective task TDD sections without plan-version bump (added as additional RED tests).

The DOCUMENT items can be inlined as Consequences / Caveats in existing ADRs without restructuring.

**Recomendação para o humano:** absorver MUST FIX EC-1 through EC-5 into v1.0 → v1.1 plan bump, then run `/deps-audit v1-1-multi-peer-and-bi-temporal` (trivially PASS — zero new deps per plan Dependencies section) then `/plan-confidence v1-1-multi-peer-and-bi-temporal` for structural score.
