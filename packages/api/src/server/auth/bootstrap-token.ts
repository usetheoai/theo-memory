/**
 * Bootstrap-token utilities for ADR D7 single-use admin bootstrap.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T2.2.1.
 *
 * Pair of functions:
 *   - `isBootstrapAllowed(pool)` — reads admin_config.bootstrap_consumed;
 *     returns true iff still false (bootstrap not yet consumed).
 *   - `markBootstrapConsumedTx(pool)` — sets bootstrap_consumed=true ONCE
 *     (only flips when currently false; subsequent calls no-op). Caller
 *     wraps with their own transaction so the flag flip is atomic with
 *     the first admin-key INSERT — closing the EC-3 race window.
 *
 * Used by `createKeyHandler` (T2.2.1 wiring): when a request authenticates
 * via the bootstrap token AND the scope being granted is `memory:admin`,
 * the same tx that INSERTs the new admin key calls
 * `markBootstrapConsumedTx` — flipping the flag. If the tx rolls back
 * (e.g., DB constraint violation), the flag stays false (atomicity).
 *
 */
import type { AuthPool } from './api-key-verifier.js';

export async function isBootstrapAllowed(pool: AuthPool): Promise<boolean> {
  const { rows } = await pool.query<{ bootstrap_consumed: boolean }>(
    `SELECT bootstrap_consumed FROM admin_config WHERE id = 1 LIMIT 1`,
    [],
  );
  // No row → bootstrap not seeded → not allowed (fail-closed per Inq Rule 8)
  if (rows.length === 0) return false;
  return rows[0]?.bootstrap_consumed === false;
}

/**
 * Mark the bootstrap as consumed. Idempotent: only flips when currently
 * false. Caller MUST wrap with their own BEGIN/COMMIT so the flag flip
 * is atomic with the admin-key INSERT.
 *
 * Returns the number of rows affected (0 if already consumed, 1 on
 * successful flip — useful for honest reporting).
 */
export async function markBootstrapConsumedTx(pool: AuthPool): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `UPDATE admin_config
        SET bootstrap_consumed = true, consumed_at = NOW()
      WHERE id = 1 AND bootstrap_consumed = false
     RETURNING id`,
    [],
  );
  return result.rows.length;
}
