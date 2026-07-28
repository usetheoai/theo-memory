# M23 — Knowledge-update supersession (#144)

Deterministic, keyless evidence that a same-fact update expressed with **different
wording** ("My personal best … is 27:12" → "My PB is now 25:50") is caught by
**write/reflect-time LLM supersession**, so recall returns the fresh value — where the
M22 read-time `recencyCollapse` (cosine @ 0.9) structurally cannot.

The M22 mistake (a unit fixture that passes on near-identical stub vectors while the
real case fails) is **not** repeated here: the fixture uses the two REAL sentences with
**frozen real `LocalTransformerEmbedder(384)` embeddings**, and the supersession cases
run against **real pgvector** (the only runtime where `t_invalid` exists).

## T1 — empirical grounding (real embeddings, keyless)

Measured with the real `LocalTransformerEmbedder(384)` (Xenova/all-MiniLM-L6-v2,
mean-pooled + L2-normalized), frozen into
`packages/eval/src/stages/knowledge-update/golden-embeddings.ts`:

| Pair | Cosine | Consequence |
|---|---|---|
| `older` "…personal best …27:12" vs `newer` "My PB is now 25:50" | **0.5117** | ≪ 0.9 → read-time `recencyCollapse` **cannot** collapse the paraphrase |
| `query5k` vs `older` (stale 27:12) | **0.6013** | stale **out-ranks** fresh (the #141/#144 bug on real embeddings) |
| `query5k` vs `newer` (fresh 25:50) | **0.2747** | fresh is crowded out |
| `googleRole` vs `googleTenure` (same entity, diff attribute) | 0.6478 | precision pair that must survive |

**Consolidation cluster size for the fixture pair = 2** (both rows are `kind='extracted'`,
`t_invalid IS NULL`) → ≤ `clusterCap` (20), so `LlmJudgedMergeConflictPolicy` reaches the
judge with **no silent abstain**. See T3 below for the realistic-scale caveat.

## T2 — deterministic keyless fixture (3 cases)

`pnpm --filter @usetheo/memory-eval test` (LLM stubbed — **no API key**). The
`t_invalid` cases are gated on `THEOMEM_PG_URI` (real pgvector) and SKIP cleanly without
a DB, per the repo convention; the read-time counter-proof is in-memory and always runs.

| Case | Runtime | Assertion | Result |
|---|---|---|---|
| `test_readtime_recencycollapse_still_returns_stale` | in-memory | `recall({ recencyCollapse: {} })` STILL returns the stale `27:12` | **RED for read-time** (stale survives — read-time cannot fix wording drift) |
| `test_reflect_supersedes_diff_wording_update_returns_fresh` | pgvector | after `reflect({ conflictResolution: LlmJudgedMerge })` (stubbed judge): stale row `t_invalid` SET; `recall` returns `25:50`, not `27:12`; 1 `consolidation_history` row | **GREEN** (reflect moves the real case) |
| `test_reflect_does_not_supersede_same_entity_diff_attribute` | pgvector | Google role vs tenure → judge abstains → both survive | **GREEN** (precision guard) |

### RED → GREEN (same real strings)

```
BEFORE reflect — recall({recencyCollapse}) → [
  'My personal best time in the charity 5K run is 27:12',   ← stale, ranked FIRST
  'My PB is now 25:50',
]
AFTER  reflect — memories: stale row t_invalid = SET
AFTER  reflect — recall → [ 'My PB is now 25:50' ]           ← fresh only
```

Run: `THEOMEM_PG_URI=postgresql://themem:themem@localhost:5442/themem pnpm --filter
@usetheo/memory-eval test` → **7 passed** (M22 fixture preserved). Without the DB env →
4 passed, 3 skipped.

## T3 — consolidation-cluster bound: SKIPPED (documented)

Per ADR D2 (YAGNI — do not build the bound speculatively): the fixture cluster is **2**
(≤ `clusterCap` 20), so the supersession is reachable without any bound. **T3 is not
built.**

Honest scaling disclosure for the real bench (below): a realistic e2e-qa conversation
(`TURN_CAP = 40` turns, `infer: true`) produces **> 20** live `extracted` rows in one user
scope, and `LlmJudgedMergeConflictPolicy` **abstains** (no LLM call) above `clusterCap`
(`llm-judged-merge.ts:95`). The blueprint's suggested fix — a semantic top-k bound around
each candidate — is **not guaranteed** to co-locate the cos-0.51 different-wording pair
(they are cosine-far), so building it now risks its own false-fix. It is deferred to a
follow-up gated on the real-LLM bench actually showing the abstain blocks the case.

## T4 — e2e-qa harness wires reflect

`packages/eval/src/stages/e2e-qa/run.ts` now calls
`reflect({ conflictResolution: LlmJudgedMergeConflictPolicy })` in Phase 1.5 (after ingest,
before recall). Reflect fails LOUD (surfaces the error, never fabricates a supersession)
and the example proceeds on the un-consolidated state so the bench measures the honest
outcome. The harness stays key-gated (SKIPs without `OPENAI_API_KEY`).

## Bench (real LLM) — TODO (orchestrator)

Per ADR D3 the bench is honest real-case validation, not the CI gate. Re-run
`pnpm --filter @usetheo/memory-eval eval:e2e-qa` (real key + `THEOMEM_PG_URI`) and record
whether `6a1eabeb` moves from `27:12` to `25:50`. **If it does not move** (e.g. the > 20-row
scope makes the judge abstain per T3, or gpt-4o-mini does not judge it a contradiction),
say so — do not paper over.

| Metric | Baseline (M22) | With reflect wired | Notes |
|---|---|---|---|
| `6a1eabeb` returns gold `25:50` | no (`27:12`) | _TODO_ | orchestrator, real LLM |
| overall N=12 accuracy | 11/12 | _TODO_ | illustrative |

## Real-LLM bench outcome (E2E_QA_REFLECT=1, gpt-4o-mini) — HONEST: reflect made it WORSE

Ran the e2e-qa bench (N=12) with `reflect({ conflictResolution: LlmJudgedMerge })` wired
in (Phase 1.5, real gpt-4o-mini). **Result: 10/12 = 83.3% — a NET REGRESSION vs the
default (M22 run: 11/12 = 91.7%), and the target `6a1eabeb` did NOT move (still `27:12`).**

| Signal | Outcome |
|---|---|
| **Target `6a1eabeb` (knowledge-update)** | STILL FAILS — returns stale `27:12`. Reflect ran without throwing but did NOT supersede (the real conversation cluster > `clusterCap` 20 → `LlmJudgedMerge` abstains, OR the LLM did not judge the paraphrase as a contradiction). |
| **Net accuracy** | 91.7% → **83.3%** (−1 example). `0a995998` (multi-session) regressed True→False — reflect superseded a fact that was needed (false supersession / precision loss). |
| **Reflect errors** | `ReflectionProvenanceMissingError: draft.derivedFrom references unknown ids` thrown on 2 real clusters (`6d550036`, `e47becba`) — caught (fail-loud, example proceeds), no verdict change, but a genuine reflect-robustness bug on real data. |

### Conclusion (no false-fix, no shipped regression)

Whole-scope reflect wired into the bench is **NOT** the #144 fix: it abstains on the real
target, regresses precision on another, and surfaces a reflect bug. Therefore the harness
reflect is **OPT-IN (default OFF)** — the bench default stays at the honest 91.7% with no
regression. The deterministic fixture (above) proves the supersession MECHANISM on a
bounded cluster; making it move the real case end-to-end requires **bounded / per-write
consolidation** (retrieve top-k related on each `remember`, judge ADD/UPDATE/
DELETE) so the contradiction pair reaches the judge without abstaining — a larger effort,
filed as a follow-up. The `ReflectionProvenanceMissingError` on real clusters is filed
separately. **#144's read-time symptom is proven unfixable at read time; the write-time
mechanism is proven in isolation; the production-viable end-to-end fix is tracked, not shipped as a false green.**
