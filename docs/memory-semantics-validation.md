# Memory semantics validation

The live extraction gate completed on 2026-10-29 using OpenRouter's
`openai/gpt-4o-mini`, temperature 0 and maximum output 1200 tokens. It exercised the actual
SDK extraction, durability filtering, quote validation, embedding and in-memory persistence.
Embeddings were deterministic test vectors; Postgres behavior is validated separately.

There are 60 version-2 fixtures, 30 Portuguese and 30 English, each run three times: 180
slots. They cover explicit preferences, inferred patterns across independent sessions,
hypotheticals, passing moods, events, purchases/returns, assistant suggestions and updates.

| Gate | Required | Observed |
|---|---:|---:|
| Precision | ≥90% | 92.21% |
| Recall | ≥85% | 92.03% |
| Evidence classification on covered expectations | ≥90% | 100% |
| Forbidden permanent preferences | 0 | 0 |
| Invented persisted quotes | 0 | 0 |
| Unresolved errors | 0 | 0 |

The run made 213 provider calls, including language normalization calls and one transport-only
recovery. Reported usage was 409,931 input tokens and 17,196 output tokens; cumulative run
time was 625,543 ms. No monetary total was calculated because no tariff was configured.
Usage from a disconnected response may be unreported and must not be represented as billing.

The first full run after event-classification fixes had one `terminated` network response.
Recovery preserved the other 179 quality results verbatim and retried only that failed slot
once, requiring the same corpus/model/settings and extraction prompt digest. Quality failures
are never resampled by resume. Earlier tuning runs remain separate artifacts, not successful
slots silently substituted into the final run.

Local raw artifacts (ignored by git) are `benchmarks/results/memory-semantics-events.json`
and `benchmarks/results/memory-semantics-validated.json`. The latter SHA-256 is
`596dd767d2efb50743b3f38f2181635e777608ea95e49c2bc90050a40bfb6079`.
Fixture SHA-256: `4e9a70bc0d882db8532b6e195b0ac2a93411f30097675547b637b85cbb2ce06e`.
The report records prompt digests and base commit
`7cb58ee07d7cdb3808c85111d429721ea18d4f69`, with `workingTreeDirty:true` because the
implementation was validated before committing. Raw report rows contain fixture text, not
production data. Preserve artifacts with a release when reproducibility is required.

Run deterministic checks without provider credentials:

```sh
pnpm --filter @usetheo/memory-eval exec vitest run --config vitest.config.ts --maxWorkers 4
```

Run a fresh full live evaluation explicitly (uses the configured provider and incurs usage):

```sh
pnpm --filter @usetheo/memory-eval run eval:memory-semantics
# Optional: explicit tariff; no default prices are inferred.
export THEOMEM_EVAL_TARIFF='{"currency":"USD","inputPerMillion":0.15,"outputPerMillion":0.60}'
# Optional: resume only eligible transport failures from a complete report.
THEOMEM_EVAL_RESUME=benchmarks/results/memory-semantics.json \
  THEOMEM_EVAL_OUTPUT=benchmarks/results/memory-semantics-resumed.json \
  pnpm --filter @usetheo/memory-eval run eval:memory-semantics
```

The tariff above illustrates the JSON shape, not a verified provider price. Estimates use
reported tokens and explicitly exclude unreported usage. Subset runs via `THEOMEM_EVAL_CASES`
are diagnostic and are marked incomplete; they do not replace the full-corpus gate.

The corpus is hand-authored and paraphrase matching is regex-based. These metrics measure
this model/configuration on this corpus, not arbitrary multilingual quality, calibrated
confidence, production latency or immunity to future model changes. Deterministic CI tests
exercise the gates even when a provider is unavailable.

## Implementation verification

The final local validation also completed:

- Workspace build and root TypeScript contract checks; eval consumer typecheck against built declarations.
- Main contract suite: 1,591 passed, three skipped; no type errors.
- Related Postgres integration coverage: 73 tests across evidence, expiry/cache, graph,
  promotion, migrations and durable jobs (72 in the combined run, plus the additional
  `--once` SIGTERM case; all 16 durable-job tests passed together afterward).
- Fresh installation and upgrade from migration 0034, preserving legacy null provenance.
- Real child-process SIGKILL after saved drafts and during an uncommitted write, then recovery.
- Actual compiled CLI SIGTERM drain in continuous and `--once` modes, using a controlled
  HTTP provider for deterministic lifecycle verification.
- Standalone wishlist example with local transformer embeddings and real OpenRouter
  extraction, a new context process, exact miss, idempotent replay and elapsed 60-second expiry.
- OpenAPI validation with Swagger Parser, CLI help and package dry-run containing the new
  runtime modules and migrations.
- ESLint completed with no errors; six pre-existing import-order warnings remain in
  `cleanup-write-quality.ts` and the retrieval pipeline. `git diff --check` passed.

The eval package's full deterministic suite passed 54 tests with seven skipped; the added
corpus-balance check passed in the final seven-test memory-semantics run. Skipped optional
provider/database evaluations are distinct from the explicit live 180-slot run above.

## Final audit rerun

After the final workspace changes, the 180-slot live evaluation was run again on 2026-10-29.
It passed all gates: precision 92.76%, recall 93.48%, classification 100%, zero forbidden
preferences, zero invalid quotes and zero errors. It used OpenRouter `openai/gpt-4o-mini`,
214 provider calls, 410,057 reported input tokens, 17,160 output tokens and 485,098 ms elapsed.
No tariff was configured, so this run has no dollar estimate. Its full ignored report is
`packages/eval/benchmarks/results/memory-semantics-final-audit.json`; SHA-256:
`41d9ca49e12e63f40f2cae9c99ddc98ba0020e3a3e25ee09ea49c9b1d605904a`.
The fixture digest matches the earlier full run. The report marks the workspace dirty because
this implementation has not been committed; prompt digests, model, fixture digest and slot
results are recorded for review.
