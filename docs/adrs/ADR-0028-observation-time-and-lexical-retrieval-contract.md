# ADR-0028: Observation time, BM25 keyword search and access bookkeeping

Status: Implemented

## Context

Three parts of the store contract did not do what their names said.

`t_valid` was always the column default `now()`. A conversation imported a year after it
happened was valid from the import, so `recall({ asOf })` could not answer what was true at
the time, and `MemoryItem.tValid` was synthesized from the read time or `created_at` instead
of being read from the row. The extractor also had no date to resolve "last Friday" against.

`VectorStore.keywordSearch` in Postgres used `plainto_tsquery`, which requires every query
term in one row. On 200 sampled LoCoMo questions it returned no rows for 91% of them. Its
score was `ts_rank`, which has no inverse document frequency and sits far below the range the
recall pipeline's sigmoid normalization is centered on. Candidates found only lexically
entered recall with semantic similarity 0.

`PgvectorStore.search` incremented `access_count` for every row it returned, including the
recall over-fetch and the write path's duplicate lookup, so memories nobody received looked
recently used to the forgetting policy. Concurrent recalls over the same rows deadlocked and
lost their increments.

## Decision

`RememberOptions.observedAt` declares when the messages were sent. It becomes the row's valid
time (`t_valid`); `created_at` remains the transaction time. When a duplicate fact is
confirmed, `t_valid = LEAST(existing, new)`: a fact is valid from its earliest observation, so
importing history out of order cannot move it later. An instant more than five minutes in the
future is rejected. Writes without `observedAt` keep their previous idempotency hash. The
extraction prompt receives the observation date and resolves relative time against it.

`keywordSearch` returns Okapi BM25 scores with the Lucene IDF, `k1 = 1.2` and `b = 0.75`,
computed over the rows the search is scoped to, from the english-stemmed lexemes of
`to_tsvector`. Matching is disjunctive. These are the published defaults; they were not fitted
to any dataset. One pure function (`domain/retrieval/bm25.ts`) defines the formula, the
in-memory store uses it, and the Postgres query implements the same formula, with conformance
tests for IDF ordering and score scale. `keywordSearch` takes the query vector and reports
`VectorStoreResult.similarity`, so lexical-only candidates face the same semantic threshold as
any other.

Access is counted only for what recall returns, through the optional
`VectorStore.recordAccess(ids)`, which locks rows in id order before updating.

## Consequences

Measured on the existing LoCoMo database without any LLM call (2026-11-07, 1,536 questions),
evidence recall at 30 went from any 0.835 / all 0.701 to 0.860 / 0.715. The gain is
significant for questions whose evidence is one turn (categories 2 and 4, McNemar p = 0.004 and
p < 0.001). For questions that need several turns (categories 1 and 3), all@30 fell from 0.394
to 0.351 and from 0.467 to 0.402, not significant (p = 0.073 and p = 0.180). The likely cause
is lexically similar facts crowding the top 30, which is a diversity problem and is not
addressed by retuning these parameters. No validation outside LoCoMo has been run yet.

Postgres keyword search scans the scope's rows; there is no full-text index on
`memories.text`. A benchmark that counted the over-fetched neighbourhood as read
(`kit-recall-parity`) now counts only returned memories, and the earlier "79% never read"
figure derived from the inflated signal was withdrawn from the kit README.
