# Edge Case Review — dashboard-memories-tab-standardization

Date: 2026-06-08
Tasks analyzed: 9 (T1.1, T2.1, T2.2, T3.1, T3.2, T3.3, T4.1, T4.2 + sub-goal 7 follow-up file)
Edge cases found: 13 (MUST FIX: 5, SHOULD TEST: 5, DOCUMENT: 3)

## MUST FIX

### EC-1: NULL `created_at` on legacy pre-migration rows breaks `new Date(r.created_at)` mapping
- **Affected task:** T2.1
- **Family:** Boundary / Format
- **Scenario:** `PgvectorStore.list` SELECTs `created_at` column. If ANY legacy row exists with `created_at IS NULL` (early migration runs, manual inserts, restored backups), `new Date(null)` produces `Date(0)` = `1970-01-01T00:00:00.000Z` → silent epoch lie (different bug, same shape). pgvector schema has `created_at` with `DEFAULT now()` but DEFAULT only fires on rows the DEFAULT can see — manual `INSERT (id, ..., created_at) VALUES (..., NULL)` bypasses.
- **Impact:** Silent epoch dates surface on the REST endpoint AND Dashboard, indistinguishable from real 1970 records (none of which exist). Confidence-undermining for operators.
- **Suggested fix:** In `PgvectorStore.list` mapping: `createdAt: r.created_at !== null ? new Date(r.created_at) : undefined`. The D2 fallback in `getAll` then emits `getall_temporal_fallback` event for NULL rows, surfacing the data-quality issue instead of hiding it.

### EC-2: `getAll` returns rows in indeterminate order — Dashboard pagination becomes non-deterministic post-fix
- **Affected task:** T2.1 (pseudo-code shows `ORDER BY ...` placeholder; current `PgvectorStore.list` may NOT order by created_at)
- **Family:** State / Boundary
- **Scenario:** Pre-fix, since all rows had `createdAt = now()`, ordering on `createdAt DESC` was meaningless and the Dashboard happened to display rows in insertion-OID order (PG implicit). Post-fix, if `list()` doesn't ORDER BY `created_at DESC, id ASC`, pagination becomes non-deterministic across requests (same offset, different rows) — Dashboard renders flickering lists.
- **Impact:** Pagination silently broken; operators see different memories under same URL offset on each page refresh.
- **Suggested fix:** T2.1 pseudo-code MUST commit to `ORDER BY created_at DESC, id ASC` (deterministic tiebreaker). Update pseudo-code line 286 from `ORDER BY ...` to `ORDER BY created_at DESC, id ASC`. Add as explicit T2.1 acceptance criterion + test that 2 inserts at same `created_at` return in deterministic `id` order.

### EC-3: T3.1 integration test uses `INSERT` with `created_at` field but pseudo-code omits the full schema — likely missing required columns (hash, payload, vector, scope keys)
- **Affected task:** T3.1
- **Family:** Format / State
- **Scenario:** Pseudo-code line at T3.1: `INSERT INTO memories (id, user_id, text, hash, created_at, ...) VALUES (...)`. The `...` hides required columns: `embedding vector(384)` (NOT NULL on pgvector), `payload jsonb` (NOT NULL), `t_valid timestamptz`, `t_invalid timestamptz NULL`, `hash text NOT NULL UNIQUE` per scope. Naive INSERT fails NOT NULL constraint → test errors before assertion.
- **Impact:** Test never proves the fix; cycle ships with placebo gate.
- **Suggested fix:** T3.1 pseudo-code MUST use `wireMemoryFromPool(pool)` + `scoped.remember(text, {infer: false})` to insert rows via the canonical write path (which honors all schema constraints), THEN manually `UPDATE memories SET created_at = '...' WHERE id = ...` to set the temporal value. This way the test exercises the same INSERT path production uses.

### EC-4: Cross-repo merge ordering (R3 in plan) lacks an enforceable mechanism — Dashboard breaks for any consumer pulling between the 2 merges
- **Affected task:** T3.2 + T3.3 (frontend) — R3 mitigation says "phases commit FIRST" but doesn't define what "FIRST" means across 2 git repos with independent merge timelines
- **Family:** Timing / Integration
- **Scenario:** Backend merges first to theo-memory `develop` (commit X). Dashboard pulls `@usetheo/memory` via npm registry OR git-ref. If pinned to `develop` HEAD, OK. If pinned to a published version, Dashboard MUST wait for `npm publish` + version bump. Window of 1-24h during which Dashboard scope tabs reference fields that npm version doesn't expose.
- **Impact:** Dashboard runtime crash on tab render in production for ANY consumer in the window.
- **Suggested fix:** Add T3.0 (NEW pre-T3.2 task): pin `@usetheo/memory` dep in theo-cloud `cloud/dashboard/package.json` to the EXACT commit SHA of the T2.2 commit (e.g., `"@usetheo/memory": "github:usetheo/theo-memory#<sha>"`) BEFORE T3.2 lands. Or document in T4.2 § Acceptance Criteria that Dashboard PR description MUST cite the backend SHA and CI MUST install from that SHA.

### EC-5: D5 "follow-up file MUST be created in same cycle artifact dir" is declared but NOT mapped to any task — gets lost
- **Affected task:** sub-goal 7 (orphan in plan)
- **Family:** State / Process
- **Scenario:** ADR D5 + sub-goal 7 + Global DoD all reference creating `themory-temporal-fidelity-full-fix-DRAFT.md` for the deferred 5 createdAt instances. But NO task (T1-T6) covers this work. The plan's `## Coverage Matrix` row 7 says "sub-goal 7 + plan changelog" — vague. Risk: cycle ships, follow-up file never created, the deferred bug becomes invisible debt.
- **Impact:** Architectural debt loses traceability. v1.1 bi-temporal `asOf` may silently stay broken with no record pointing at it.
- **Suggested fix:** Add T6.1 (NEW task in Phase 6 OR amend T4.2 acceptance): "Create `knowledge-base/plans/themory-temporal-fidelity-full-fix-DRAFT.md` documenting the 5 deferred createdAt instances (file:line each), the v1.1 bi-temporal asOf empirical validation gap, and the Coverage Matrix to be filled in the next /to-plan invocation. Required for Global DoD."

## SHOULD TEST

### EC-6: T2.2 InMemoryVectorStore stamps `createdAt: new Date()` at insert — but if 2 inserts happen in same millisecond, downstream pagination tiebreaker (EC-2 fix) tested?
- **Affected task:** T2.2
- **Suggested test:** `test_in_memory_store_two_inserts_same_millisecond_pagination_deterministic` — `vi.useFakeTimers()` freezes clock; insert 2 rows; assert `list()` returns them in deterministic order (by id, not random).

### EC-7: `getall_temporal_fallback` event MAY fire on EVERY row of a large legacy scope (e.g., 10k pre-fix rows) → log/OTel explosion
- **Affected task:** T2.2
- **Suggested test:** `test_getall_fallback_event_emitted_at_most_once_per_scope_per_request` — fixture with 100 rows lacking createdAt; assert event fired at most ONCE with metadata `{count: 100}` instead of 100 times. Aggregate emission per request, not per row.

### EC-8: Dashboard Memories tab `<Tabs>` URL state — what if user navigates with `?scope=invalid` (unknown scope value)?
- **Affected task:** T3.2
- **Suggested test:** `test_memories_tab_invalid_scope_param_defaults_to_user` — mount component with `useSearchParams: {scope: 'invalid_garbage'}`; assert active tab is `user` (matches `entities.tsx:55` `SCOPES.includes(scopeParam as Scope)` defensive coerce pattern).

### EC-9: T3.3 column `scope_type` (Badge) — but Memories REST today doesn't return `scope` per row in the projection consumed by Dashboard, only the list root
- **Affected task:** T3.3
- **Suggested test:** `test_memories_tab_renders_scope_type_badge_per_row` — assert each DataTable row has a Badge with the scope_type value. May reveal that the BFF projection omits `scope` per-row OR that T3.3 needs to derive it client-side from the URL `?scope=` filter (less rigorous but matches entities pattern where all rows in the table share the active scope).

### EC-10: T4.1 BFF smoke "no code change unless smoke fails" — but smoke runs against MOCK or REAL upstream?
- **Affected task:** T4.1
- **Suggested test:** `test_bff_pass_through_against_real_themory_server` — explicit acceptance criterion: smoke test boots real themory server (no mock) + real BFF + real curl chain. Mock-based smoke would mask the BFF's own time-stamping if present.

## DOCUMENT

### EC-11: D3 in-place edit risk preserved well, but Memories tab still has the OLD `category` + `date` filter UI that has NO backing data (dead filter)
- **Accepted risk:** Plan D3 says "preserve existing trash + ConfirmDialog choreography". Doesn't say what to do with the dead `category` + `from/to` date filters. Documenting: cycle keeps them (no rows have `category` set, so they silently filter to empty — UX regression but not new). A follow-up `dashboard-memories-tab-dead-filter-cleanup` cycle removes them. Not blocking.

### EC-12: `confirmation_count` column promised in v1.1 (Roadmap Item 12) — not exposed on Dashboard table per Q2 explicit deferral
- **Accepted risk:** Q2 in plan explicitly defers `confirmation_count` column to the follow-up cycle. Operators won't see how many times a memory was confirmed across sources. Acceptable for this cycle's scope; absorbed by `themory-temporal-fidelity-full-fix` (which will also touch the v1.1 invariants).

### EC-13: pgvector v0.5.1 `created_at` column type — confirm `timestamptz` vs `timestamp without time zone`?
- **Accepted risk:** pgvector schema in this project uses `timestamptz` (verified at PG `\d theo_api_keys` earlier in this session shows `timestamp with time zone` pattern). `new Date(r.created_at)` from Node pg driver returns the timestamp in UTC — fine. Documenting: if a future migration ever uses `timestamp` (no TZ), the mapping `new Date(r.created_at)` would interpret it as local time → subtle UTC drift. Mitigation: `rules/architecture.md § 10.x` could add "all temporal columns MUST be `timestamptz`" but out-of-scope for this cycle.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 3 | 2 (EC-1, EC-2) | 0 | 1 (EC-13) |
| T2.2 | 2 | 0 | 2 (EC-6, EC-7) | 0 |
| T3.1 | 1 | 1 (EC-3) | 0 | 0 |
| T3.2 | 1 | 0 | 1 (EC-8) | 0 |
| T3.3 | 2 | 0 | 1 (EC-9) | 1 (EC-11) |
| T4.1 | 1 | 0 | 1 (EC-10) | 0 |
| T4.2 | 1 | 1 (EC-4) | 0 | 0 |
| sub-goal 7 | 2 | 1 (EC-5) | 0 | 1 (EC-12) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 5 MUST FIX requiring absorption into plan v1.1:

1. **EC-1** (NULL created_at) → T2.1 pseudo-code defensive null-check + map to undefined (D2 fallback handles)
2. **EC-2** (ORDER BY) → T2.1 commit to `ORDER BY created_at DESC, id ASC` + acceptance criterion
3. **EC-3** (T3.1 INSERT shape) → T3.1 pseudo-code uses canonical write path + UPDATE for temporal manipulation
4. **EC-4** (cross-repo merge order) → NEW T3.0 task pinning `@usetheo/memory` to commit SHA before frontend lands
5. **EC-5** (sub-goal 7 orphan) → NEW T6.1 task explicitly creating the follow-up DRAFT plan file

5 SHOULD TEST items to add to existing tasks' TDD blocks (EC-6, EC-7, EC-8, EC-9, EC-10). 3 DOCUMENT items inline in respective ADRs (EC-11, EC-12, EC-13).

Recommendation: human absorbs MUST FIX items into plan v1.1 (per skill convention — this skill does NOT edit the plan), then re-run `/plan-confidence dashboard-memories-tab-standardization`. Expected verdict bump: INVALID 49 → SHIPPABLE_WITH_CAVEATS 70+ after the 5 MUST FIX absorptions close the coverage_lt_100 hard cap.
