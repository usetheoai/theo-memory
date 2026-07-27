# M27 — Write-quality parity vs mem0

**Metric:** single-third-person-fact ratio = (stored rows that are one atomic, declarative,
third-person fact) / (total stored rows), on a fixed transcript. Predicate is
`isSingleThirdPersonFact` (`packages/eval/src/stages/extraction/write-quality.ts`) — encodes the DoD
definition directly (atomic ≤ 200 chars · not a trailing-`?` question · not a first-person opener),
independent of the write-path gate (non-circular).

**Fixture:** `WRITE_QUALITY_FIXTURE` — the exact inputs that produced bad memories on the deployed
dashboard (session `93959d08`): an assistant question, a first-person recommendation, a multi-fact
narration, a filler acknowledgement.

**Method:** feed each fixture turn through the REAL extraction (`POST /v1/remember`, `infer:true`)
on the deployed instance (real OpenAI), read back the stored rows via `GET /v1/scopes/.../memories`,
compute the ratio. Run ≥ 3× for variance (mean ± std). The DoD target is ratio ≥ 0.90.

## Baseline (before M27) — measured from the dashboard

The dogfound pollution IS the before. The three problematic rows (question, first-person
recommendation, 400-word dump) score **ratio = 0.00** — none is a single third-person fact. This is
the state the milestone corrects.

| Set | rows | single-third-person facts | ratio |
|---|---|---|---|
| before (dashboard `93959d08` polluted rows) | 3 | 0 | 0.00 |

## After M27 — measured on the deployed instance

> Filled from the post-deploy dogfood run (real OpenAI). The unit metric + fixture are proven
> (`write-quality.test.ts` 4/4); the numbers below come from the live `POST /v1/remember` →
> `GET /v1/scopes` round-trip against the released build, run ≥ 3×.

| Run | rows stored | single-third-person facts | ratio |
|---|---|---|---|
| 1 | _pending post-deploy_ | | |
| 2 | _pending post-deploy_ | | |
| 3 | _pending post-deploy_ | | |
| **mean ± std** | | | **_pending_** |

## Reproduction

```bash
# unit metric (proves the scorer)
pnpm --filter @usetheo/memory-eval exec vitest run src/stages/extraction/write-quality.test.ts

# live (post-deploy): feed WRITE_QUALITY_FIXTURE via POST /v1/remember (infer:true) to the deployed
# instance, then GET /v1/scopes/user/<id>/memories and score with singleThirdPersonFactRatio().
```
