/**
 * SERIALIZABLE transaction wrapper with bounded retry on serialization_failure
 * (PostgreSQL sqlstate `40001`).
 *
 * Backs `PgvectorRecallCacheStore.set()` capacity-bounded LRU eviction per
 * plan T1.2 / EC-7 absorption.
 *
 * **The race this defends against:** concurrent `set()` calls on a full scope
 * each read the count then DELETE-oldest + INSERT. Under SERIALIZABLE isolation
 * PG detects the read-write dependency cycle and aborts the losers with `40001`.
 *
 * **Why bounded retries + jitter (theo-memory#132 fix, was: single retry):**
 * With N concurrent writers, breaking the dependency cycle can take more than
 * one abort — but each successful commit REMOVES a writer, so contention decays
 * and the retriers converge. A single retry therefore under-serves 3+ concurrent
 * writers: a twice-aborted transaction threw, silently dropping a cache write and
 * corrupting the LRU count (the #132 flaky test was this real bug, not test noise).
 * `MAX_ATTEMPTS` retries with a small randomized backoff de-synchronize the
 * retriers so they do not immediately re-collide. The bound (not infinite) still
 * caps connection-pool pressure during a genuine incident; on exhaustion this throws,
 * and the caller (`scoped-retrieval.ts` — the recall write-behind) guards the `set()` in a
 * try/catch that emits `recall_cache_write_failed` and returns the already-computed results,
 * so a cache-write failure degrades to an observable cache MISS and NEVER breaks recall.
 *
 * @see https://www.postgresql.org/docs/current/transaction-iso.html#XACT-SERIALIZABLE
 */
import type { Pool, PoolClient } from 'pg';

const PG_SERIALIZATION_FAILURE = '40001';
/** Bounded so a genuine incident cannot amplify pool pressure without limit. */
const MAX_ATTEMPTS = 8;
/** Base backoff (ms) per attempt; jittered to de-sync concurrent retriers. */
const BACKOFF_BASE_MS = 3;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function withSerializableTransactionAndRetry<T>(
  pool: Pool,
  work: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (err as { code?: string })?.code;
      if (code === PG_SERIALIZATION_FAILURE && attempt < MAX_ATTEMPTS - 1) {
        // Randomized backoff (0..BACKOFF_BASE_MS*(attempt+1)) so the aborted writers do not
        // retry in lock-step and immediately re-form the same dependency cycle.
        await sleep(Math.random() * BACKOFF_BASE_MS * (attempt + 1));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
  // Unreachable: the loop either returns or throws inside.
  throw new Error(`withSerializableTransactionAndRetry: exhausted ${String(MAX_ATTEMPTS)} attempts (unreachable)`);
}
