/**
 * UsageCounterStore DIP — persist + read port for the per-scope cumulative
 * `recall()` counter that backs the metrics endpoint's `retrieval_api_usage`.
 *
 * Phase 2 of themory-scoped-forget-and-retrieval-counter. The recall path
 * (T2.3) increments fail-soft after serving results; the metrics handler (T2.4)
 * reads the cumulative count instead of hardcoding 0. Scope identity is the
 * 4-tuple `(workspace_id, user_id, session_id, agent_id)` resolved by the impl
 * via the SAME `COALESCE(col,'')` expression as the `scope_usage_counters_scope_uq`
 * UNIQUE index (EC-3 — one normalization across index + write + read, else the
 * counter splits across two rows and the metric stays 0).
 *
 * ISP-clean (2 methods) per ADR-0008. Default adapter: `PgUsageCounterStore`.
 *
 */
import type { Filters } from '../scope.js';

export interface UsageCounterStore {
  /**
   * Atomically bump the recall counter for the given scope by 1, creating the
   * row on first call. A single `INSERT ... ON CONFLICT DO UPDATE SET count =
   * count + 1` statement — no lost update under concurrent recalls. `workspace_id`
   * defaults to `'default'` when omitted (write/read must agree, EC-3).
   */
  increment(filters: Filters): Promise<void>;

  /**
   * Read the cumulative recall count for the given scope. Returns 0 when no row
   * exists yet. The WHERE clause uses the identical `COALESCE(col,'')` shape as
   * `increment`'s ON CONFLICT arbiter so a read hits the row a write created.
   */
  getRecallCount(filters: Filters): Promise<number>;
}
