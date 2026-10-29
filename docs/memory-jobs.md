# Durable extraction jobs

Apply migrations 0035 and 0036 with the migration credential before starting the server or
worker. They add explicit expiry, source evidence and receipts, then the durable queue and a
hard-erasure redaction trigger. Existing rows retain unknown provenance; no implicit TTL is
introduced. Take the normal database backup before production migration. The partial active
hash index changes soft-deleted version handling; downgrade requires a reviewed data migration.

The request role must be `NOSUPERUSER NOBYPASSRLS`, subject to workspace RLS. The worker
uses a separate contained role granted the named `*_worker_cross_workspace` policies.
Provision roles before migration, as in `dev/roles.sql`; the worker checks its reach at boot.
Do not supply the migration credential as either runtime URI.

```sh
export THEOMEM_PG_URI=postgresql://themory_app:...@localhost/themem
export THEOMEM_WORKER_PG_URI=postgresql://themory_worker:...@localhost/themem
export THEOMEM_MEMORY_JOBS=true
# Configure the normal embedding provider and OPENAI_API_KEY / OPENAI_BASE_URL /
# OPENAI_CHAT_MODEL for the extraction provider. Dimensions must match the schema.
themory server
themory worker --concurrency 2
# Or process at most one available job:
themory worker --once
```

The CLI server injects jobs only when `THEOMEM_MEMORY_JOBS=true`. Embedders and model I/O
run in the worker process. Custom servers inject a `PgMemoryJobStore` as `memoryJobs` into
`createServer`; evidence reads use `memoryEvidenceStore`. The SDK store exposes
`submit(input, actor, idempotencyKey)`, `get(jobId, actor)` and `retry(jobId, actor)`.
Derive actors from authentication; never let tool input choose its authority.

```sh
curl -X POST "$BASE/v1/memory-jobs" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: conversation-42-turn-7' \
  -d '{"scope":{"kind":"user","userId":"alice"},"text":"I usually prefer dark colors.","sourceId":"conversation-42:turn-7","modality":"audio"}'
curl "$BASE/v1/memory-jobs/$JOB_ID" -H "Authorization: Bearer $TOKEN"
curl -X POST "$BASE/v1/memory-jobs/$JOB_ID/retry" -H "Authorization: Bearer $TOKEN"
```

POST returns 202 **after commit**, not after extraction. The same key and effective input
return the same job; a different input returns 409. A member's target user is rebound to the
authenticated user, including session/agent scopes. Other users/workspaces get 404 for job
reads/retries. Submit/retry require `memory:write`; reads require `memory:read`.

Jobs move through `queued`, `running`, `succeeded`, `failed`. Poll status and inspect
`memoryIds`, `attempts` and generic `errorCode`. No raw provider error is persisted. An empty
valid extraction succeeds with no IDs. Retry resets a failed job only while its input remains
available; it is unavailable for successful/running jobs or after input retention has elapsed.

Claims use `FOR UPDATE SKIP LOCKED`. Each attempt owns a 120-second lease, renewed every
30 seconds during preparation. Provider operations time out after 90 seconds. Expired leases
can be reclaimed; SQL fencing rejects stale save, renewal and completion attempts. Up to five
attempts run with delays 5, 30, 120 and 600 seconds. Invalid or expired input fails permanently.

Preparation calls the model and embedder, validates results, then persists drafts. Recovery
reuses those drafts. Application commits facts, evidence, history, graph, cache invalidation and
the completion receipt in one transaction. A process killed after draft save or during an
uncommitted write can resume without partial effects or another assertion. The apply phase
is fenced against lease expiration. SIGTERM/SIGINT stop new claims and drain active work;
allow enough termination grace for provider timeouts and database work.

The worker prunes finished input/drafts after seven days and minimal receipts after thirty.
Queued work is not aged out as if it had completed. Hard-erasing a result memory removes its
ledger and clears input/drafts of related jobs immediately. Do not log request text or prepared
drafts in infrastructure logs. Monitor queue age, failed jobs, attempts, lease churn and the
`memory.jobs.processed` counter tagged by result. A retention failure emits a generic message
and is retried on the next minute. Persistent database failures require operator intervention.

Physical expiry purge is opt-in: `themory worker --purge-expired`. Without it, expired data
is hidden from current context but retained for authorized historical/audit reads. Receipt
retention bounds the idempotency guarantee; an intentionally new operation should use a new
key. Source media remains outside this service.

See [the wishlist example](../examples/wishlist/README.md) for setup, process restart, exact
misses, replay and explicit 60-second expiry.
