# Edge Case Review — skills-cross-repo-flat-list

Date: 2026-06-23
Tasks analyzed: 4 (T1.1, T1.2, T2.1, T3.1)
Edge cases found: 5 (MUST FIX: 0, SHOULD TEST: 3, DOCUMENT: 2)

The plan already absorbs the high-severity edges from grounding: LIKE-wildcard injection (Drawback #2 + ADR D1 `escapeLikeWildcards` + `ESCAPE '\'`), cross-tenant leak (agent_id prefix + `:` delimiter, T3.1 GOAL #1 + #4 strict-prefix), subject-with-`:` guard (T2.1), repoId-strip defensive skip (#4), DOS cap (#12), DB fail-fast (Failure scenarios). No MUST FIX remains.

## MUST FIX

(none)

## SHOULD TEST

### EC-1: cross-repo SQL must ALSO bind workspace_id, not only the agent_id prefix
- **Affected task:** T1.1 — Family: Permission
- **Scenario:** a DIRECT themory consumer (not via the gateway's single-workspace master key) runs multiple workspaces. If `listSkillsBySubject` filters by the `agent_id` prefix ALONE, a caller bound to workspace W listing subject `alice` would also surface alice's skills stored under a DIFFERENT workspace.
- **Suggested test:** `test('listSkillsBySubject SQL binds workspace_id AND the agent_id prefix')` — assert the captured SQL contains BOTH `workspace_id = $` and `agent_id LIKE $` (the bound `workspaceId` from the signature is actually used). Defense-in-depth + multi-workspace correctness; the gateway path is unaffected (all `default`).

### EC-2: the new route must resolve to skillsAllHandler, not the generic scopes handler or per-repo handler
- **Affected task:** T2.1 — Family: Format
- **Scenario:** `/v1/scopes/skill/alice/all` could be mis-routed if a generic `/v1/scopes/:type/:id/...` or the `:repoId/skills` route shadowed it.
- **Suggested test:** `test('GET /v1/scopes/skill/:subject/all dispatches to skillsAllHandler (not the per-repo or generic scopes handler)')` — assert a request to `.../alice/all` returns the cross-repo shape (`{skills, total, truncated}` with `repoId` per row), proving Hono picked the static `all` route.

### EC-3: offset/limit boundary validation (negative, non-integer, beyond-end)
- **Affected task:** T2.1 — Family: Boundary
- **Suggested test:** `test('offset rejects negative/non-integer (422) and offset beyond total returns [] with the real total')` — `offset=-1` / `offset=abc` → 422; `offset=9999` on a 3-row subject → `{skills:[], total:3}` (total reflects the full match, page is empty).

## DOCUMENT

### EC-4: count + page are two non-transactional queries (minor skew under concurrent writes)
- **Accepted risk:** `total` (COUNT) and the page (LIMIT/OFFSET) are separate queries, exactly like the shipped `PgvectorStore.list` (pgvector-store.ts:710). Under a concurrent skill insert/forget the `total` and page can momentarily disagree by one. A listing is not a transactional read; wrapping in SERIALIZABLE would cost more than the skew is worth (KISS). Consistent with the existing precedent — no change.

### EC-5: `q` substring filter treats `%`/`_` in the query as ILIKE wildcards
- **Accepted risk:** `q` is bound as a parameter inside `description ILIKE '%'||$q||'%'` (NO SQL injection — param-bound). A user typing `%` or `_` gets wildcard semantics rather than a literal match. For a free-text search box this is acceptable (often expected) behavior; escaping `q` wildcards is a future refinement if the UI reports confusion. Documented, not fixed.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 0 | 1 (EC-1) | 1 (EC-5) |
| T2.1 | 2 | 0 | 2 (EC-2, EC-3) | 0 |
| T3.1 | 1 | 0 | 0 | 1 (EC-4) |

**Verdict:** PLAN OK — 3 SHOULD-TEST to absorb into the existing tasks' TDD (no new tasks, no structural change); 2 DOCUMENT risks accepted. deps-audit: no-op (no dependency change).
