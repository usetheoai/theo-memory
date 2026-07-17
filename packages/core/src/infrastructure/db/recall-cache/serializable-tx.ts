/**
 * SERIALIZABLE transaction wrapper with single retry on serialization_failure
 * (PostgreSQL sqlstate `40001`).
 *
 * Backs `PgvectorRecallCacheStore.set()` capacity-bounded LRU eviction per
 * plan T1.2 / EC-7 absorption.
 *
 * **The race this defends against:** two concurrent `set()` calls on a full
 * Under SERIALIZABLE isolation, PG detects the read-write dependency cycle
 * and aborts one transaction with `40001`. Retrying once resolves it
 * deterministically per PG docs.
 *
 * **Why retry exactly once (not exponential backoff):**
 * - The serialization-failure rate on this workload is bounded by the
 *   number of concurrent writers per scope (typically 1-3 in agent loops).
 * - A second retry would still hit the same window with the same probability;
 *   the failure mode is `cache temporarily unavailable` (caller falls through
 *   to the 9-step pipeline — cache MISS is a benign degraded path).
 * - Higher retry counts amplify connection pool pressure during incidents.
 *
 * @see https://www.postgresql.org/docs/current/transaction-iso.html#XACT-SERIALIZABLE
 */
import type { Pool, PoolClient } from 'pg';

const PG_SERIALIZATION_FAILURE = '40001';

export async function withSerializableTransactionAndRetry<T>(
  pool: Pool,
  work: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (err as { code?: string })?.code;
      if (attempt === 0 && code === PG_SERIALIZATION_FAILURE) {
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
  // Unreachable: the loop either returns or throws inside.
  throw new Error('withSerializableTransactionAndRetry: exhausted 2 attempts (unreachable)');
}
