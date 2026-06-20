---
name: implement-themory-scoped-forget-and-retrieval-counter-sepa-knowledge
description: Paired knowledge skill for the SEPA agent on plan themory-scoped-forget-and-retrieval-counter. Consult during /implement when reasoning about scope-checked deletes (single-SQL workspace+tier WHERE), 404-not-403 no-existence-leak discipline, atomic UPSERT counters (ON CONFLICT DO UPDATE +1), fail-soft side effects in a read path, or the DIP port/adapter pattern. Triggering phrases: "is this scope-check correct", "is the counter atomic", "is this fail-soft", "canonical UPSERT increment", "best practice for scoped delete".
---

# SEPA knowledge — scoped-forget + recall-counter

Hydrates community + project best practices on top of the plan-specific SEPA context.

## Scope-checked delete (D1)
- A subject-scoped delete is ONE SQL statement: `... WHERE id=$1 AND workspace_id=$2 AND {tier_col}=$3` (+`t_invalid IS NULL` for soft). Returns `rowCount`; 0 → not-in-scope → `MemoryNotFound` → 404. NEVER read-then-delete (TOCTOU race); the single statement is atomic.
- **404-not-403:** cross-scope, cross-workspace, and missing-id all return the SAME 404. A 403 (or a 404 with a distinguishing message) leaks existence. Mirror `forget.ts:44-46`.

## Atomic counter (D2/D3)
- Canonical atomic increment: `INSERT ... VALUES (...) ON CONFLICT (<scope tuple>) DO UPDATE SET recall_count = <table>.recall_count + 1`. This is a single atomic statement — no lost update under concurrency (no SELECT-then-UPDATE). Project precedent: `pg-memory-graph-store.ts:30-33`.
- **One normalization (EC-3):** the UNIQUE arbiter, the ON CONFLICT inference, and the read WHERE must use the byte-identical `COALESCE(col,'')` expression. The TS side normalizes `workspace_id ?? 'default'` once before the query. A divergence splits the row (write A, read B → 0).

## Fail-soft side effect in a read path (D3 / error-handling rule)
- A metrics/telemetry side effect on `recall()` MUST be wrapped in try/catch and run AFTER the user-facing result is computed; on error: emit a typed OTel event + warn, return the result unchanged. A counter blip must NEVER fail a user's read (Princípio 3 + `architecture.md §8`). Precedent: entity/edge linking fail-soft in the write pipeline.

## DIP port/adapter (§3)
- Port (`UsageCounterStore`) in `domain/dip/`; adapter (`PgUsageCounterStore`) in `infrastructure/db/`; the domain imports the PORT type only. Factory injects the adapter, gated behind the same `entityBoost`/PgvectorStore condition as the entity/graph stores (`factory.ts:185-189`). In-memory adapter / tests get no store → metric reads 0 honestly.

## Backward-compat
- Additive only: `POST /v1/forget` stays; new `DELETE` is additive; the metrics payload stays exactly 4 fields. Any shape drift on the metric is a consumer-breaking change (gateway `client.go` + dashboard parse it).
