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

The criteria were written down before any code or run, in the maintainer's working notes, which
are not in the repository; this section is the versioned record of them and of the result. A new
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

Evidence: criteria H25 to H27 were written down before the code, in the same working notes, and a
second hand-written case set (`cases-paraphrase.json`, 4 users) was committed before the
implementation. In one run over both sets (9 users, 42 questions), among paraphrased questions
extraction lost, the hybrid list held the answer in 19 of 20 and the BM25 list in 4 of 20; among
lexical ones, 15 of 15 for both. `recall` was unchanged in 42 of 42.

The 60% bar of H25 turned out weak: scopes in these sets hold 6 to 11 messages, so 5 random
messages would contain the answer about 61% of the time. Top-1 is the stronger reading, recorded
after the fact rather than as a criterion: the answer ranked first in 11 of 20 lost paraphrases,
against about 2.5 expected by chance, with a mean reciprocal rank of 0.71. A test with large scopes
and distractor turns is still to come before any claim beyond these sets.

### Large scopes (same day)

With 300 distractor messages added to every user's log (criteria H28 to H30, fixed before the
data was generated), the hybrid list held the answer in 9 of 20 lost paraphrases, below the 60%
bar; BM25 alone held 2 of 20. Lexical questions stayed at 15 of 15 and `recall` was unchanged.
The search is therefore not claimed to find paraphrases in large scopes.

A diagnosis after the run located the loss in the fusion, not in the embeddings: ranked by
cosine alone, the answer came first in 14 of the 20 and within the top 5 in 19. BM25 returns
every message sharing any word with the query, and under RRF a message present in both rankings
outranks one present only in the cosine ranking, even when the latter ranks first there. A change
to the fusion has to be judged on new questions with its own criteria, since it was conceived
from these.

### Windowed fusion (same day)

Each ranking now contributes only its first `limit` messages to the fusion. The per-ranking
window is the mechanism Elasticsearch's RRF retriever exposes as `rank_window_size` (its default
is 10); setting it equal to the requested list size was chosen before measuring and not fitted. Judged only on a new case
set written before the change (`cases-fusion.json`, 4 users, with the same 300 distractors):
lost paraphrases 10 of 11 (BM25 alone 0 of 11), lexical 3 of 3 for both, `recall` unchanged in 15
of 15. On the earlier sets, recorded but not used to decide, lost paraphrases went from 9 of 20 to
19 of 20.

The ordering inside the list stays weak: the answer ranked first in 2 of 11 on the new set. With
a window of 5, the first item of each ranking scores 1/61, and the tie breaks on message id,
which carries no meaning, so a word match often sits above the match by meaning.


### Tie-break by meaning, rejected (same day)

The guess above was wrong. Breaking fused ties on cosine distance instead of message id was tried
against criteria fixed beforehand, on a fourth held-out set (`cases-tiebreak.json`, 300
distractors per user). The answer ranked first in 2 of 11 lost paraphrases, against a bar of half,
so the change was reverted. On `cases-fusion.json` the ranks did not move at all (2 of 11, MRR
0.42).

The rankings show why. In 8 of the 11 questions the first message is the user's own turn that
raised the problem ("My glasses keep fogging up when I wear a mask."); the answer ranked second or
third in 8 of the 11, first in 2 and fifth in 1. That turn is the closest text to a paraphrased question, so it wins on meaning as well
as on rank; no tie is involved. Coverage stayed at 11 of 11 lost paraphrases (BM25 alone: 0), and
recall was unchanged in all 15 questions.

The search treats each turn as a separate document, while the answer lives in the reply to the turn
that matches. Fixing the order means returning or scoring the exchange (the matching turn with its
neighbour), not reordering single turns. That is a separate change, not made here.

### Surrounding turns (same day)

`searchMessages` takes `surroundingTurns` (0..5, default 0). With it, every result carries the
turns logged just before and after it in the same stream (workspace, user, session, agent), in
logging order, under `asOf`. Ranking and scores do not change. The same option is on the REST
endpoint (`surroundingTurns` query parameter, `surrounding` on each item) and on the
`search_messages` MCP tool.

Measured against criteria fixed beforehand, on a fifth held-out set (`cases-context.json`, 300
distractors per user), over five runs with a fresh database each. The protocol was amended after
the first two runs and before the five, because a single run was not enough (see below); the
first two runs do not count.

| Lost paraphrases (8 per run) | Result |
|---|---|
| Answer in the first result of the list, or in its surrounding turns, `surroundingTurns: 1` | mean 5 of 8 (4 to 6) |
| Answer in the first result, no surrounding turns | mean 2.4 of 8 |
| Answer anywhere in 2 results with surrounding turns, against a flat list of 6 | 8 of 8 against 8 of 8 in every run, with 42 to 44 messages read against 48 |
| `recall` unchanged by the search | 16 of 16 in every run |

Two limits came up while measuring. First, the first result depends on the run: the first place
of each ranking scores 1/61, and the tie falls on the message id, a random UUID. Two identical
runs gave 6 and 3 of 8 for the same reading. Second, the fusion window follows `limit`, so the
first result of `limit: 1` and the first of the default list of 5 can differ.

The log does not know where a conversation ends, so the first turn of one conversation can bring
the last turn of the previous one.

The lookup groups results by stream and names each stream column with `=` or `IS NULL`, so it
reads only that stream through `memory_messages_scope_seq_idx`. A first version compared the
columns with `IS NOT DISTINCT FROM`; `EXPLAIN` showed the index used for the workspace only, with
every other user's messages read and filtered. A second version still sorted the stream's whole
range on each side; ordering by every index column instead of `seq` alone lets the planner walk
the index and stop after `surroundingTurns` rows. On a 50,000-message stream that took a lookup
from 20 ms to 0.15 ms.
