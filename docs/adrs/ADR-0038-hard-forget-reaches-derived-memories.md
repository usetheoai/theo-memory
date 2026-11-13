# ADR-0038: A hard forget erases what was derived from the memory

Status: Accepted (2026-11-13).

## Context

`forget(id, { hard: true })` is the erasure path: it physically deletes the memory. Its own row,
its evidence, its history, the messages it came from (ADR-0027) and the graph edges it produced
already went with it.

Two things did not. A regression test written for this decision showed both (Observed):

- A memory produced by reflection lists its sources in `derived_from` and restates them in its
  text. After a hard forget of a source, the summary was still stored and still recalled, so the
  erased content stayed recoverable.
- A row of `consolidation_history` keeps a free-text reason for the decision, which can restate the
  memory it is about. The row was kept on purpose as an audit record, reason included.

A survey of the field for this work reports the same defect elsewhere: in one pilot most erased
facts were still recoverable through copies and consolidated memories, and in two consumer
assistants deleting a conversation does not delete the memory derived from it (Reported; the notes
are in the working tree, not in the repository).

## Decision

A physical delete of a memory, on any path, also:

- deletes every memory of kind `derived` in the same workspace whose `derived_from` lists it. The
  rule applies again to each deleted summary, so a summary of a summary goes too;
- replaces with `[erased]` the reason of every `consolidation_history` row that names the memory
  as kept, as rejected, or among its original episodes. The row, its ids, its policy name and its
  date stay.

It is done by a database trigger (migration 0039), in the transaction of the delete, as the
erasure of source messages already is. The store counts what the delete will take and emits
`forget_reached_derived` with that count. The in-memory store applies the same rule.

A soft forget deletes nothing and changes none of this.

## Consequences

- A summary built from ten memories is deleted when one of them is erased. The other nine stay,
  and the next reflection can derive a new summary from them. Rewriting the summary without the
  erased source was not chosen: it needs a model call inside an erasure, and its output cannot be
  checked to be free of the erased content.
- The expiry purge is a physical delete too, so a summary derived from a passing state that
  expired is deleted with it.
- The audit row no longer says why a consolidation kept one memory over another once one of them
  is erased. That reason was the only place where the content survived by design.

## What this does not cover

- Consolidated skills. A skill derived from a deleted skill is not touched; skills have their own
  forget path and were not examined here.
- A fact extracted from the same message as the erased one keeps its text. The message is erased;
  the sibling fact is a different memory.
- An older value that the erased memory had replaced stays stored as ended. It is a different
  statement, and the request named one memory.
- Entities named after erased content are collected only by the existing rule, when no memory
  links to them any more.
- Copies outside the store: a caller's own logs, a model context, a recall cache held by a client.
  The recall cache of the store is invalidated for the scope, as before.
- Nothing here was measured on a real erasure request; the evidence is the regression test.
