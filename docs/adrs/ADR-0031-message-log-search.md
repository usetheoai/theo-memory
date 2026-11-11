# ADR-0031: Lexical search over the raw message log

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
- Embed every message for semantic search. Deferred: the same evaluation answered 1 of 11
  paraphrased questions from messages, and that hit came from Portuguese function words matching
  under the `english` dictionary. Embedding is the next candidate, gated on its own criteria.

## Consequences

Lexical only: a question that shares no word with the turn rarely finds it. Postgres uses the
`english` dictionary, so Portuguese text gets no stemming and its function words match, which
puts unrelated turns in the list. The search scans the scope's messages on each call, with no
index; that is linear in the scope's log size.

REST serves it as `GET /v1/scopes/{type}/{id}/messages/search` and MCP as the `search_messages`
tool, both bound to the acting user the same way as recall; the MCP isolation gate covers it
across workspaces and across users of one workspace.
