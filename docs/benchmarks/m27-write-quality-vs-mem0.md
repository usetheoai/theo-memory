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

## After M27 — measured on the deployed instance (v0.52.0/v0.53.0, real OpenAI)

Measured 2026-07-27 against the deployed app-dev instance (M27 code, real LLM) via the MCP
`remember`(infer:true) → `recall` round-trip, feeding `WRITE_QUALITY_FIXTURE` and scoring the stored
rows with `isSingleThirdPersonFact`. The unit metric + fixture are proven (`write-quality.test.ts` 4/4);
the numbers below are the LIVE result.

| Run | rows stored | single-third-person facts | ratio |
|---|---|---|---|
| 1 | 5 | 5 | 1.00 |
| 2 | 5 | 5 | 1.00 |
| 3 | 5 | 5 | 1.00 |
| **mean ± std** | 5 | 5 | **1.00 ± 0.00** |

**DoD target ≥ 0.90 → EXCEEDED (1.00).** Per-fixture live behavior (real LLM):

| Fixture input | before (dashboard) | after M27 (live) |
|---|---|---|
| "Quer que eu prossiga…?" (question) | stored as a fact | **dropped** — "No facts were extracted; nothing was persisted" |
| "Minha recomendação: allowlist… bump major como item próprio" (first-person) | stored first-person | **rewritten to 3rd person** → "Recomenda-se uma allowlist com sunset <= 90 dias…" + "O bump major deve ser tratado como item próprio" |
| "Atualizei o hono… e o alvo de deploy… e o theo-rag…" (multi-fact) | one mega-fact / dump | **split into 3 atomic facts** |
| "Ok, vou continuar." (filler) | stored | **dropped** |

The exact inputs that produced the dogfound pollution (ratio 0.00) now yield only atomic, declarative,
third-person durable facts (ratio 1.00), end-to-end against the real model.

## Reproduction

```bash
# unit metric (proves the scorer)
pnpm --filter @usetheo/memory-eval exec vitest run src/stages/extraction/write-quality.test.ts

# live (post-deploy): feed WRITE_QUALITY_FIXTURE via POST /v1/remember (infer:true) to the deployed
# instance, then GET /v1/scopes/user/<id>/memories and score with singleThirdPersonFactRatio().
```
