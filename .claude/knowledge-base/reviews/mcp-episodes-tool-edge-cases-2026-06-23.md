# Edge Case Review — mcp-episodes-tool

Date: 2026-06-23
Tasks analyzed: 5 (T1.1, T1.2, T2.1, T2.2, T3.1)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: `nextCursor` must be emitted from the page, or MCP pagination is dead
- **Affected task:** T2.1 (handler wire-marshal) + T1.1 (test)
- **Family:** Format / State
- **Scenario:** `EpisodePage` has `items` + `nextCursor?`. If the handler maps only `items` (e.g. copies recall's `{ results }` shape and forgets the cursor), the agent gets a page but NO `nextCursor` to fetch the next one — pagination is silently broken (the whole point of an episodic LOG is iterating it).
- **Impact:** the tool returns the first page forever; an agent can never page through history. Defeats the feature.
- **Suggested fix:** the handler MUST copy `page.nextCursor` into `structuredContent.nextCursor` (omit the key when undefined, not `null`), AND a T1.1 test asserts: mock `episodes` → `{ items:[...], nextCursor:'abc' }`, assert the dispatch result's `structuredContent.nextCursor === 'abc'`. (D3 says this; promote to a TESTED assertion, not just prose.)

## SHOULD TEST

### EC-2: empty `queryText`/`order`/`limit` must not be forwarded as garbage to `episodes()`
- **Affected task:** T2.1
- **Suggested test:** `it('omits absent options — episodes({}) not episodes({queryText:"",limit:undefined})')` — when input is `{}`, assert `scoped.episodes` is called with `undefined` OR `{}` (NOT an object with `queryText:''` or `order:undefined`). An empty-string `queryText` would become `ILIKE '%%'` downstream (matches everything but wastes a filter); `order:undefined` is harmless but untidy. Build the options object by including ONLY present keys (mirror recall's conditional `parsed.limit ? {...} : {}` style).

### EC-3: wire `items[].scope` must serialize the discriminated union faithfully (session scope carries userId)
- **Affected task:** T2.1
- **Suggested test:** `it('serializes session-scope items with kind+sessionId+userId')` — an episode item under a session scope must wire `scope: { kind:'session', sessionId, userId? }` per recall's SCOPE_SCHEMA (3-variant discriminated union). Assert the OUTPUT_SCHEMA `.parse()` accepts a session-scoped item (regression guard against dropping a union variant). (recall already proves the shape; episodes reuses SCOPE_SCHEMA — the test confirms reuse, not divergence.)

## DOCUMENT

### EC-4: `asOf` future/epoch dates are accepted (not clamped) — same as REST/SDK
- **Accepted risk:** a valid-but-absurd `asOf` (year 3000, or 1970) parses to a valid Date and is forwarded to `episodes()`; the bi-temporal predicate simply returns whatever is valid at that instant (future → all live rows; far past → none). This matches the shipped REST/SDK behavior (no clamping there either); clamping would diverge the MCP surface from the others. Only `NaN`/invalid ISO is rejected (zod `.datetime()`). Documented; no clamp.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 (shared w/ T2.1) | 0 | 0 |
| T2.1 | 3 | 1 | 2 | 1 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (nextCursor emission + tested) into T1.1/T2.1; fold EC-2 (omit-absent-options) + EC-3 (session-scope union) into T1.1 TDD; EC-4 as a one-line note. No new tasks, no scope change.
