# SEPA — Iteration 4 / Task T3.1 / Phase Pre-RED

## Plan recap
- T3.1 adds opt-in stderr disclosure (gated by wasExplicit + THEOMEM_MCP_QUIET=1) per ADR D3 + 3 RED stderr-capture tests.

## Findings
- INFO — vi.spyOn(process.stderr, 'write') + stderrSpy.mock.calls.flat().join(' ') pattern suitable (FC2-T1.1 precedent).
- INFO — Insertion point after L184 (resolveMcpModes destructure) AND after L193-195 "real providers wired" stderr — keeps cause-then-disclosure order.
- [MAJOR] wasExplicit correctly EXCLUDES THEMEMORY_API_KEY (Tier-3 heuristic IS the trigger to announce). Add one-line comment to prevent future "consistency" refactor.
- [MAJOR] THEOMEM_MCP_QUIET=1 MUST gate ONLY new T3.1 block, NOT L193-195 (FC2-T1.1 contract).
- [MAJOR] EC-1 trim handled via resolved locals — do NOT re-read process.env raw in disclosure.
- [MAJOR] beforeEach MUST stub THEMEMORY_API_KEY='' AND THEOMEM_MCP_QUIET='' (invariant #9 — dev shell env QUIET=1 would silently mute disclosure → false-GREEN).
- [MAJOR] 3 tests must cover: (a) auto-flip → HTTP+api-keys disclosure, (b) stdio default → stdio disclosure, (c) explicit override suppresses BOTH branches.

## Recommended action
- RED: 3 tests with beforeEach env-stub discipline.
- GREEN: insertion at L195+ with one-line comment on Q3 rationale; quiet gate scoped to T3.1 block only.

(SEPA emitted spurious <promise>SEPA_ADVICE_DELIVERED</promise> marker — NOT the halt-loop's IMPLEMENTATION_COMPLETE; safe to ignore.)
