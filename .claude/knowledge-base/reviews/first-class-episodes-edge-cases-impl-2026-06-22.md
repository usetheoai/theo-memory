# Edge Case Review — first-class-episodes (implementation plan)

Date: 2026-06-22
Plan analyzed: `.claude/knowledge-base/plans/first-class-episodes-plan.md`
Tasks analyzed: 7 (T1.1, T1.2, T2.1, T2.2, T3.1, T4.1 + Coverage)
Edge cases found: 8 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 3)

Scope: a cursor-paginated, bi-temporal-aware temporal READ over the existing `memories` table. Boundaries = HTTP query params (T3.1), cursor encode/decode (T2.1), the WHERE predicate composition (asOf vs soft-delete; T2.1), and the in-memory/pgvector behavioral parity (T2.1).

## MUST FIX

### EC-1: `asOf` branch and default soft-delete-exclusion must be MUTUALLY EXCLUSIVE in the WHERE builder (bi-temporal correctness)
- **Affected task:** T2.1 (`listEpisodes` WHERE composition)
- **Family:** State / Format
- **Scenario:** A row soft-deleted at T2 (`t_invalid = T2`) must STILL appear in `?asOf=T1` (T1 < T2) — it was valid at T1. If the impl ANDs the default `t_invalid IS NULL` clause WITH the asOf predicate, the row is wrongly excluded (it has a non-null t_invalid), breaking historical replay — the load-bearing M2 value.
- **Impact:** `asOf` replay silently returns the WRONG historical state; GOAL test case 4 (asOf replay) would pass only by luck if no row was soft-deleted after the asOf instant.
- **Suggested fix:** make the branches exclusive in T2.1 — `if (asOf) WHERE <bi-temporal predicate ADR-0011>` ELSE `WHERE t_invalid IS NULL`. NEVER AND the default soft-delete clause onto the asOf branch. Add an explicit GOAL assertion: a row soft-deleted AFTER asOf still appears at asOf.

### EC-2: `queryText` LIKE-pattern injection — unescaped `%` / `_` / `\`
- **Affected task:** T2.1 (`queryText` ILIKE) + T3.1 (`q` param)
- **Family:** Input / Format
- **Scenario:** `queryText = "50%"` or `"a_b"` — `%` and `_` are ILIKE wildcards. A literal-text search for `50%` matches `500`, `50ABC`, etc. (not SQL injection — params are bound — but pattern-semantics injection → wrong results). `\` is the LIKE escape char.
- **Impact:** episode text filter returns wrong matches for any query containing `%`, `_`, or `\`; a consumer searching for a literal `%` gets surprising results.
- **Suggested fix:** escape LIKE metacharacters before binding — `q.replace(/[\\%_]/g, c => '\\' + c)` and use `ILIKE $1 ESCAPE '\'` (pg) / mirror the escape in the in-memory `.includes`-vs-pattern impl. ≤3 lines.

## SHOULD TEST

### EC-3: cursor `(created_at, id)` round-trip fidelity at same-timestamp boundary (precision + composite comparison)
- **Affected task:** T2.1 (encodeCursor/decodeCursor + the cursor WHERE predicate)
- **Suggested test:** `test_list_episodes_cursor_same_created_at_no_gap_no_overlap` — insert ≥3 rows with the IDENTICAL `created_at` (millisecond), page with `limit=2`; assert the 2nd page resumes at exactly the 3rd row (no row dropped, none repeated). Also assert the cursor encodes `created_at` at full pg precision (ISO with ms) so a JS `Date` round-trip does not truncate and skip a same-ms row. The composite predicate must be a row-value comparison consistent with `ORDER BY created_at <ord>, id <ord>` (UUID `id` compared lexicographically — same comparator in ORDER BY and cursor).

### EC-4: `after` AND `before` supplied together
- **Affected task:** T3.1 (query zod) + T2.1
- **Suggested test:** `test_get_episodes_after_and_before_conflict_422` — sending both `?after=&before=` → assert `422` (reject the ambiguous combination at the zod boundary with a `.superRefine`). Cheaper + clearer than defining a precedence rule.

### EC-5: in-memory adapter record carries `created_at` + `id` for cursor parity
- **Affected task:** T2.1 (in-memory `listEpisodes`)
- **Suggested test:** `test_in_memory_list_episodes_orders_by_created_at_then_id` — assert the in-memory impl sorts by `(created_at, id)` identically to pgvector (same order, same cursor edges). If the in-memory record does not currently persist `created_at`, the impl MUST add it so the behavioral contract matches; otherwise the unit test passes while the GOAL (pgvector) diverges.

## DOCUMENT

### EC-6: a non-existent cursor value does NOT error (deliberate divergence from Letta)
- **Accepted risk:** Letta throws `NoResultFound` when the cursor id doesn't exist (`message_manager.py:927`). Our `(created_at, id)` cursor is a VALUE comparison, not an id lookup — a cursor whose value matches no row simply yields the page from that point (possibly empty). This is BETTER (no spurious 404 on a stale cursor) and intentional. Record in T2.1 so `/review` does not flag the missing existence check as a gap.

### EC-7: `prevCursor` deferred — v1 computes `nextCursor` only
- **Accepted risk:** `EpisodePage` declares an optional `prevCursor` (T1.1) but v1 only computes `nextCursor` (forward pagination, the GOAL-test shape). Backward pagination via `before` is supported by the query, but the handler does not synthesize `prevCursor`. Document the field as reserved/forward-only for v1 (YAGNI) so the type's presence is not mistaken for a wired feature; a follow-up computes `prevCursor` if a consumer needs it.

### EC-8: episode boundary generalizes to user/agent tiers
- **Accepted risk:** the canonical "episode" is a Session (blueprint D3), but REST `:type` accepts `user`/`agent` too. For those tiers the endpoint returns that tier's memories in temporal order (a coarser "episode"). This is consistent with the existing `GET .../memories` tier generalization — document that `episodes` is the temporal projection of whatever scope tier is addressed, with Session being the canonical conversational episode.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 0 | 1 (EC-7) |
| T2.1 | 5 | 2 (EC-1, EC-2) | 2 (EC-3, EC-5) | 1 (EC-6) |
| T3.1 | 1 | 0 | 1 (EC-4) | 0 |
| Cross | 1 | 0 | 0 | 1 (EC-8) |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (mutually-exclusive asOf/soft-delete branches) + EC-2 (LIKE-escape) as MUST-FIX into plan v1.1; fold EC-3/EC-4/EC-5 test assertions into the relevant tasks' TDD; record EC-6/EC-7/EC-8 as DOCUMENT notes. Then `/plan-confidence`.
