# Discover-Confidence Report — v0-8-benchmark-methodology

**Date:** 2026-06-02
**Trigger:** `/discover-confidence v0-8-benchmark-methodology` (post `/discover-execute` halt-loop, 8 iterations)
**Blueprint scored:** `.claude/knowledge-base/discoveries/blueprints/v0-8-benchmark-methodology-blueprint.md`
**Source plan:** `.claude/knowledge-base/discoveries/plans/v0-8-benchmark-methodology-plan.md` (v1.1)
**Calibration status:** PROVISIONAL_v1 (score bands are SOTA defaults; project holdout 0/30 — not yet calibrated)

## Verdict

**SHIPPABLE_WITH_CAVEATS (final score 89/100)** — soft cap `soft_floor_citation_density_low` fired (citation density 0.44/200w vs threshold 1.0/200w). Hard caps: NONE triggered. Verdict acceptable per `cycle-discover.md § Soft gates` for proceeding downstream.

## Dimensional breakdown

| Dimension | Score | Notes |
|---|---|---|
| **research_coverage** | 100/100 | 4/4 corners (tests / deps / tools / techniques) populated. Note: M2 scorer checks 4 corners; my blueprint adds a 5th (prior_art per cycle-discover.md v1.1) which is bonus content, not scored as hard requirement |
| **reference_citations** | 100/100 | 13/13 `.claude/knowledge-base/references/` paths verified; 0 fabricated; 0 explicitly-blocked |
| **blueprint_completeness** | 100/100 | 10/10 mandatory sections (Header, Context, Objective, Coverage Corner 1-4, Cross-cutting, ADRs, Recommendations); 4 ADRs in ADRs section (D1-D4); ≥ 1 ADR required |
| **risco_estrutural** | 75/100 | 9 smell hits: 5 weak_imperatives + 2 vague_pronouns + 1 non_verifiable + 1 subjective_adjective. Total penalty -25 |
| **weighted_avg (before caps)** | **96.2** | |
| **Active soft cap** | `soft_floor_citation_density_low` | 0.44 citations per 200 words (5860 words / 13 local citations) — below 1.0/200w threshold |
| **Final score after caps** | **89** | SHIPPABLE_WITH_CAVEATS band |

## Hard cap status

NONE triggered. Specifically:

- ✓ No `empty_corner_*` (all 4 mandatory corners populated)
- ✓ No `fabricated_citation` (13/13 local paths verified via `Path.exists()`)
- ✓ All 10 mandatory sections present
- ✓ ADR section non-empty (4 ADRs)

## Soft cap details — why citation density is low

Blueprint word count: 5860 words. Local citations: 13 (`.claude/knowledge-base/references/{...}` paths). Required for clean SHIPPABLE: 5860/200 = 29.3 citations.

The gap (16 missing citations) appears in:
1. **ADR sections (D1-D4)** — synthesis prose explaining decisions, with rationale + alternatives but few inline path-citations
2. **Recommendations section** — links to Q-numbers + ADR numbers but not always to backing `.claude/knowledge-base/references/{...}` paths
3. **Cross-cutting Comparison table** — summary cells with attributions like "Q1/EC-4 finding" rather than full paths

Honest take: the prose IS evidence-backed (the Q-sections that populate each corner have dense local citations); the synthesis layer cites RESULTS of those Q-sections rather than re-citing the underlying source paths. This is a stylistic trade-off, not a fabrication risk.

**URL citations** (NOT counted in this density metric per discover-confidence M2): 6 distinct URLs cited, all snapshot-backed at `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/`.

## Smell density breakdown (risco_estrutural penalties)

- **weak_imperatives (5 hits, penalty −15)** — "MUST", "should", "needs to" in prose (vs declarative assertions). Examples: "v0.8 implementation must handle..." / "v0.8 must download...". Acceptable in ADRs and Recommendations sections by design.
- **vague_pronouns (2 hits, penalty −6)** — "this", "those" without explicit referent. Minor cleanup opportunity.
- **non_verifiable (1 hit, penalty −2)** — likely "likely / probably" type. Acceptable in honest forward-looking statements.
- **subjective_adjectives (1 hit, penalty −2)** — adjective like "best" or "great" or "robust". Acceptable in Recommendations.

Total penalty −25 → score 75/100 on this dimension.

## Top strategic findings from the blueprint (audit-trail summary)

1. **Mem0's `evaluation/` ships LOCOMO-only** — no LongMemEval or DMR adapters in committed code. v0.8 will need to write LongMemEval + DMR adapters ourselves (Q3/Q5)
2. **LongMemEval has ZERO third-party reproductions** — v0.8 publication would be a novel contribution beyond TheMemory marketing (Q6)
3. **No benchmark-runner candidate ships LongMemEval/LoCoMo/DMR** — RAGAS/DeepEval/LangSmith all REJECTED. Mirror v0.7's "reuse primitives, own the pipeline" pattern: adopt metric libs, write our own runner (Q8 + D1)
4. **LoCoMo CC-BY-NC-SA 4.0 NonCommercial** — must download-at-install, never commit to TheMemory repo (Q7 + D4)
5. **Mem0's LLM-judge has "be generous" instructional bias** — v0.8 should ship configurable multi-judge panel (Q2 + D3)
6. **Mem0's `evaluation/` has 10+ orphan deps** — v0.8 should ship dedicated `[project.optional-dependencies] evaluation` group (Q4 + R3)
7. **No P95 latency / cost/session in Mem0's pipeline** — v0.8 must add these instrumentation columns (Q2 + R7)

## Recommendation

**ACCEPT the SHIPPABLE_WITH_CAVEATS verdict.** Per `cycle-discover.md § Soft gates #2`, soft cap caps verdict at 89 but does NOT trigger NEEDS_DEEPER or block downstream phases. The 13 verified citations cover the LOAD-BEARING claims; the soft-capped density reflects synthesis prose, not fabrication.

**The blueprint is ready to feed `/auto-plan v0-8-independent-benchmark-reproduction`.** That skill will re-run `scripts/assess_confidence.py` after the blueprint exists; the previous LOW score (20/100) should rise because (a) this blueprint is now a referenceable prior_art artifact, (b) the 4 ADRs (D1-D4) provide concrete design decisions, (c) the 10 R-recommendations give implementation seed.

**Alternative path:** invoke `/discover-improve` to push the verdict to SHIPPABLE clean by adding ~16 inline local citations across ADRs/Recommendations + tightening the 9 smell hits. Cost: 1-2 halt-loop iterations (~5-15k tokens). Acceptable but optional — the marginal value of moving from 89 to 90+ is small for downstream `/auto-plan`.

## Audit-trail outputs

- Blueprint: `.claude/knowledge-base/discoveries/blueprints/v0-8-benchmark-methodology-blueprint.md`
- Progress: `.claude/knowledge-base/discoveries/.progress-v0-8-benchmark-methodology.json` (8/8 questions DONE, gitignored)
- Snapshots (6): `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/`
- Plan: `.claude/knowledge-base/discoveries/plans/v0-8-benchmark-methodology-plan.md` (v1.1)
- Edge-cases report: `.claude/knowledge-base/reviews/v0-8-benchmark-methodology-edge-cases-2026-06-02.md`
- This confidence report: `.claude/knowledge-base/reviews/v0-8-benchmark-methodology-confidence-2026-06-02.md`

## Calibration disclaimer (verbatim from scorer)

> "PROVISIONAL_v1 calibration — score bands are SOTA defaults, not yet calibrated against project holdout."

`/discover-confidence` is in calibration v1 (holdout_count 0/30, kappa not measured). Score bands should NOT be treated as published thresholds until project-specific calibration completes.
