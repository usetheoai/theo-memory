/**
 * Small transaction helpers shared by the pg adapters — the DRY spine for the
 * multi-statement writes (upsert-and-link, supersede, forget) in `PgMemoryEntityStore`.
 */
import type { Pool, PoolClient } from 'pg';

import type { Filters } from '../../domain/scope.js';

import { transactionClient } from './transaction-pool.js';

/** Null-coerced (user, session, agent) scope ids — the tier columns shared by every write. */
export function scopeIds(filters: Filters): {
  userId: string | null;
  sessionId: string | null;
  agentId: string | null;
} {
  return {
    userId: filters.user_id ?? null,
    sessionId: filters.session_id ?? null,
    agentId: filters.agent_id ?? null,
  };
}

/**
 * Run `work` inside a transaction: BEGIN → work → COMMIT; on error ROLLBACK (best-effort)
 * and rethrow; always release the client.
 */
export async function runInTx<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const current = transactionClient(pool);
  if (current !== undefined) return work(current);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
