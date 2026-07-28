# M21 e2e-qa — LongMemEval methodology on TheMemory (counter-proof)

A faithful replica of the published LongMemEval end-to-end QA
eval — ingest → recall → generate → **binary LLM-judge** → accuracy — wired to
**TheMemory**. Its purpose is a **counter-proof**: cross-validate
TheMemory's per-stage eval (extraction precision/recall ≈ 0.64/0.72) against an
independent, established end-to-end methodology.

## Result (real run — every number from an actual execution)

**Overall accuracy: 9/12 = 75.0%.**

| question_type | accuracy |
|---|---|
| multi-session | 2/2 = 100% |
| single-session-user | 1/1 = 100% |
| single-session-assistant | 1/1 = 100% |
| temporal-reasoning | 4/5 = 80% |
| abstention (`_abs`) | 2/3 = 67% |
| knowledge-update | 1/2 = 50% |
| single-session-preference | 0/1 = 0% |

Ingestion: 298 turns across 12 examples, **0 ingest errors**; recall returned the full
top-10 for 11/12 (one example had only 2 memories in scope).

## Sample transcripts (inspectable — not a black box)

**Hits:**
- *"What was the first issue with my new car after its first service?"* — gold "GPS system
  not functioning correctly" → TheMemory: "the GPS system, on March 22" → **yes**.
- *(abstention)* *"How long have I been working before my current job at Google?"* — gold
  "not enough info (haven't started at Google yet)" → "I don't have that information" → **yes**.

**Misses (the actionable findings):**
- *(abstention)* *"Which did I complete first, fixing the fence or buying three cows from
  Peter?"* — gold = abstain (the cow purchase was never mentioned) → TheMemory asserted
  "fixing the fence first" → **no**. Recall correctly lacked the cow fact; the **answerer
  failed to abstain** (hallucinated a confident answer).
- *(knowledge-update)* *"personal best time in the charity 5K?"* — gold 25:50 → TheMemory
  27:12 → **no**. The **updated** PB was not surfaced above the older value (most-recent-wins
  recall limitation).
- *(single-session-preference)* Adobe-Premiere-Pro preference rubric not recalled → model
  abstained → **no**.

## Interpretation

75% end-to-end **corroborates** the per-stage eval. A system whose extraction scores
precision/recall ≈ 0.64/0.72 landing at 75% end-to-end QA is coherent — and the failure
modes are exactly what imperfect extraction/consolidation produce (wrong value on a
knowledge-update, a missed nuanced preference), not random noise. **The per-stage eval is
not lying**: it measures something that manifests in real behavior. The counter-proof also
surfaced two limitations the per-stage eval does NOT catch — **answerer abstention
discipline** and **knowledge-update recency** — which only an end-to-end eval exposes.

## Honest disclosure (REQUIRED READING)

- **Model = `openai/gpt-4o-mini`**, a small/cheap model. This number is **NOT
  leaderboard-comparable** to any published figure — different model, different dataset,
  freshly dim-migrated DB. It measures whether *TheMemory* answers LongMemEval questions.
  It is not a comparison against any other system.
- **Subset N = 12**, deterministic (first-match per bucket: 3 `_abs` + temporal×2 +
  multi-session×2 + knowledge-update×2 + single-session preference/user/assistant×1). Small
  N → single-example per-type cells (e.g. 0/1 preference) are not statistically meaningful
  in isolation.
- **Ingestion cap = 40 turns/example** (median oracle haystack ≈ 23 turns, so the cap bit
  only the largest); `temperature=0` for both answerer and judge; judge = the standard binary
  rubric with the anti-"no"-bias check.
- Dataset = `longmemeval_oracle.json`, supplied out-of-tree (not committed). The harness
  SKIPs cleanly when the dataset or the LLM key is absent.

## Reproduce

```bash
# .env.local: OPENAI_API_KEY=<sk-or-…> + OPENAI_BASE_URL=https://openrouter.ai/api/v1 + OPENAI_CHAT_MODEL=openai/gpt-4o-mini
export THEOMEM_PG_URI=postgresql://themem:themem@localhost:5442/themem
pnpm --filter @usetheo/memory-eval eval:e2e-qa      # key-gated; SKIPs cleanly without a key
```

Harness: `packages/eval/src/stages/e2e-qa/` (`run.ts` 4-phase, `prompts.ts` answer+judge,
`longmemeval-loader.ts` Zod loader + deterministic subset, `report.ts` aggregation).
Run date: 2026-07-25. Cost: ~US$ few cents (gpt-4o-mini, N=12, oracle haystacks).
