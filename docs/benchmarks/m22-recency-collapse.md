# M22 — Recall-time most-recent-wins collapse (#141) + harness abstention (#140)

Deterministic, keyless evidence for the recall-time most-recent-wins collapse that
closes the M21 LongMemEval counter-proof gap. No LLM key is required — every number
below comes from an in-memory run with a stub embedder.

## The defect (#141)

TheMemory is ADD-only (ADR-0003): an updated fact is a **new** `remember`, so two
live duplicates of the same fact coexist until `reflect` reconciles them. The recall
pipeline ranks by relevance only (`packages/core/src/domain/scoring.ts` has no recency
term), so a **stale** duplicate with higher semantic similarity can out-rank / crowd
out its **fresh** update. The M21 run returned the stale `27:12` instead of the updated
`25:50` (`docs/benchmarks/m21-e2e-qa-longmemeval.md`).

## The fix

An opt-in `RecallOptions.recencyCollapse?: { threshold? }` post-threshold stage
(`packages/core/src/domain/retrieval/recency-collapse.ts`). Over the bounded
post-threshold candidate pool, for every pair with cosine(embedding) ≥ τ (default
`0.9`) it keeps the one with the newest `createdAt` and drops the older as a
`superseded_recency` recall-trace drop (Princípio 3). It runs **after** the score
combine, so it cannot regress scoring (ADR D1); default OFF ⇒ recall is byte-identical
(non-regression guard `test_recall_byte_identical_when_recency_collapse_off`).

- Read-time only (honest disclosure): durable write-side supersession still needs
  `reflect`. This is a recall-ordering mitigation, not a write-time reconciliation.
- Mutually exclusive with `rerank`/`diversify`/`scopes` (`RerankerConflict`); bypasses
  the recall cache (ADR D3).

## Deterministic RED→GREEN (keyless)

Fixture: `packages/eval/src/stages/knowledge-update/` — `createLocalMemory` + the
in-memory store + a stub embedder mapping two ADD-only duplicates to near-identical
8-dim vectors, with an **injected clock** (`created_at` metadata, older strictly before
newer). The older row is made marginally MORE relevant to the query than the newer one,
so a recency-blind recall surfaces the stale value first — isolating the ranking claim.

| Recall | `recencyCollapse` | Top result | Result count | Trace drop |
|---|---|---|---|---|
| default (flag OFF) | — | `My charity 5K personal best is 27:12.` (**stale — RED**) | 2 | — |
| with collapse (flag ON) | `{}` | `My charity 5K personal best is now 25:50.` (**fresh — GREEN**) | 1 | `superseded_recency` on the `27:12` row |

RED capture (asserting the *newer* value on the flag-OFF path — MUST fail):

```
FAIL  src/stages/knowledge-update/_redproof.test.ts (temp)
  × default recall (no recencyCollapse) returns the NEWER value
  AssertionError: expected 'My charity 5K personal best is 27:12.' to contain '25:50'
```

GREEN (committed test `test_knowledge_update_recency_collapse_returns_newer_value`):

```
Test Files  1 passed (1)
      Tests  2 passed (2)   # newer value returned + valid StageScore (accuracy 1)
```

Reproduce (no key):

```
pnpm --filter @usetheo/memory-eval test src/stages/knowledge-update/run.test.ts
```

## #140 — abstention (harness, core-declined)

The M21 answerer over-committed (hallucinated) on related-but-insufficient recall.
Recall itself was **honest**. The blueprint declined a core `coverage`/`confidence`
field (YAGNI + DRY + the LOCKED "memory layer, NOT agent runtime" boundary): the
coverage signal already exists as `MemoryItemWithScore.score`. The fix is a pure
harness helper `shouldAbstain(items, τ) = items.length === 0 || max(score) < τ`
(`packages/eval/src/stages/e2e-qa/coverage-gate.ts`), wired before the answerer LLM
call, plus a strengthened answerer abstention rule. Unit-tested keyless
(`test_coverage_gate_abstains_on_empty_or_low_score`).

## Gates (this env)

- Core contract suite: `npm test` → **1373 passed, 3 skipped, 0 type errors**
  (+8 over the 1365 baseline; the byte-identical-OFF guard stays green).
- Eval suite: `pnpm --filter @usetheo/memory-eval test` → **26 passed, 1 skipped**
  (+4 over the 22 baseline: knowledge-update ×2, coverage-gate ×2).
- `npm run typecheck` → clean.
- `npm run lint` is **not runnable in this environment** (pre-existing
  `minimatch@3.1.5` vs `@eslint/config-array` breakage — fails on untouched files
  too); the `check_quality.py` pre-commit code-smell gate ran on every edit.
