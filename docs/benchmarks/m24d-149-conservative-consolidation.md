# M24 + #149 bench — knowledge-update FIXED, reflect no longer crushes recall

Real-LLM e2e-qa run (LongMemEval harness → TheMemory) with **all three fixes** on:
`#148` (honest judge guard) + `#149` (conservative consolidation prompt) + M24 bounded
consolidation. `E2E_QA_REFLECT=1`, N=12 deterministic subset, `openai/gpt-4o-mini` via
OpenRouter, isolated DB `themem_e2e_qa` (dropped after), key gitignored + deleted.
Run 2026-07-25.

## Headline — an HONEST number (the old 91.7% was a judge illusion)

**8/12 = 66.7%**, measured with the `#148` guard so an abstention on a non-abstention
question scores NO. The previously-reported 91.7% was **fake** — the LLM judge had been
accepting `"I don't have that information."` as correct across the board.

| question_type | with #148+#149 | reflect-ON without #149 |
|---|---|---|
| temporal-reasoning | 5/5 | (all abstained) |
| **knowledge-update** | **2/2** | 0/2 |
| multi-session | 0/2 (abstain) | (abstained) |
| single-session-user | 1/1 | (abstained) |
| single-session-preference | 0/1 (abstain) | (abstained) |
| single-session-assistant | 0/1 (abstain) | (abstained) |

**reflect ON went from 25% (3/12, all substantive questions abstained — the #149 regression)
to 66.7% (8/12, real answers).**

## The decisive case — `6a1eabeb` (knowledge-update) — FIXED

```
question:    What was my personal best time in the charity 5K run?
gold:        25 minutes and 50 seconds (25:50)
modelAnswer: "Your personal best time in the charity 5K run is 25:50."   ← the FRESH value
correct:     true (genuine — the answer literally contains 25:50)
```

M22 returned the stale `27:12` (wrong); the fake M24 "YES" was an abstention artifact; **now
the model returns the fresh `25:50`**. Both knowledge-update questions pass (2/2).

## Why it works (and why the planned canonical-merge was unnecessary)

The root cause of the recall collapse (#149) was the consolidation judge prompt saying
"pick ONE fact to keep and reject the rest" — winner-take-all. Since `clusterByProximity`
(M24) groups *distinct* facts by proximity, the judge superseded distinct answer-bearing
rows (`t_invalid`), and recall lost them → the coverage-gate abstained on everything.

The **conservative prompt** (#149) makes the judge reject ONLY genuine stale duplicates of
the same attribute/subject; distinct facts are kept. So for `6a1eabeb` the judge correctly
supersedes the stale `27:12` as a stale version of the fresh "PB is now 25:50", keeps the
fresh row AND every distinct fact. Recall returns the full context (coverage-gate passes on
the surviving high-score rows), the answer LLM reads the fresh "25:50" in the memories block,
and answers correctly. No canonical text-merge was needed — conservative supersession +
answer synthesis suffices (KISS).

## The remaining failures are honest abstentions, not regressions

multi-session (0/2, gold "3"/"2" — cross-session counting), single-session-preference (0/1),
single-session-assistant (0/1) all **abstained** (coverage-gate) — hard aggregation/coverage
cases where no single memory answers. Abstaining beats hallucinating. These are candidates for
a future coverage-gate / multi-hop improvement, independent of #144/#149.

## Honest disclosure

- Model `openai/gpt-4o-mini`, a small/cheap model → NOT leaderboard-comparable.
- N=12 deterministic subset; single run. knowledge-update 2/2 is a strong signal (the
  answer literally contains `25:50`, not judge noise).
- The **no-reflect + #148** baseline is now measured (see § Addendum): 7/12 (58.3%) vs reflect+#149
  8/12 (66.7%), no regression (reflect-ON dominates, net +1). Note the honest attribution caveat in
  the Addendum — knowledge-update is answered in both configs by the newest-first answer-LLM, so the
  end-to-end bench does not isolate reflect's #144 contribution (the keyless T4 test does).
- Reproduce: `.env.local` with an OpenRouter key + run `packages/eval/.../e2e-qa/run.ts` from
  the repo ROOT (cwd — DATASET_PATH is cwd-relative) with `E2E_QA_REFLECT=1`.

## Addendum (2026-07-25) — no-reflect baseline + honest attribution correction

The no-reflect + #148 baseline (deferred earlier due to throttling) completed:

| config (with #148) | overall | knowledge-update | only diff |
|---|---|---|---|
| **no-reflect** | **7/12 (58.3%)** | **2/2** | — |
| **reflect + #149** | **8/12 (66.7%)** | **2/2** | +1 on `gpt4_2487a7cb` (temporal) |

**No regression (confirmed):** every question the no-reflect run answered correctly, the
reflect+#149 run also answered — reflect-ON strictly dominates (net +1). This positively
closes the earlier "no-regression delta not quantified" caveat.

**Attribution correction (Rule 3 — this softens an earlier over-claim):** knowledge-update
is **2/2 in BOTH configs**. The harness answer-LLM reads the recalled memories **sorted
newest-first** and sees BOTH `27:12` and `25:50` (recencyCollapse does not collapse the
cos-0.51 pair), so it answers the fresh `25:50` **with or without reflect**. Therefore the
END-TO-END bench does NOT isolate reflect's contribution to the #144 symptom — the answer-LLM
masks it. What IS proven and reflect-specific: (a) the **memory-layer** supersession — reflect
sets `t_invalid` on the stale row so a top-k recall returns ONLY the fresh value (keyless T4
`bounded-consolidation.pg.test.ts`), which matters for a naive top-1 consumer the bench's smart
answer-LLM does not represent; and (b) #149 prevents reflect from crushing recall (25% → 66.7%),
a genuinely reflect-specific regression fix; and (c) the net +1 end-to-end. So "reflect resolves
#144 end-to-end" should read: **the memory layer supersedes the stale (T4); the end-to-end symptom
is answered by the answer-LLM regardless of reflect; reflect is a net positive, not a regression.**
