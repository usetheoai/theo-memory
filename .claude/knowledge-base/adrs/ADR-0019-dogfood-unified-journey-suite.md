# ADR-0019 — Unified /dogfood journey-suite (runner+gate; all-journeys anchor)

**Status:** Accepted (project-owner directive 2026-07-11)
**Supersedes clause of:** the single-anchor hard-cap wording of `rules/dogfood-golden-rule.md` § 3 (#3/#4). Builds on [ADR-0012](ADR-0012-dogfood-gate-empirical-snapshot-amendment.md) (the precedent for amending the dogfood golden rule via ADR).
**Change protocol:** authorizes the LOCKED-rule change per `rules/cycle-rule-schema.md § Golden Rule Change Protocol` (this ADR + CHANGELOG `[Unreleased] § Changed` + `scripts/check_xrefs.py` + `scripts/test_e2e_smoke.py` green). This is an **extension** (tightens the gate), not a softening.

## Context

`/dogfood` was an evidence **evaluator**: it read a manifest + evidence files for a single anchor scenario (`claude-code-auto-memory`) and emitted `EVIDENCE_SUFFICIENT / WITH_CAVEATS / INSUFFICIENT`. That let UI/API/MCP/SDK journeys rot untested while the gate passed on one narrow scenario — exactly the failure mode the golden rule § 7 exists to prevent ("dogfood theatre"). A same-session manual run proved a real end-to-end UI test IS achievable (dev-stack + Chrome MCP) but is neither automated nor captured by the gate.

## Decision

Rewrite `/dogfood` into ONE unified **runner+gate**. Claude Code, behaving as a real human user, executes a catalogued set of user journeys across all four product surfaces (SDK · API · MCP · UI — cross-repo, on the real dev-stack + real Chrome), records one evidence file per journey, then evaluates. Specifics:

1. **Journey catalog** (`knowledge-base/dogfood/journeys.md`) is the machine-readable Source of Truth: one row per journey (`id | surface | title | anchor | oracle`) + a per-journey steps block. The evaluator `run_journey_audit.py` joins catalog × evidence.
2. **Q1 — ALL journeys are `anchor: true`** (project-owner directive). `EVIDENCE_SUFFICIENT` requires every catalogued journey fresh + green; `EVIDENCE_WITH_CAVEATS` fires only on the thin-evidence soft caps (§ 4), never on a red journey.
3. **EC-3 — `oracle_result` required for `pass`.** A machine-observable proof (suite exit code / HTTP status+shape / Chrome `evaluate_script` return) must back every `outcome: pass`; a `pass` without it is INVALID (hard cap #5). This closes the "hallucinated self-reported green".
4. **EC-2 — secrets redaction.** Evidence rejects a full-secret literal (`theo_live_[…]{20,}` / `sk-or-v1-[…]{20,}`); the documented ≤4-char prefix is allowed (hard cap #6).
5. **EC-1 — backward-compat.** The evaluator accepts `journey:` OR the legacy `scenario:` join key (via the anchor journey's `aliases:`), so the existing `claude-code-auto-memory` evidence still matches — no silent anchor swap.
6. **Verdict tokens (§ 1) and Status vocabulary (§ 2) are unchanged.**

## Rationale

Making every journey anchor is the literal reading of the owner's directive "todos os testes de todas as jornadas / garantir que o sistema está 100% funcional": `EVIDENCE_SUFFICIENT` means every catalogued journey on every surface is green, proven by a machine oracle, not by prose. Reusing existing suites (vitest contract/integration/e2e, theo-cloud `make e2e`, `test-chat-with-memory`) as the oracle honors Unbreakable Rule 9 (don't reinvent). The gate stays an honesty gate — now backed by executed journeys.

## Alternatives considered

- **(a) NEW sibling skill `/dogfood-run`, leaving `/dogfood` untouched** — rejected: the owner wants ONE unified dogfood ("Unificar em uma dogfood só completa").
- **(b) Anchor SUBSET + non-anchor soft caps** — rejected by the owner (Q1): a subset lets a red journey still yield `EVIDENCE_SUFFICIENT`, contradicting "100% functional".
- **(c) Keep the evidence-evaluator; add journeys as documentation only** — rejected: unexecuted journeys are the rot this ADR removes.

## Consequences

- Enables per-surface honesty; every surface + journey must be green for a v1.0 claim.
- `EVIDENCE_SUFFICIENT` becomes hard to reach (by design); a single flaky journey blocks — the accepted cost of a literal "100% functional" gate (mitigated by per-journey re-run + honest `partial/fail` recording, never a silent green).
- Constrains future surfaces to register a journey before a v1.0 claim.

## References

- Plan: `knowledge-base/plans/dogfood-unified-journey-suite-plan.md`
- Edge-case review: `knowledge-base/reviews/dogfood-unified-journey-suite-edge-cases-2026-07-11.md`
- Golden rule amended: `rules/dogfood-golden-rule.md` (§ 3 hard caps #3–#7, § 5 frontmatter, § 9 journey catalog)
- Change protocol: `rules/cycle-rule-schema.md § Golden Rule Change Protocol`
