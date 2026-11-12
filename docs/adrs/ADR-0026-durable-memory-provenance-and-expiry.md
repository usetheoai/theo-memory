# ADR-0026: Durable extraction, original-source evidence and explicit expiry

Status: Implemented

## Context

The in-process coordinator in ADR-0025 cannot survive process loss. Assertion counts conflate
retries with independent evidence, and session scope does not express when temporary context
stops being useful. Exact application records still need their own authoritative schema.

## Decision

Use Postgres for both the existing contextual memories and an optional durable extraction
queue, without requiring a separate broker. Acknowledgment follows enqueue commit. Preparation
uses providers outside the live request and saves validated drafts. Facts, ledger, graph,
history, cache invalidation and completion commit atomically through an existing-client
transaction adapter. SKIP LOCKED claims, expiring leases and token fencing protect recovery.

Retain the original primary evidence projection and add one ledger entry per identified
original source. Keep assertion and independent-source counts separate. Summaries pass
`originSourceId`; reflection inherits original citations and remains inferred. Promote only
with at least two identified sources. Do not backfill invented legacy provenance.

Expose explicit `expiresAt`; omitted means no TTL. Every current-context path excludes expiry;
historical reads use the requested instant. Derived context inherits its earliest source
deadline. Reassertion after expiry creates a new active version rather than rewriting history.
Optional physical purge gives operators a separate storage-retention choice.

Jobs use authenticated workspace/user identity. Discovery runs under a contained worker role
with named cross-workspace policies, not a superuser. Input/drafts expire seven days after
completion, receipts thirty days. Hard erasure removes source evidence and redacts related job
content. Operational defaults and wire contracts are in [memory-jobs.md](../memory-jobs.md).

## Consequences

Migrations 0035–0036 are required. Promotion is intentionally more conservative than the old
assertion threshold. Runtime needs a separate worker process for durable extraction. Direct
strict SDK writes and the lightweight coordinator retain their documented transaction and
crash limitations; use jobs for atomic multi-effect processing.

Provider timeouts bound waiting, but do not guarantee cancellation of a remote request already
accepted by a provider. Duplicate model billing can occur before a draft is saved. Idempotent
application effects and persisted-draft recovery do not promise exactly-once remote inference.
The live bilingual quality gate complements deterministic and actual Postgres recovery tests;
its observed quality is specific to the corpus/model/settings.
