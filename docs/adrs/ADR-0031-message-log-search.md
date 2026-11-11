# ADR-0031: Search over the raw message log

Status: Implemented

## Context

The raw message log (ADR-0027) keeps every message a write received, including turns that
produced no memory, but nothing searched it. Extraction keeps a lossy reading of a conversation:
a suggestion the assistant made, a detail mentioned in passing, or a plan stated as tentative is
often absent from the stored facts, and `recall` searches only facts. Once extraction drops it,
the system cannot answer from what was actually said.

Comparable systems keep the raw turns and search them apart from facts: an episode node with its
content searched by BM25 into a separate result list, or a message table behind a
conversation-search tool separate from archival memory.

## Decision

`ScopedMemory.searchMessages(query, { limit, asOf })` returns the scope's logged messages ranked
by Okapi BM25, best first, each with its score. It is a separate method, so `recall` and its
return type are unchanged. The ranking reuses the formula, `k1`, `b` and, on Postgres, the
`english` lexemes of `keywordSearch` (ADR-0028); no parameter was fitted. `limit` defaults to 5
and is capped at 100. Visibility follows `recall`: a user's global scope sees no session or agent
messages, and a user-bound session sees its own messages and the user's global ones. With `asOf`,
a message observed after that instant (or, without an observation time, logged after it) is left
out. A memory created with `messageLog: false` throws `MessageLogNotConfigured`.

The port gains `MessageLog.search(filters, query, { limit })`, held to the shared conformance
suite on the in-memory and Postgres adapters.

## Evidence

The criteria were fixed before any code or run (docs/benchmarks/m30-longmemeval-local.md). A new
hand-written evaluation (`packages/eval/src/stages/message-recall`, 5 users, 24 conversations, 27
questions, gpt-4o-mini and text-embedding-3-small over an isolated Postgres) stored 13 facts.
For 22 questions no stored fact held the answer. Among the 11 of those whose question repeats a
word of the answering turn, the 5-message list held the answer in 11. The fact list returned by
`recall` was identical before and after each message search in 27 of 27. Facts alone answered 5
of 27 questions; facts or messages answered 17.

## Alternatives considered

- A second list inside `recall` (`includeMessages`). Rejected: `recall` returns an array, so a
  second list would change its contract for every consumer.
- Merge messages into the fact ranking. Rejected: raw turns and extracted facts score on
  different scales, and a turn would displace the fact derived from it.
- Embed every message for semantic search. Deferred at first: the same evaluation answered 1 of
  11 paraphrased questions from messages, and that hit came from Portuguese function words
  matching under the `english` dictionary. Adopted later on its own criteria; see the amendment
  below.

## Consequences

As first shipped, the search was lexical only: a question that shares no word with the turn
rarely found it. Postgres uses the
`english` dictionary, so Portuguese text gets no stemming and its function words match, which
puts unrelated turns in the list. The search scans the scope's messages on each call, with no
index; that is linear in the scope's log size.

REST serves it as `GET /v1/scopes/{type}/{id}/messages/search` and MCP as the `search_messages`
tool, both bound to the acting user the same way as recall; the MCP isolation gate covers it
across workspaces and across users of one workspace.

## Amendment, 2026-11-11: embeddings and rank fusion

Each logged message stores its embedding (migration 0038, nullable, same dimension as
`memories.embedding`), computed with the memory's embedder in one batch per write; the durable
job path computes it in `prepare`, outside the commit transaction. With a query vector,
`MessageLog.search` fuses two rankings of the visible messages by Reciprocal Rank Fusion with the
published constant k = 60, unfitted: the BM25 ranking, and the cosine ranking of the messages that
carry an embedding. Both rankings break ties on message id, in both adapters. `searchMessages`
always embeds the query; an embedder failure throws, as in `recall`. On write, an embedding
failure keeps the message without a vector, emits `message_log_failed` (`operation: embed`), and
the message stays findable by its words. There is no ANN index: the scan covers one scope's
messages and gives exact ranks.

The list is now ranked, not filtered: with fewer matching turns than `limit`, neighbours by
meaning fill it, and `score` is the fused score instead of BM25.

Evidence: criteria H25 to H27 were fixed before the code (docs/benchmarks/m30-longmemeval-local.md),
and a second hand-written case set (`cases-paraphrase.json`, 4 users) was committed before the
implementation. In one run over both sets (9 users, 42 questions), among paraphrased questions
extraction lost, the hybrid list held the answer in 19 of 20 and the BM25 list in 4 of 20; among
lexical ones, 15 of 15 for both. `recall` was unchanged in 42 of 42.

The 60% bar of H25 turned out weak: scopes in these sets hold 6 to 11 messages, so 5 random
messages would contain the answer about 61% of the time. Top-1 is the stronger reading, recorded
after the fact rather than as a criterion: the answer ranked first in 11 of 20 lost paraphrases,
against about 2.5 expected by chance, with a mean reciprocal rank of 0.71. A test with large scopes
and distractor turns is still to come before any claim beyond these sets.

