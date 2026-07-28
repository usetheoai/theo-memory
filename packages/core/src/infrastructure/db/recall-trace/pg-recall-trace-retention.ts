/**
 * PgRecallTraceRetention — Postgres impl of the M4 recall-trace retention sweep.
 *
 * Reuses the recall-cache race mechanism (`withSerializableTransactionAndRetry`)
 * so the housekeeping DELETE is safe against concurrent recall-trace writes
 * (PG `40001` retried once). Age-based only — a uniform sweep that cannot target
 * one tenant, so no cross-tenant deletion risk (blueprint ADR-1).
 *
 * @see packages/core/src/infrastructure/db/recall-cache/serializable-tx.ts (reused, Rule 9)
 */
import type { Pool } from 'pg';

import type { RecallTraceRetentionPolicy } from '../../../domain/dip/recall-trace-store.js';
import { InvalidRecallTraceConfig } from '../../../domain/errors.js';
import { withSerializableTransactionAndRetry } from '../recall-cache/serializable-tx.js';

// Parameterized age predicate: `$1` seconds. Mirrors recall-cache CLEAR_EXPIRED_SQL
// (age-based DELETE) but keyed on created_at + a caller-supplied window.
const SWEEP_SQL =
  `DELETE FROM recall_traces WHERE created_at <= NOW() - (($1)::text || ' seconds')::interval`;

export class PgRecallTraceRetention implements RecallTraceRetentionPolicy {
  constructor(private readonly pool: Pool) {}

  async sweep(olderThanSeconds: number): Promise<number> {
    // FX2 (/review M4-R2) — fail-fast at the boundary (error-handling.md § 2).
    // A NEGATIVE window flips the predicate to `created_at <= NOW() + interval`,
    // matching EVERY row across ALL tenants (full audit-log wipe); NaN/Infinity
    // make the interval cast throw every tick (silent no-run → unbounded growth).
    // Reject both with a typed error BEFORE touching the table.
    if (!Number.isFinite(olderThanSeconds) || olderThanSeconds <= 0) {
      throw new InvalidRecallTraceConfig(
        `retention window (seconds) must be a positive finite number; got ${String(olderThanSeconds)}`,
      );
    }
    return withSerializableTransactionAndRetry(this.pool, async (tx) => {
      const res = await tx.query(SWEEP_SQL, [olderThanSeconds]);
      return res.rowCount ?? 0;
    });
  }
}
