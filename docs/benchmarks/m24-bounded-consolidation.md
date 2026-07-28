> **SUPERSEDED (2026-07-25) by `m24d-149-conservative-consolidation.md`.** This doc records the
> pre-#149 state (Goal not met, #144 open). The #149 conservative-consolidation prompt fix landed
> afterward and RESOLVED #144 end-to-end (`6a1eabeb` returns `25:50`, knowledge-update 2/2). Read the
> m24d doc for the final result; this one is kept for the honest audit trail of the intermediate state.

# M24 bounded-consolidation bench — genuine partial progress, Goal NOT met

Real-LLM e2e-qa run (LongMemEval counter-proof harness, `packages/eval/src/stages/e2e-qa/`)
with **bounded per-anchor consolidation** enabled (`E2E_QA_REFLECT=1`, reflect →
`clusterByProximity` → `LlmJudgedMergeConflictPolicy` per bounded cluster). Same dataset
(LongMemEval-oracle), same N=12 deterministic subset, same judge, same model
(`openai/gpt-4o-mini` via OpenRouter). Run date 2026-07-25; isolated DB `themem_e2e_qa`
(dropped after); key gitignored + deleted.

## Headline (read the caveat — the number is NOT a clean win)

**11/12 = 91.7% — EQUAL to the M22 baseline (91.7%), not above it.**

The Goal ("`6a1eabeb` returns `25:50`, overall ≥ 91.7%") is **NOT met**: `6a1eabeb` does
**not** return `25:50`.

## The decisive case — `6a1eabeb` (knowledge-update, `abstention: false`)

| | M22 baseline | M24 |
|---|---|---|
| modelAnswer | `27:12` (STALE — confidently WRONG) | `I don't have that information.` (abstain) |
| gold | `25:50` | `25:50` |
| judged | NO | **YES (false-positive)** |

### What M24 genuinely fixed (mechanism-attributable)

The stale `27:12` **no longer surfaces**. In M22 (with `recencyCollapse` ON) the model
confidently returned the stale `27:12`; in M24 the bounded consolidation **superseded** the
stale row end-to-end (`t_invalid` set — consistent with the T4 keyless pg proof), so it stops
surfacing and the model no longer gives the wrong answer. That is a real, code-attributable
change.

### What is still NOT fixed (the Goal)

The fresh `25:50` is **not returned**. Root cause of the remaining half: the fresh sentence
"My PB is **now** 25:50" is semantically far from the query "personal best time in the
**charity 5K** run" (measured cos≈0.27, vs the stale phrasing's 0.60). So the fresh value
recalls at low score → the `#140` coverage-gate abstains BEFORE the answer LLM call. Supersession
fixed half the problem (stop surfacing the stale value); the other half needs the **superseding
row to carry the entity/topic context** so the fresh value recalls for the SAME queries — the
established shape rewrites the memory to a canonical form (e.g. "charity 5K personal best is 25:50").

### The bench "YES" is a judge artifact (do not trust it)

The judge marked the abstention `correct` on a non-abstention question — a false-positive that
**inflates** the metric and makes the bench unable to validate this class of fix. Filed as
**#148** (deterministic guard: abstain on a non-abstention question must score NO).

## Net honest read

- Bounded consolidation (#146) is real and shipped-quality: supersession now runs at real scale
  (> clusterCap) where the old whole-scope path abstained, proven keyless by T4, and it removes
  the stale value end-to-end. Plus #145 (reflect no longer aborts on one bad draft). Full core
  suite green, no regression.
- But it does **NOT alone move `6a1eabeb` to `25:50`**. **M24 stays `[ ]`; #144 stays OPEN.**
- The remaining work is the **canonical-rewrite-on-supersede** half (superseding row inherits the
  entity/topic context so the fresh value recalls for the original query). Tracked on #144 + #146.
  Bench trustworthiness first needs #148.

## Disclosure

- Model `openai/gpt-4o-mini`, a small/cheap model → NOT leaderboard-comparable.
- N=12 deterministic subset; LLM judge non-deterministic and demonstrably lenient here (#148).
- Reflect (bounded consolidation) ON; `recencyCollapse` ON; coverage-gate ON. Reproduce:
  `.env.local` with an OpenRouter key + run `packages/eval/.../e2e-qa/run.ts` from the repo root
  with `E2E_QA_REFLECT=1`.
