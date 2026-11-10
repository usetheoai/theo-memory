# ADR-0029: Supersession on write

Status: Implemented

## Context

When a fact changed ("I live in Porto", later "I moved to Lisbon"), both memories stayed
current. Recall returned the old and the new value side by side, and only a `reflect` with a
conflict-resolution policy (v0.7) or the read-time `superseded_recency` drop could separate
them; neither changed what the store held as true. Under ADR-0003 the write path only adds,
and a correction meant `forget(id)` plus `remember(newText)`, which a caller rarely does and
an agent cannot do for facts it never listed.

The extractor could not have flagged the old fact anyway. It was shown the five most recent
memories of the scope, so a fact older than the last five writes was invisible to it.

## Decision

The extractor sees the `SIMILAR_MEMORY_COUNT` (10) existing memories of the scope most similar
to the new messages instead of the five most recent. The number follows the update phase of
Chhikara et al., "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory"
(arXiv:2504.19413, section 2.1: "s = 10 similar memories for comparative analysis"). It was
not chosen by measuring any benchmark. It costs one extra embedding call per write.

The extraction schema gains `supersedes_memory_ids`. The prompt asks the extractor to list an
existing memory only when the new fact gives the same attribute of the same subject a
different value, and to list nothing when in doubt. The output format names the field next to
`linked_memory_ids`, which is reserved for memories that stay true: with the field only in
the directive, a real model never filled it and put the replaced id in `linked_memory_ids`
(0 supersessions over 76 LongMemEval knowledge-update questions). Only ids the prompt showed
are accepted; anything else is dropped as `supersession_rejected`.


A replaced memory is never deleted. The store sets its `t_invalid` to the new fact's valid time
(`observedAt`, or now) and records `superseded_by_memory` in its payload, through the new
optional `VectorStore.supersede`. The memory leaves current recall, and `recall({ asOf })`
before the change still returns it, as the graph variant in the same paper does ("marking them
as invalid rather than physically removing them"). Only facts the store confirmed persisting
can supersede. The store refuses memories outside the scope, already invalid, or valid after
the new observation, so importing history out of order cannot hide a newer fact; refusals are
`supersession_skipped`.

Every replacement is a `history` row with action `supersede` and both texts, a
`memory_superseded` event, and `MemoryItem.supersedes` on the returned item (REST returns it,
the MCP `remember` tool names the replaced ids). A failed invalidation after the facts
committed leaves the old memory current and emits `supersession_failed`.

The durable job path stages the request and applies it in the commit transaction, with
`t_invalid` set to the transaction's own `now()`, which is also the new fact's valid time.

On by default (project owner, 2026-11-07); `createLocalMemory({ supersedeOnWrite: false })`
turns it off.

## Alternatives considered

- Opt-in. Rejected by the project owner: contradictory facts would stay current for every
  consumer who did not find the switch.
- A second LLM call that compares each new fact with the memories most similar to it that the
  extractor was not shown. Tried and removed. On the paired LongMemEval knowledge-update run it
  invalidated 301 memories in 61 of 76 questions and lowered correct answers from 56 to 43 of 72
  (exact McNemar p = 0.011). In a sample of 40 invalidations, 13 removed a fact that was still
  true ("met David" replaced by "met Michael"), 13 replaced a paraphrase and 12 were right. The
  extractor alone recorded 2 supersessions on the same run, so its reach stays a known limit.
- An `attribute_key` per fact (`user.home_city`), stored in the payload and shown next to
  existing memories, so that a new fact with the key of a shown memory replaces it without a
  comparison. Tried and removed. With the key optional, a real model set it on 4 of 2,720
  memories over the 76 knowledge-update questions and no supersession came from one; made
  required (a key or null), it set 36 of 2,697 and caused 3 supersessions, against a threshold
  of 10 fixed before the run. Correct answers were 52 against 55 without it (p = 0.63). Replaying
  the write path's similarity search had shown that the stale memory was among the 10 the
  extractor saw in 5 of 6 cases, so the limit is the model's judgment, not its reach.
- Finding candidates by shared entity instead of embedding. Rejected: the subject of most
  personal facts is the user, who is not an extracted entity, so "lives in Porto" and "moved to
  Lisbon" share none.
- Deleting the replaced memory, as the paper's DELETE operation does. Rejected: it destroys
  the history `asOf` exists to answer, and a wrong judgment could not be undone.

## Consequences

ADR-0003 still holds for the public API: there is no `update` verb, and every change is a new
memory plus an invalidation that history records. What changes is that the write path may
invalidate, which only `forget`, eviction and `reflect` did before.

A wrong judgment hides a true memory from current recall. It stays in the store, in `history`
and under `asOf`, so it can be found and restored by remembering it again. `HistoryAction`
gains `supersede`, which breaks exhaustive switches over it (pre-release). The verbatim
`infer: false` path does not extract and never supersedes. A memory created with
`historyManager: undefined` records the event but no history row; over Postgres,
`createLocalMemory` configures one by default (#236). On the paired run above, supersession by
the extractor fired twice in 76 questions and did not change the score.
