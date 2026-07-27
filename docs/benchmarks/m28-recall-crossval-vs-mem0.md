# M28 (#157) — recall A/B regression: speaker-referring queries vs mem0

**Metric:** precision@1 over the controlled 8-fact / 5-query cross-validation set (2026-07-27).
The one query that failed pre-M28 is Q5 ("Qual a profissão do **usuário**?") — the speaker fact is
stored under `user`, so a PT query with "usuário" matched an unrelated fact at top-1.

## Baseline (before M28) — measured live vs mem0

| System | P@1 | P@3 | Q5 top-1 |
|---|---|---|---|
| mem0 | 5/5 (1.00) | 5/5 | platform engineer ✓ |
| theo-memory (pre-M28) | **4/5 (0.80)** | 5/5 | café ✗ (profissão em #2) |

## After M28 (speaker-alias) — measured live post-deploy

> The fix appends the `user` token to the BM25 + entity match for speaker-referring queries.
> Measured via the MCP `remember`→`recall` round-trip (real pgvector BM25 + real LLM) against the
> released build. Target: P@1 = 5/5; the other 4 queries must not regress.

| System | P@1 | P@3 | Q5 top-1 |
|---|---|---|---|
| theo-memory (M28) | _pending post-deploy_ | | _pending_ |

## Reproduction
Write the 8 fixture facts + run the 5 queries via the theo-memory MCP; score top-1 vs the known
correct fact. Q5 must return "user trabalha como engenheiro de plataforma" at top-1.
