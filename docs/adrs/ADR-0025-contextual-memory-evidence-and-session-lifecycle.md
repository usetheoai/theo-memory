# ADR-0025: Contextual evidence and session lifecycle

Status: Implemented; durable lifecycle extended by ADR-0026

## Context

Semantic similarity cannot establish that a purchase exists or identify the exact event on a
calendar. Extracted assertions and inferred preferences also have different evidential weight.
Running extraction inline with a live audio turn adds provider latency to that interaction.

## Decision

Keep authoritative domain records behind an injected exact `SessionFactStore`. Add an opt-in
SDK `MemorySession` that loads domain records and semantic context, awaits operational writes,
and queues contextual extraction separately. Keep the existing four memory verbs unchanged.

Represent contextual evidence as an optional typed projection of flat JSON metadata. Classify
new extracted memories as stated or inferred; accept caller-declared observations for verbatim
writes. Ground source quotes in new input, discard model-labeled tentative/temporary drafts,
and expose drop/downgrade events. Reflection outputs are inferred.

Use a bounded in-process extraction queue with completion results and explicit draining.
Enable strict extraction errors for queued work. The coordinator itself does not claim crash-safe acceptance. ADR-0026 adds an optional
Postgres job service; authoritative application schemas remain application responsibilities.

## Consequences

Existing SDK construction remains valid. The initial coordinator does not require a second
database or new MCP tool. The completed lifecycle uses migrations and REST job endpoints
described in ADR-0026. Exact operations cannot silently fall back
to approximate recall. Evidence survives existing read surfaces and dedup retains the original
citation. Legacy unclassified rows are not retroactively attributed.

The new gates depend on model-provided classification; source-quote grounding does not prove
semantic entailment. Assertion counts do not measure independent evidence. Model-quality
validation requires live evaluations in addition to controlled-response contract tests.

See [the usage and lifecycle contract](../memory-semantics.md).
