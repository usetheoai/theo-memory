# Edge Case Review — auto-categorization-write-pipeline

Date: 2026-07-12
Tasks analyzed: 5 (T1.1, T1.2, T2.1, T3.1, T4.1)
Cases found: 7 (EDGE: 3, NEGATIVE: 4 | MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 2)

The plan is well-grounded (mirrors the `attributed_to` precedent, fail-soft by design). The real gap is at ONE boundary: the plan enforces the 1-64-char category cap only on the **operator** path (inherited from `themory-category-filter-server-side` EC-2), but the NEW **LLM-inferred** path writes `extracted[i].category` to the `category` column with NO length/normalization guard. An LLM can emit an arbitrarily long or whitespace-padded label. That is the class of bug this review exists to catch.

## MUST FIX

### EC-1: LLM-inferred category has no length cap (operator path caps 1-64, auto path does not)
- **Affected task:** T3.1
- **Kind:** NEGATIVE (invalid/oversized value from the LLM boundary)
- **Family:** Format / Boundary
- **Scenario:** The LLM emits a long free-form label (e.g. a 200-char sentence instead of a short category). The operator path already rejects >64 chars (`pipeline.ts:353-357`, `InvalidScope`), but the auto branch in T3.1 writes `extracted[i].category` verbatim with only a `non-empty` guard. The oversized string lands in the `category` column and pollutes the dashboard filter (which does EXACT match per category-filter ADR D5).
- **Impact:** Column pollution / a category value that no dashboard filter query will ever match; potential DB column-length issues; inconsistent with the operator-path contract.
- **Suggested fix:** In the auto branch, guard `const c = cat.trim(); if (c.length >= 1 && c.length <= 64) payload['category'] = c;` — else leave unset (fail-soft, NEVER throw, per ADR D4; do NOT reuse the operator path's `InvalidScope` throw here). Add the bound to T3.1's precedence pseudo-code + Acceptance Criteria.

### EC-2: LLM-inferred category stored un-normalized (whitespace/case breaks exact-match filter)
- **Affected task:** T3.1
- **Kind:** EDGE (extreme of a valid label — padded/mixed-case)
- **Family:** Format
- **Scenario:** The LLM emits `"  Work "` or `"Preferences"`. `classifyCategorySource` already trims+lowercases for *classification*, but the plan stores the *raw* `extracted[i].category`. The category-filter is an EXACT match (ADR D5), so a stored `"  Work "` never matches a `?category=work` query, and `"Work"` ≠ `"work"`.
- **Impact:** Auto-categorized memories become un-filterable / inconsistent with operator-supplied categories.
- **Suggested fix:** Store the trimmed value (`cat.trim()`) — same expression as EC-1's guard. (Casing policy: keep as-emitted after trim to match the taxonomy's own casing; the DEFAULT_CATEGORY_TAXONOMY is already lowercase, so instruct the prompt in T2.1 to emit lowercase labels. One-line prompt addition + the `.trim()` from EC-1 resolves both.)

## SHOULD TEST

### EC-3: LLM emits a non-string / null `category`
- **Affected task:** T3.1 (schema T2.1)
- **Kind:** NEGATIVE
- **Suggested test:** `test_autocategory_drops_non_string_category` — stub LLM returns a draft with `category: 123` (or `null`); assert `zod` drops it to `undefined`, the memory persists uncategorized, and `remember()` does not throw. (Confirms the T2.1 `z.string().optional()` + T3.1 `typeof === 'string'` guard compose as fail-soft.)

### EC-4: Empty taxonomy config (`autoCategorize.taxonomy = []`)
- **Affected task:** T1.2 / T2.1
- **Kind:** EDGE (valid but degenerate config — pure free-form mode)
- **Suggested test:** `test_empty_taxonomy_still_requests_a_label` — with `taxonomy: []`, the built prompt still asks the LLM for a `category`, and `classifyCategorySource(anything, [])` returns `'suggested'`. Assert the prompt does not emit an empty "Prefer one of: " clause with a dangling list.

### EC-5: Whitespace-only category `"   "`
- **Affected task:** T3.1
- **Kind:** NEGATIVE
- **Suggested test:** `test_whitespace_only_category_treated_as_absent` — LLM emits `category: "   "`; after `.trim()` the length is 0, so it is treated as absent (fail-soft, no event, memory uncategorized). Covered by the EC-1 `>= 1` guard; assert it explicitly.

## DOCUMENT

### EC-6: Verbatim (`infer:false`) path is NOT auto-categorized
- **Kind:** EDGE
- **Accepted risk:** The verbatim path (`pipeline.ts:213`) skips the LLM by definition, so there is no extraction call to piggyback a category on. Auto-categorization applying only when the LLM runs is consistent with ADR D1 (single round-trip — no separate categorization call). A `remember(text, { infer:false })` with no operator category yields an uncategorized memory. Add one sentence to the T3.1 Deep Dive noting this is intentional (already partially noted — make it explicit).

### EC-7: Re-remember of an existing fact does not change the stored category
- **Kind:** EDGE (state idempotency)
- **Accepted risk:** On a dedup collision (same fact hash), the write is an UPSERT that bumps `confirmation_count` and, per `themory-category-filter-server-side` ADR D6 immutability, does NOT overwrite `category` (first-write wins). So a non-deterministic LLM emitting a different auto-category on the second `remember()` of the same fact leaves the original category intact. This is the desired behavior (immutability preserved); document it in T3.1 so a reader does not expect the category to update.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 | 0 |
| T1.2 | 1 (EC-4) | 0 | 0 | 1 | 0 |
| T2.1 | 0 | 1 (EC-3 schema) | 0 | 0 | 0 |
| T3.1 | 2 (EC-2, EC-7) | 3 (EC-1, EC-3, EC-5) | 2 (EC-1, EC-2) | 2 (EC-3, EC-5) | 2 (EC-6, EC-7) |
| T4.1 | 0 | 0 | 0 | 0 | 0 |

**Coverage check:** the single new input boundary (the LLM `category` field) has both EDGE (padding/case, empty-taxonomy) and NEGATIVE (oversized, non-string, whitespace-only) cases considered. EC-1 + EC-2 are the same ≤3-line fix in the T3.1 auto branch (`const c = cat.trim(); if (c.length>=1 && c.length<=64) payload['category']=c;`) plus a one-line lowercase instruction in the T2.1 prompt.

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 + EC-2 into T3.1 (the length-cap + trim guard) and the lowercase prompt hint into T2.1; add EC-3/EC-4/EC-5 as tests; note EC-6/EC-7 in the T3.1 Deep Dive. All are small; no new module, no new abstraction.
