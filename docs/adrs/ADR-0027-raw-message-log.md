# ADR-0027: Raw message log

Status: Implemented

## Context

A memory is the extractor's reading of a conversation, and that reading loses things. A
review of failed LoCoMo questions (2026-11-06) found facts with dropped clauses, lost event
times and wrong coreference: "Deborah met Jolene" stored from a turn about Anna. The extractor
saw only the new message pair and five existing facts, never the turns before it, so a new
turn that said "she" or "that class" could not be resolved. Once a fact was wrong, nothing in
the system kept what had actually been said: `memory_jobs.input` exists only for durable jobs
and is redacted after completion, and `memory_evidence` stores a quote chosen by the
extractor, not the message.

## Decision

Keep an append-only log of the raw messages every write receives, per scope, in Postgres
(`memory_messages`), and record which messages produced which memory
(`memory_message_sources`). Both tables carry the same fail-closed row-level security as the
rest of the schema. The application role gets SELECT, INSERT and DELETE, and no UPDATE.

The port is `MessageLog`, separate from `VectorStore`, with Postgres and in-memory adapters
held to one conformance suite.

The log is on by default; `messageLog: false` turns it off.

On each write the pipeline reads the last `contextMessageCount` turns of the exact scope
(default 10) and gives them to the extractor under "Previous Messages", marked as context to
resolve references and never as a source of facts. The default comes from the two-stage
extraction design in Chhikara et al., "Mem0: Building Production-Ready AI Agents with Scalable
Long-Term Memory" (arXiv:2504.19413), which uses m = 10 previous messages. It was not chosen
by measuring any benchmark.

After the write completes, the new messages are appended and linked to every memory the write
returned, including duplicates it confirmed. A write that throws logs nothing, and an
idempotent replay logs nothing again. A log failure after the memories committed does not fail
the write; it is emitted as `message_log_failed`.

A hard forget erases the messages that produced the memory, and with them their citations of
any other memory. Postgres enforces this with a `BEFORE DELETE` trigger on `memories`, in the
same transaction as the delete, so every physical delete path (hard forget, expiry purge,
scope erasure) erases them. Adapters without a trigger erase them from `forget`. A soft forget
or an eviction does not delete the memory row and keeps the messages.

`recall({ includeSources: true })`, REST and MCP included, returns each memory's source
messages, so a caller can read what was said instead of trusting the extracted fact. It is
opt-in because it adds the full message text to every result. A memory whose source was
erased by a hard forget of a sibling returns an empty list.

## Alternatives considered

- Keep a hard-forgotten memory's messages when another live fact cites them. Rejected by the
  project owner (2026-11-07): the forgotten content would survive in the log, and later in any
  raw evidence returned by recall.
- Opt-in logging. Rejected by the project owner: the context and provenance gains would reach
  only consumers who found the switch.
- Store the messages inside `memories.payload`. Rejected: one message produces many facts, and
  erasure would have to rewrite every payload that copied it.

## Consequences

Migration 0037 is required. Storage grows with conversation volume, and the log holds full
message text: retention follows memory erasure, not a TTL of its own. Extraction prompts grow
by up to `contextMessageCount` turns.

The durable job path (`PgMemoryJobProcessor`) reads the preceding turns while preparing, where
nothing is written because preparation can repeat, and appends and links the input in the same
transaction that commits its facts, graph and history. An input that yields no fact is still
appended, with no memory linked, as on the synchronous path (#250). A failed application leaves nothing in
the log there, which the synchronous path cannot promise. Jobs carry no observation time, so
their logged messages have none. Two jobs of one scope that prepare concurrently do not see
each other's input as context.
