# Edge Case Review — dashboard-phase2a-attribution-asof

Date: 2026-06-19
Tasks analyzed: 5 (T1.1, T1.2, T2.1, T3.1, T3.2)
Edge cases found: 5 (MUST FIX: 0, SHOULD TEST: 3, DOCUMENT: 2)

Boundaries mapped: the only external input surfaces are (a) the dashboard `<input>` values (peer text + as-of datetime-local) → BFF body, and (b) the gateway client → TheMemory REST body. Verified: the `TheMemoryClient` interface passes `RememberOptions`/`RecallOptions` BY VALUE (memory.go:41-42), so adding optional fields does NOT break the interface or any fake (no signature change) — the prior cycle's `from`/`to` widening (`memories.tsx:89-90`) is the exact precedent for the asOf widening.

## MUST FIX

(none — the plan is wiring-only over fields TheMemory already validates; no crash/data-loss/security path found)

## SHOULD TEST

### EC-1: `datetime-local` → RFC3339 widening must yield a valid datetime
- **Affected task:** T2.1
- **Family:** Format
- **Scenario:** a default `<input type="datetime-local">` yields `YYYY-MM-DDTHH:mm` (no seconds, no zone). The plan widens with `+":00Z"` → `YYYY-MM-DDTHH:mm:00Z` (valid RFC3339). BUT if the input ever carries seconds (browser/locale or a future `step` attribute → `YYYY-MM-DDTHH:mm:ss`), `+":00Z"` produces `...:ss:00Z` (INVALID) → gateway D2 returns 400 for every recall-with-asOf (broken feature).
- **Suggested test:** `playground.test.tsx` — assert the recall body's `asOf` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/` (valid RFC3339) for a `datetime-local` value. Implementation guard (≤3 lines): only append `:00Z` when the value has exactly `HH:mm` (length 16); if it already has seconds, append `Z`. Document the "no `step` attribute set → minute precision" assumption inline.

### EC-2: whitespace-only `attributedTo` must be omitted, not sent as `" "`
- **Affected task:** T2.1 (ADR D3)
- **Family:** Input
- **Scenario:** operator types spaces in the peer field. `attributedTo: " "` is a non-empty string → would be sent and stored as a junk entity (pollutes the Entities aggregation).
- **Suggested test:** `playground.test.tsx` — typing `"   "` into the peer field → remember body does NOT include `attributedTo`. Implementation: `attributedTo` sent only when `peer.trim() !== ''` (use the trimmed value).

### EC-3: e2e `asOf` must be AFTER the write instant to return the memory
- **Affected task:** T3.1
- **Family:** Timing
- **Scenario:** if the e2e sets `asOf` to "now" or earlier relative to the just-written memory's `t_valid`, the bi-temporal predicate `(t_valid <= asOf)` may exclude it (clock skew / same-millisecond), making the recall-path assertion flaky.
- **Suggested test:** in T3.1, compute `asOf` as a fixed near-FUTURE instant (e.g. `now + 1h`, passed as an RFC3339 literal) so the write is unambiguously within `[t_valid, asOf]`; keep the assertion to "200 + results array present" (semantic ranking still deferred to the hermetic-embedder caveat). Also assert `GET /v1/memory/entities?scope=user` contains the attributed peer (proves attribution-write persisted).

## DOCUMENT

### EC-4: `attributedTo` has no length cap (free text)
- **Accepted risk:** TheMemory's `attributedTo: z.string().optional()` sets no max length; the gateway does not cap it either. Bounded in practice by the existing 1 MiB body limit (`memoryMaxBodyBytes`, memory.go) and the dashboard's single-line `Input`. A per-field cap is YAGNI for a demo Playground (ADR D3); the Entities page aggregates whatever is written. No action.

### EC-5: `asOf` before any memory's `t_valid` returns empty — correct, not a bug
- **Accepted risk:** a recall with an `asOf` earlier than every memory's validity start legitimately returns `{results:[]}`. This is correct bi-temporal behavior owned by TheMemory's `t_valid/t_invalid` predicate (ADR-0011), not a gateway defect. The dashboard renders the empty-results state already. No action (the gateway only forwards the field).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 0 | 2 (EC-1, EC-2) | 1 (EC-4) |
| T3.1 | 1 | 0 | 1 (EC-3) | 1 (EC-5) |
| T3.2 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK

No MUST FIX. The 3 SHOULD TEST items are cheap test+guard additions to T2.1/T3.1 (RFC3339 widening validity, whitespace-trim omission, future-asOf e2e). The 2 DOCUMENT items are consciously-accepted risks (no attribution length cap; empty as-of result is correct). Recommend absorbing the 3 SHOULD TEST into the plan's TDD (bump to v1.1) before `/implement`.
