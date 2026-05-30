/**
 * PgEvictor — Postgres-backed `Evictor` impl for v0.4b soft-delete eviction
 * per ADR D17 + plan T6.1.
 *
 * Single UPDATE per evict() call:
 *   UPDATE memories SET t_invalid = NOW()
 *    WHERE id = ANY($1::uuid[]) AND t_invalid IS NULL
 *   RETURNING id
 *
 * The `t_invalid IS NULL` guard + `RETURNING id` distinguish:
 *   - `softDeleted`: ids that were active at UPDATE time (in RETURNING set)
 *   - `alreadyInvalid`: ids already had `t_invalid` set (input - RETURNING set)
 *
 * Never physical DELETE per ADR D17 (bi-temporal audit trail preserved).
 *
 * EC-10 absorption: empty input array short-circuits without a SQL roundtrip
 * (no UPDATE issued; result has empty arrays for all fields).
 *
 * EC-4 absorption: emits OTel counter `theo.memory.eviction.soft_deletes_total`
 * with attribute `{ policy: 'triadic_scoring' }` after every successful evict.
 * Counter is registered with `metrics.getMeter('@usetheo/memory')` — a no-op
 * when consumer has not registered a MeterProvider (production telemetry
 * works automatically when the consumer wires their own). For testing,
 * `onSoftDelete?: (count, attrs) => void` callback provides a deterministic
 * verification channel without requiring `@opentelemetry/sdk-metrics`.
 *
 * Plan EC-4 cites src/local/telemetry.ts as the meter source; that file does
 * not exist in v0.1. Resolved by using `metrics.getMeter` directly from
 * @opentelemetry/api (already a project dep at v0.1). Documented in T6.1
 * commit body.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T6.1 (D17 + EC-4 + EC-10)
 */
import { metrics, type Counter } from '@opentelemetry/api';
import type { Pool } from 'pg';

import type { EvictionResult } from '../../core/dip/eviction-policy.js';

const EVICT_SOFT_DELETE_SQL = `UPDATE memories
   SET t_invalid = NOW()
 WHERE id = ANY($1::uuid[])
   AND t_invalid IS NULL
RETURNING id`;

const SOFT_DELETE_COUNTER_NAME = 'theo.memory.eviction.soft_deletes_total';

const meter = metrics.getMeter('@usetheo/memory');
const softDeleteCounter: Counter = meter.createCounter(SOFT_DELETE_COUNTER_NAME, {
  description: 'Count of memories soft-deleted by an eviction policy (cumulative)',
});

export interface Evictor {
  evict(memoryIds: readonly string[]): Promise<EvictionResult>;
}

export interface PgEvictorOptions {
  /**
   * Test hook invoked alongside the OTel counter emission. Receives the
   * count of softDeleted ids + the attribute set. Production callers
   * omit this; the OTel counter still emits via `metrics.getMeter` so
   * consumer telemetry works automatically.
   */
  readonly onSoftDelete?: (count: number, attrs: Readonly<Record<string, string>>) => void;
}

export class PgEvictor implements Evictor {
  private readonly onSoftDelete: PgEvictorOptions['onSoftDelete'];

  constructor(private readonly pool: Pool, options: PgEvictorOptions = {}) {
    this.onSoftDelete = options.onSoftDelete;
  }

  async evict(memoryIds: readonly string[]): Promise<EvictionResult> {
    if (memoryIds.length === 0) {
      return { softDeleted: [], alreadyInvalid: [], errors: [] };
    }
    const result = await this.pool.query<{ id: string }>(EVICT_SOFT_DELETE_SQL, [memoryIds]);
    const softDeletedSet = new Set(result.rows.map((r) => r.id));
    const softDeleted: string[] = [];
    const alreadyInvalid: string[] = [];
    for (const id of memoryIds) {
      if (softDeletedSet.has(id)) {
        softDeleted.push(id);
      } else {
        alreadyInvalid.push(id);
      }
    }
    if (softDeleted.length > 0) {
      const attrs = { policy: 'triadic_scoring' };
      softDeleteCounter.add(softDeleted.length, attrs);
      this.onSoftDelete?.(softDeleted.length, attrs);
    }
    return { softDeleted, alreadyInvalid, errors: [] };
  }
}
