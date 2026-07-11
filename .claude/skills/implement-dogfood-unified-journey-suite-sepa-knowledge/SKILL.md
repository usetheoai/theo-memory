---
name: implement-dogfood-unified-journey-suite-sepa-knowledge
description: |
  Domain knowledge skill paired with the SEPA agent for plan dogfood-unified-journey-suite. Consult ALWAYS during /implement when reasoning about TDD, SOLID, Clean Code, DRY, deterministic-gate scripting, or the wiring triad — hydrates community best practices via WebSearch on top of plan-specific context (ADRs + edge-case findings + LOCKED golden-rule protocol). Triggering phrases: "review this against community standards", "what's the canonical pattern", "is this idiomatic", "best practice for dogfood journey gate / evidence audit / locked-rule amendment".
allowed-tools: Read Glob Grep WebSearch WebFetch
model: opus
disable-model-invocation: false
---

# SEPA knowledge skill — dogfood-unified-journey-suite

You are the knowledge layer for the SEPA auditing the `/implement` halt-loop on plan `dogfood-unified-journey-suite`. SEPA is your CONSUMER — give it accurate, current, plan-specific community knowledge so findings cite canonical sources, not training recall.

## Plan context (frozen for this cycle)

**Goal:** Replace the evidence-only `/dogfood` gate with a unified journey-suite that drives every catalogued user journey across SDK+API+MCP+UI as a human and gates `EVIDENCE_SUFFICIENT` only when 100% of anchor journeys have fresh green evidence (else `EVIDENCE_INSUFFICIENT` naming each red).

**ADRs locked in the plan:**

| ID | Decision (1-line) |
|---|---|
| D1 | Amend the LOCKED dogfood golden rule to a runner+gate; **ALL journeys are anchor** (Q1 owner directive) — `EVIDENCE_SUFFICIENT` requires every catalogued journey green+fresh. |
| D2 | Claude-as-human execution (open Chrome / curl / run SDK snippet), reusing existing suites as the oracle — NOT headless-only. |
| D3 | The journey catalog `knowledge-base/dogfood/journeys.md` is the machine-readable SoT; `run_journey_audit.py` joins catalog × evidence. |

**Edge-case MUST-FIX absorbed (plan v1.1+):**

- **EC-1** — audit joins on `journey:` OR legacy `scenario:` (via `aliases:`) so existing evidence still matches (no gate regression).
- **EC-2** — secrets-redaction: reject `theo_live_[A-Za-z0-9_-]{20,}` / `sk-or-v1-[A-Za-z0-9]{20,}` but allow the documented ≤4-char prefix.
- **EC-3** — `outcome: pass` INVALID without a non-empty `oracle_result:` (machine-observable proof) — blocks a hallucinated self-reported green. THIS IS THE GATE'S INTEGRITY CORE.
- EC-4..EC-8 — freshness-boundary inclusivity, newest-fail-beats-older-pass, orphan-evidence-ignored, zero-anchor-structural-insufficient, oracle-unresolvable-records-fail.

**Project rules cited by the plan's ADR Rationale:**

- `cycle-rule-schema.md § Golden Rule Change Protocol` (T0.1/T4.1 — ADR + CHANGELOG + `check_xrefs.py` + `test_e2e_smoke.py` green; verdict tokens + Status vocab unchanged).
- `dogfood-golden-rule.md § 7` (failure modes the gate guards against — "dogfood theatre").
- `parsimony-ladder.md` (stdlib-only scripts; zero new deps — deps-audit PASS).
- `testing.md` (TDD RED→GREEN; the `tests/unit/dogfood/*` vitest suites are the audit's oracle).
- `no-paper-names-in-code.md` (src/** clause; watch test descriptors).

## How to help SEPA

- When SEPA asks about a canonical pattern for a deterministic gate script (parse a markdown catalog + evidence frontmatter, compute a verdict), prefer the EXISTING sibling precedents in-repo — `skills/plan-confidence/scripts/*.py`, `skills/code-quality/scripts/*.py` — over external libraries. Cite them by path.
- For "is this idiomatic Python stdlib?" — confirm `re`/`pathlib`/`datetime`/`json` cover the need; a new pip dep is a plan violation (Rule 9). Use WebSearch only to confirm a stdlib idiom, never to justify a dependency.
- For evidence-frontmatter parsing: the repo convention is YAML-ish frontmatter delimited by `---`; reuse the same shallow parser style as `dogfood` evidence files already in `knowledge-base/dogfood/evidence/`.
- For the LOCKED-rule amendment: the ONLY safe change is additive + protocol-gated. If SEPA sees a verdict-token or Status-vocab edit, that is CRITICAL.

## Boundaries

Read-only knowledge. Never edit files, never run git. Prefer in-repo precedent citations over external recall; use WebSearch to confirm a current idiom, not to introduce new tooling.
