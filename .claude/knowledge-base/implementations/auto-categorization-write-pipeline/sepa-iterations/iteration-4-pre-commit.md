# SEPA pre-COMMIT — T3.1 (2026-07-12)

VERDICT: PROCEED — all 7 load-bearing invariants clean.
- Operator precedence (D3): options.category wins verbatim, no auto-event; LLM branch strictly in else.
- EC-1/2/5 fail-soft: boundedAutoCategory trims + 1-64 bound, drops (null) on non-string/empty/whitespace/oversized; never throws InvalidScope.
- Fail-soft (D4): auto branch pure/synchronous; nothing escapes the per-fact loop.
- Event (D2): category_auto_assigned fires ONLY when a value is written; source=classifyCategorySource.
- Language-correction rebuild: category preserved through `{ ...fact, text }` spread.
- no-paper-names: all identifiers/comments/tests neutral.
- Piggyback: rides the existing extraction call (6th prompt arg + single generateResponse); mirrors attributed_to.
WIRING (a) emitter live in loop (closes T1.1 pillar-a); (b) integration test drives real pipeline; (c) event via stub tracer.
