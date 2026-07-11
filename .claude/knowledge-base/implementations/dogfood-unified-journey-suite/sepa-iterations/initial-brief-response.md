# SEPA Initial Brief — dogfood-unified-journey-suite (2026-07-11)

> Invoked via general-purpose fallback (the freshly-written SEPA agent type is not registered mid-session; the driver's Fallback path applies for the whole cycle). Agent id `a3a7cff47e6c0d13a`.

## Plan recap
Rewrites `/dogfood` from evidence-evaluator into a runner+gate: Claude-as-human executes catalogued journeys across SDK·API·MCP·UI (cross-repo, real dev-stack + Chrome), records one evidence file per journey, then `run_journey_audit.py` emits `EVIDENCE_SUFFICIENT` only when EVERY anchor journey (all of them, Q1) is fresh+green. Alters a LOCKED golden rule → Golden Rule Change Protocol (ADR-0019 + CHANGELOG + `check_xrefs.py` + `test_e2e_smoke.py`). Zero new deps; markdown + Python stdlib + vitest.

## Highest-risk tasks (watch)
1. **T1.1 `run_journey_audit.py` (HIGHEST)** — the gate itself; carries EC-1,3,4,5,6,7. Watch the **EC-3 oracle gate** (reject `pass` without non-empty `oracle_result` BEFORE counting green) + hard-cap **short-circuit order** (no_evidence→red→stale→secret→oracle-less), first-fail-wins per golden rule §3.
2. **T0.1 LOCKED golden-rule amendment** — "one-liner" that touches a LOCKED contract. Watch EC-11 verbatim-token grep (`EVIDENCE_*` + Status vocab) + protocol scripts green in the emitting iteration + ADR-0019 authored before the rule cites it (else `check_xrefs` breaks).
3. **T5.1 first full real run** — verdict MUST come from REAL evidence of an actual `/dogfood run`, not fixtures. Watch fresh-dated evidence with non-empty machine `oracle_result`; a genuinely-red journey → `EVIDENCE_INSUFFICIENT` naming it (finding, not plan failure). `SUFFICIENT` not backed by real fresh evidence = CRITICAL.

## Load-bearing invariants (never violate)
- LOCKED protocol: verdict tokens + Status vocab verbatim; ADR-authorized; protocol scripts green.
- Q1 all-anchor: every journey `anchor: true`; audit needs `no_anchor_journeys` runtime guard (EC-7).
- EC-3 oracle: `pass` without `oracle_result` ⇒ INSUFFICIENT (integrity core).
- EC-2 redaction: reject `theo_live_[…]{20,}` / `sk-or-v1-[…]{20,}`, allow short prefix; watch `tests/fixtures/dogfood/` too.
- EC-1 legacy: audit accepts `journey:` OR legacy `scenario:` via `aliases:` (no gate regression).
- Parsimony: Python stdlib only; zero new deps.

## Ordering hazards
- **T0.1 before T0.2** (golden-rule frontmatter contract precedes the catalog schema).
- T1.1/T1.2 not before T0.2 (they join against the real catalog).
- Phases 2∥3 serial in the loop: each driver task edits ONLY its own surface's `journeys.md` rows (shared-file scope-bleed risk).
- T4.1 after 1–3 (cites drivers + audit; dangling ref breaks `check_xrefs`).
- T5.1 after all; never run early against fixtures.

## Gaming pattern to watch
**Fixture-as-proof / hallucinated-green at T5.1** — emitting SUFFICIENT backed by `tests/fixtures/dogfood/` evidence mistaken for real run output, OR driver evidence with `outcome: pass` + empty/fabricated `oracle_result` (Claude self-reporting green without the oracle observing it — the exact EC-3 target). Verify: evidence in REAL `knowledge-base/dogfood/evidence/`, fresh-dated, `oracle_result` = verbatim machine observation (suite exit / HTTP status+shape / Chrome `evaluate_script`), not prose. Secondary: pillar-(a) no-op caller (script "wired" because SKILL.md names it but never invokes it).

## Recommended action
Proceed to Phase 0; T0.1 before T0.2. Consult SEPA VERBOSE pre-GREEN on T1.1 branch coverage. Keep drivers confined to their own surface rows.
