/**
 * M11 T2.1 — `PgRoutingAuditStore`: the Postgres impl of the placement-decision audit DIP.
 *
 * Backed by the `routing_audit` table (migration 0026). `record` appends one row; `list` returns the
 * newest-first page for `(workspace_id, user_id)` via the `routing_audit_ws_user_at_idx` index. Every
 * query is scoped by the M8 `(workspace_id, user_id)` pair — a `list` never returns another tenant's
 * rows (ADR D3). The write is best-effort at the CALL site (fail-soft); this impl surfaces DB errors so
 * the caller can catch + emit `routing_audit_write_failed`.
 */
import type { Pool } from 'pg';

import {
  DEFAULT_AUDIT_LIST_LIMIT,
  MAX_AUDIT_LIST_LIMIT,
  type Attribution,
  type ChosenScope,
  type RoutingAuditRecord,
  type RoutingAuditStore,
} from '../../domain/dip/routing-audit-store.js';

interface AuditRow {
  readonly workspace_id: string;
  readonly user_id: string;
  readonly chosen_scope: string;
  readonly attribution: string;
  readonly decided_by: string;
  readonly why: string;
  readonly at: Date;
}

export class PgRoutingAuditStore implements RoutingAuditStore {
  constructor(private readonly pool: Pool) {}

  async record(rec: RoutingAuditRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO routing_audit (workspace_id, user_id, chosen_scope, attribution, decided_by, why, at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [rec.workspaceId, rec.userId, rec.chosenScope, rec.attribution, rec.decidedBy, rec.why, rec.at],
    );
  }

  async list(workspaceId: string, userId: string, limit = DEFAULT_AUDIT_LIST_LIMIT): Promise<RoutingAuditRecord[]> {
    const capped = Math.min(Math.max(1, limit), MAX_AUDIT_LIST_LIMIT);
    const { rows } = await this.pool.query<AuditRow>(
      `SELECT workspace_id, user_id, chosen_scope, attribution, decided_by, why, at
         FROM routing_audit WHERE workspace_id = $1 AND user_id = $2
         ORDER BY at DESC LIMIT $3`,
      [workspaceId, userId, capped],
    );
    return rows.map((r) => ({
      workspaceId: r.workspace_id,
      userId: r.user_id,
      chosenScope: r.chosen_scope as ChosenScope,
      attribution: r.attribution as Attribution,
      decidedBy: r.decided_by,
      why: r.why,
      at: r.at,
    }));
  }
}
