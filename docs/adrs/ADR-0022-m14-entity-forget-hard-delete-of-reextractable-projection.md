# ADR-0022 — M14 `delete_entities`/`forgetEntity` hard-deletes the re-extractable graph projection (amends ADR-M14-2)

- **Status:** Accepted (2026-07-24)
- **Context:** M14 `claude-code-kit-recall-parity`, `/review` finding (F-tests-1 / F-arch-3 / F-wiring-2)
- **Amends:** the intra-plan ADR-M14-2 clause "delete_entities com … soft-delete via `t_invalid`"

## Context

The M14 plan (ADR-M14-2) specified that `delete_entities`/`forgetEntity` should **soft-delete via
`t_invalid`**, mirroring the memory-tier forget. The `/review` cycle flagged that the shipped
`PgMemoryEntityStore.forgetEntity` instead performs **hard `DELETE`s** on `entities` /
`memory_entities` / `entity_edges`, and that this divergence from the plan was undocumented and had
no covering ADR (the sibling `supersedeEntity` deliberately "Never DELETEs").

Two facts surfaced during the fix that the plan's soft-delete assumption did not account for:

1. **The `entities` table has no `t_invalid` column.** Its lifecycle columns are `created_at` and
   `superseded_by` (supersession, not deletion). Soft-deleting an entity *node* via `t_invalid`
   would require a schema migration that adds the column purely to tombstone a re-derivable row.
2. **The entity graph is a DERIVED, RE-EXTRACTABLE projection of the memories.** The source
   `memories` are NOT touched by `forgetEntity` (only the `memory_entities` links, `entity_edges`,
   and `entities` node rows are removed). The graph can be fully rebuilt from the memories via the
   M13 re-extraction path (`themory reextract`). Unlike a memory (source data, soft-deleted so its
   audit/bi-temporal history survives), an entity node is a projection — a tombstone adds no
   recoverable information the memories don't already hold.

## Decision

`forgetEntity` **hard-deletes** the derived graph projection (links → edges → node rows) inside one
atomic transaction (`runInTx`), leaving the source memories intact. Soft-delete via `t_invalid` is
**NOT** adopted for entity nodes.

Auditability (Princípio 3) is satisfied by a **typed observability event** rather than a tombstone
row: `forgetEntity` emits `MEMORY_EVENTS.entity_forgotten` (attributes `entities_removed`,
`links_removed`, `edges_removed`) via the injected OTel tracer whenever a removal occurs. The event
is the audit trail that a soft-delete tombstone would otherwise provide, and it makes the milestone's
only destructive graph operation observable.

## Alternatives considered

- **Add `t_invalid` to `entities` + soft-delete (the plan's original clause).** Rejected:
  a schema migration + read-path predicate everywhere (`list`, `graph`, recall expansion) to tombstone
  a re-derivable projection — cost without recoverable value (YAGNI). The memories, not the entity
  nodes, are the source of truth; they are already soft-deleted.
- **Hard-delete with no observability (the as-shipped pre-fix state).** Rejected: violates Princípio 3
  (every expire/substitute decision must be observable). This is exactly the review finding.
- **Reuse `superseded_by` to tombstone.** Rejected: `superseded_by` models node *replacement* during
  re-extraction, not user-directed forget; overloading it would corrupt the supersession semantics.

## Consequences

- `forgetEntity` is irreversible at the row level, but recoverable at the system level (re-extract
  from the untouched memories). Documented so consumers do not expect a tombstone.
- The `entity_forgotten` event is a no-op when no OTel exporter is configured (API default tracer),
  so local/dev runs pay nothing; production observability lights up when a tracer is wired
  (`run-mcp-server` injects `trace.getTracer('themory-memory-entity-store')`).
- Tests: `test_forget_entity_emits_typed_event` + `test_forget_entity_no_event_when_nothing_removed`
  pin the auditability contract; the plan's `test_forget_entity_soft_deletes_scoped` is intentionally
  NOT written (soft-delete is not the chosen semantics).

## Cross-references

- Princípio 3 (auditability): `theo-memory/CLAUDE.md`
- Event union: `packages/core/src/domain/memory-event.ts` (`entity_forgotten`)
- Impl: `packages/core/src/infrastructure/db/pg-memory-entity-store.ts` (`forgetEntity`)
