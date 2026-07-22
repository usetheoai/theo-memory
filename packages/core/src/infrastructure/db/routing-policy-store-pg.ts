/**
 * M11 T1.1 — `PgRoutingPolicyStore`: the Postgres impl of the routing-policy DIP.
 *
 * Backed by the `routing_policies` table (migration 0025), keyed by the M8 `(workspace_id, user_id)`
 * isolation pair. `get` returns the fail-closed default when no row exists (blueprint ADR D1); `put`
 * validates via `parseRoutingPolicy` (fail-fast) then UPSERTs. Every query is scoped by
 * `(workspace_id, user_id)` — a read/write never reaches another tenant's row (ADR D3).
 */
import type { Pool } from 'pg';

import {
  FAILCLOSED_DEFAULT_POLICY,
  parseRoutingPolicy,
  type DefaultScope,
  type RoutingPolicy,
  type RoutingPolicyStore,
} from '../../domain/dip/routing-policy-store.js';

interface PolicyRow {
  readonly default_scope: string;
  readonly llm_routing: boolean;
  readonly confirmation_threshold: number;
}

export class PgRoutingPolicyStore implements RoutingPolicyStore {
  constructor(private readonly pool: Pool) {}

  async get(workspaceId: string, userId: string): Promise<RoutingPolicy> {
    const { rows } = await this.pool.query<PolicyRow>(
      `SELECT default_scope, llm_routing, confirmation_threshold
         FROM routing_policies WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
    );
    const row = rows[0];
    if (row === undefined) return FAILCLOSED_DEFAULT_POLICY;
    return {
      defaultScope: row.default_scope as DefaultScope,
      llmRouting: row.llm_routing,
      confirmationThreshold: row.confirmation_threshold,
    };
  }

  async put(workspaceId: string, userId: string, policy: unknown): Promise<RoutingPolicy> {
    const valid = parseRoutingPolicy(policy); // fail-fast BEFORE the write
    await this.pool.query(
      `INSERT INTO routing_policies (workspace_id, user_id, default_scope, llm_routing, confirmation_threshold, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET default_scope = EXCLUDED.default_scope,
             llm_routing = EXCLUDED.llm_routing,
             confirmation_threshold = EXCLUDED.confirmation_threshold,
             updated_at = now()`,
      [workspaceId, userId, valid.defaultScope, valid.llmRouting, valid.confirmationThreshold],
    );
    return valid;
  }
}
