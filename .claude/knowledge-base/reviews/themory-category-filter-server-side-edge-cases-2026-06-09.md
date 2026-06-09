# Edge Case Review — themory-category-filter-server-side

Date: 2026-06-09
Tasks analyzed: 9 (T1.1, T2.1, T3.1, T3.2, T3.3, T4.1, T4.2, T5.1, T5.2)
Edge cases found: 12 (MUST FIX: 3, SHOULD TEST: 5, DOCUMENT: 4)

## MUST FIX

### EC-1: UPSERT category collision semantics undefined

- **Affected task:** T3.2 (PgvectorStore category hoist + filter + projection)
- **Family:** State
- **Scenario:** A row already exists at `(hash='Hx', user_id='alice', category='preferences')`. A new `remember(sameText, {category: 'travel'})` triggers the composite-unique `ON CONFLICT DO UPDATE` path (which currently bumps `confirmation_count`). The plan does NOT specify what happens to the `category` column on conflict. Three behaviors are possible: (a) `category = EXCLUDED.category` (last-write-wins overwrites 'preferences' → 'travel'), (b) `category = memories.category` (no-op preserves original), (c) `category = COALESCE(EXCLUDED.category, memories.category)` (only set when previously NULL).
- **Impact:** Silent semantic drift — operators discover their category was overwritten via a re-remember they didn't think mutated state. Violates ADR-0003 ADD-only spirit (the row is mutated even though the public API didn't ask for mutation).
- **Suggested fix:** Plan-side, choose behavior (b) `DO NOT update category on conflict` (preserves first-write) AND add explicit ON CONFLICT clause: `ON CONFLICT (hash, user_id, ...) DO UPDATE SET confirmation_count = confirmation_count + 1 -- category intentionally NOT in SET; first-write wins per ADR-0003`. Add to T3.2 acceptance criterion: integration test `test_pgvector_upsert_does_not_overwrite_category()`.

### EC-2: SDK-layer length cap not enforced (only REST validates ≤ 64 chars)

- **Affected task:** T3.3 (pipeline category routing) — boundary defense
- **Family:** Input / Boundary
- **Scenario:** A direct SDK consumer (NOT going through REST) calls `memory.user('x').remember(text, {category: '<huge 10KB string>'})`. The pipeline stuffs it into payload; pgvector adapter inserts arbitrary-length string into the unbounded `text` column. Per ADR D3 the cap is documented in JSDoc but TypeScript does NOT enforce string length.
- **Impact:** DB row size bloat; index entry cost balloons; per-row latency on filtered list scans degrades; the architecture.md § 8 boundary-validation invariant is violated (validate at boundaries, but the SDK is a boundary too — not just REST).
- **Suggested fix:** Add boundary check in `runInferFalsePath` AND LLM-extraction path BEFORE payload stuff: `if (options?.category !== undefined && (options.category.length === 0 || options.category.length > 64)) throw new InvalidScope('category must be 1-64 chars');`. Mirrors the existing `asOf` NaN check at `src/local/index.ts:580` precedent. Add to T3.3 acceptance criterion: unit test asserting throw for 65-char input.

### EC-3: Empty-string filter passthrough (in-memory + pgvector divergence)

- **Affected task:** T3.1 (in-memory) + T3.2 (pgvector) + T4.1 (REST → store mapping)
- **Family:** Input / Boundary
- **Scenario:** REST rejects `?category=` (empty string) via zod `min(1)`. But the internal pipeline `LocalScopedMemory.getAll({category: ''})` does NOT reject — direct SDK callers can pass empty. The plan's pseudo-code for in-memory has `if (filter.category !== undefined && row.category !== filter.category)` which treats empty string as "filter set, must equal ''". pgvector's WHERE clause has the same: `category = ''` is a valid SQL predicate. Behaviors diverge from REST's "empty = no filter".
- **Impact:** Adapter divergence: SDK callers see "empty string filters for empty-string-category rows" (which is zero rows in practice), while REST callers see "422 INVALID_QUERY". Surprising. Risk: unit tests (in-memory) pass with one semantic, integration tests (REST) pass with another.
- **Suggested fix:** Plan-side, normalize empty string to undefined at the store boundary. Pseudo-code amendment for in-memory + pgvector composeFilters: `const cat = filters.category; if (cat !== undefined && cat !== '') { ... }`. Add to T3.1 + T3.2 acceptance criterion: test asserting `filters.category=''` returns the SAME result set as `filters.category=undefined`.

## SHOULD TEST

### EC-4: Case-sensitivity is deliberate

- **Affected task:** T3.1 + T3.2
- **Suggested test:** `test_category_filter_is_case_sensitive()` — insert rows with `[Preferences, preferences]`; filter `category='preferences'` returns exactly 1 row (NOT 2). Pin the deliberate non-normalization documented in ADR D1.

### EC-5: Unicode normalization is NOT performed

- **Affected task:** T3.2
- **Suggested test:** `test_category_filter_byte_equality_unicode()` — insert rows with `['café'` NFC, `'café'` NFD]; filter `category='café'` (NFC) returns 1 row; filter `'café'` returns the other 1 row. Pin byte-equality semantic.

### EC-6: SQL-injection probe via category value

- **Affected task:** T3.2 (pgvector composeFilters)
- **Suggested test:** `test_category_filter_resists_sql_injection()` — POST a remember with `category="' OR 1=1 --"`; SELECT via REST `?category=<same>`; assert it returns exactly the 1 matching row (NOT the unfiltered set; NOT a SQL error). Validates the parameterized query path.

### EC-7: Cursor + changed category mid-pagination

- **Affected task:** T4.1 (REST scopesHandler cursor + category combo)
- **Suggested test:** `test_cursor_continuation_with_different_category_does_not_throw()` — page 1 with `category=a` returns cursor C; subsequent call with `cursor=C&category=b`. Asserts either (a) empty/coherent result OR (b) reasonable filtered subset, NEVER throws. Pin the "consumer error is graceful" behavior documented in the plan T4.1 Deep Dives.

### EC-8: Cross-repo contract — category exposed via TWO REST pathways

- **Affected task:** Cross-T3.2 + T5.1
- **Suggested test:** `test_bff_reads_category_from_projected_payload()` — Go unit test on BFF: stub upstream REST returning `{items: [{...payload: {category: 'a'}, category: 'a'}]}` (both pathways present per attributed_to precedent); assert BFF `MemoryRow.Category === 'a'`. Pin the dual-pathway intent (mirrors attributed_to precedent — both top-level + payload-projected exist).

## DOCUMENT

### EC-9: NULL rows are NOT findable via the filter

- **Accepted risk:** Per ADR D1 there is no implicit default category. Operators wanting to find uncategorized memories CANNOT use `?category=` (zod rejects empty); cannot use `?category=null` (filters for literal "null" string). The HONEST UX is "uncategorized rows are unfindable by the filter input". JSDoc should call this out so operators don't burn time looking. Add one paragraph to T4.1 Deep Dives and the JSDoc on `RememberOptions.category`.

### EC-10: Operator vocabulary drift over time

- **Accepted risk:** Already in Drawbacks & Risks table (severity Low, mitigation: defer enum to v1.4 typed-domain-ontologies). Carry forward verbatim. No action needed.

### EC-11: Migration `db:push` vs `runMigrations()` orphan-schema scenario

- **Accepted risk:** `architecture.md § 10.2` already documents the collision pattern. T2.1 migration is column-only (no trigger/function), so `db:push` + `runMigrations()` both apply cleanly. The risk is pre-existing and not aggravated by this plan. No new mitigation needed.

### EC-12: Two-pathway projection (top-level `item.category` + `item.metadata.category`)

- **Accepted risk:** Mirrors the v1.1 attributed_to precedent exactly. BFF already reads from `payload["category"]` (`theo-cloud/cloud/internal/themory/client.go:185-188`), so the projection path works unchanged. The MemoryItem JSON serialization also exposes top-level `category` — direct REST consumers can choose either. NOT a defect; the redundancy is intentional architectural symmetry. Document in JSDoc on MemoryItem.category that "the field is ALSO projected to `metadata.category` for upstream-shape parity (mirrors v1.1 attributedTo precedent)".

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 0 | 0 | 1 (EC-11) |
| T3.1 | 4 | 1 (EC-3) | 1 (EC-4) | 0 |
| T3.2 | 6 | 2 (EC-1, EC-3) | 4 (EC-4, EC-5, EC-6, EC-8) | 1 (EC-12) |
| T3.3 | 1 | 1 (EC-2) | 0 | 0 |
| T4.1 | 3 | 1 (EC-3) | 1 (EC-7) | 1 (EC-9) |
| T4.2 | 0 | 0 | 0 | 0 |
| T5.1 | 1 | 0 | 1 (EC-8) | 0 |
| T5.2 | 0 | 0 | 0 | 0 |

(EC-3 spans T3.1, T3.2, T4.1 — counted once per task above; deduplicated to 3 MUST FIX total)
(EC-4 spans T3.1, T3.2 — counted once per task; deduplicated to 1 SHOULD TEST total)
(EC-8 spans T3.2, T5.1 — counted once per task; deduplicated to 1 SHOULD TEST total)
(EC-10 was already in Drawbacks of v1.0 plan; counted ZERO here to avoid double-flagging)

**Verdict:** PLAN NEEDS ADJUSTMENT

Three MUST FIX items must be absorbed into plan v1.1 before `/plan-confidence`:

1. **EC-1** — Lock UPSERT semantics for category (first-write wins). Add explicit ADR D6 OR amend ADR D2 with the ON CONFLICT clause. Add integration test to T3.2.
2. **EC-2** — Add boundary length check in pipeline (1-64 chars). Mirror the v1.1 `asOf` NaN check precedent at `src/local/index.ts:580`. Add unit test to T3.3.
3. **EC-3** — Normalize empty-string filter to undefined at store boundary. Amend T3.1 + T3.2 pseudo-code. Add test asserting `filters.category=''` is equivalent to `undefined`.

After absorption, the 5 SHOULD TEST items become explicit test additions inside the corresponding tasks' TDD blocks (not new tasks). The 4 DOCUMENT items become inline JSDoc / plan-prose amendments.

Expected delta v1.0 → v1.1:
- ~80 LoC plan prose added (3 ADR amendments + 5 test additions + 4 DOCUMENT paragraphs)
- 0 LoC code budget impact — fixes ride inside existing task scopes (no new files; no new tasks)
