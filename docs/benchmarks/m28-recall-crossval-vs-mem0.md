# M28 (#157) — recall A/B regression: speaker-referring queries vs mem0

**Metric:** precision@1 over the controlled 8-fact / 5-query cross-validation set (2026-07-27).
The one query that failed pre-M28 is Q5 ("Qual a profissão do **usuário**?") — the speaker fact is
stored under `user`, so a PT query with "usuário" matched an unrelated fact at top-1.

## Baseline (before M28) — measured live vs mem0

| System | P@1 | P@3 | Q5 top-1 |
|---|---|---|---|
| mem0 | 5/5 (1.00) | 5/5 | platform engineer ✓ |
| theo-memory (pre-M28) | **4/5 (0.80)** | 5/5 | café ✗ (profissão em #2) |

## After M28 (speaker-alias) — MEASURED LIVE (v0.54.0, real pgvector BM25 + real LLM)

Measured 2026-07-27 against app-dev (M28 deployed, publish 101fae0) via the MCP `recall` over the same
stored fixture. The speaker-alias appends the `user` token to the BM25 + entity match for
speaker-referring queries.

| System | P@1 | P@3 | Q5 top-1 |
|---|---|---|---|
| **theo-memory (M28)** | **5/5 (1.00)** | 5/5 | **user trabalha como engenheiro de plataforma ✓ (0.920)** |
| mem0 | 5/5 (1.00) | 5/5 | platform engineer ✓ |

**DoD met — P@1 = 5/5, now at parity with mem0.** Evidence (live scores):

| Query | before M28 top-1 | after M28 top-1 |
|---|---|---|
| Q5 "profissão do **usuário**?" | café (0.707) ✗ | **profissão (0.920) ✓** — jumped from #2 (0.520) |
| Q1 "que café o **usuário** gosta?" (also speaker) | café (1.00) ✓ | **café (1.00) ✓ — NO regression** (profissão rose to #2 but café still dominates on semantics) |
| Q2/Q3/Q4 (no speaker term) | correct | byte-identical query → unchanged, correct |

The speaker-alias fixed the failing query WITHOUT regressing the other speaker query (Q1) — the
conservative lexical-only, semantic-untouched design held.

## Reproduction
Write the 8 fixture facts + run the 5 queries via the theo-memory MCP; score top-1 vs the known
correct fact. Q5 must return "user trabalha como engenheiro de plataforma" at top-1.
