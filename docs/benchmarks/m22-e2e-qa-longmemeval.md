# M22 e2e-qa re-run — post-fix LongMemEval (recencyCollapse ON + coverage-gate ON)

A re-run of the LongMemEval counter-proof (`packages/eval/src/stages/e2e-qa/`) after
M22, with the two shipped fixes **enabled** in the harness: `recall(..., { recencyCollapse: {} })`
(#141) and the `shouldAbstain` coverage-gate (#140). Same dataset (LongMemEval-oracle), same
N=12 deterministic subset, same judge, same model (`openai/gpt-4o-mini`).

## Headline

**11/12 = 91.7%** — up from the **9/12 = 75.0%** baseline (v0.47.1, `docs/benchmarks/m21-e2e-qa-longmemeval.md`).

| question_type | post-M22 | baseline |
|---|---|---|
| temporal-reasoning | 5/5 | 4/5 |
| multi-session | 2/2 | 2/2 |
| single-session-user / assistant | 2/2 | 2/2 |
| single-session-preference | 1/1 | 0/1 |
| abstention (`_abs`) | 3/3 | 2/3 |
| knowledge-update | 1/2 | 1/2 |

## Honest attribution (the number is nuanced — read this)

The +16.7pp is **not** cleanly "both fixes worked". On N=12 with an LLM judge:

- ✅ **#140 coverage-gate — GENUINE fix (1 example).** `gpt4_70e84552_abs` flipped `no → YES`:
  the baseline hallucinated a confident answer ("fixing the fence first"); post-fix the coverage-gate
  abstains ("I don't have that information") when recall coverage is thin. Abstention 2/3 → 3/3. Real.
- ⚠️ **`8a2466db` (preference) `no → YES` is likely JUDGE VARIANCE, not a fix.** In BOTH runs the
  model **abstained** ("I don't have…"); only the judge's verdict flipped (temp=0 gpt-4o-mini is not
  perfectly deterministic). This flip inflates the headline by ~1 example and is not attributable to
  the code.
- ❌ **#141 recencyCollapse did NOT fix the real knowledge-update case.** `6a1eabeb` STILL returns the
  stale `27:12` (gold `25:50`) with `recencyCollapse` enabled and a full top-10 recall. The two real
  values live in **differently-phrased** sentences ("My PB is 27:12" vs "My PB is now 25:50") that are
  **not cosine-near-duplicates at the conservative default τ=0.9**, so the collapse never fires. The
  deterministic `knowledge-update` fixture (near-identical stub vectors) proved the **mechanism**, not
  real-case efficacy on real, differently-worded same-fact pairs.

**Net honest read:** the genuine, code-attributable end-to-end improvement is **~1 example** (#140
abstention). The knowledge-update failure #141 targeted is **still present** end-to-end. The headline
91.7% overstates the fixes' real impact by roughly one judge-noise flip; treat it as illustrative
(N=12, LLM judge).

## Follow-up (honest gap)

`recencyCollapse` at τ=0.9 (cosine-only) does not catch real knowledge-update pairs where the same
fact is asserted with different wording. The blueprint's open question Q2 (cosine-only vs
same-entity+attribute link) is the fix path: collapse when two candidates share a normalized
entity+attribute, not only when their embeddings are ≥0.9-similar. Filed as a follow-up issue.

## Disclosure

- Model `openai/gpt-4o-mini`, a small/cheap model → NOT leaderboard-comparable to any published figure.
- N=12 deterministic subset; per-type cells are single/low-count; the judge is non-deterministic enough
  to flip a same-answer verdict (see `8a2466db`). Both fixes ON; baseline had both OFF.
- Run date 2026-07-25; isolated DB `themem_e2e_qa` (dropped after). Cost ~US$ few cents.
- Reproduce: `.env.local` with an OpenRouter key + `pnpm --filter @usetheo/memory-eval eval:e2e-qa`.
