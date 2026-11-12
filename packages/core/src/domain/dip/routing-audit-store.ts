/**
 * M11 T2.1 — `RoutingAuditStore`: the placement-decision audit DIP (Princípio 3).
 *
 * Every routing (M8) / promotion (M9) decision is a queryable record of who / what / why: which scope
 * the memory landed in, its attribution (user vs agent), who decided, and the reason. Reuses the shipped
 * recall-trace governance SHAPE (blueprint ADR D2 — no new audit engine, Rule 9). Reads are
 * `(workspace, user)`-scoped: a `list` for another tenant's pair returns that tenant's rows only, never
 * a cross-tenant reach (ADR D3).
 *
 * The audit write is BEST-EFFORT / fail-soft at the call site (like `scoped forget`'s history): a failed
 * audit write MUST NOT block the routing decision itself — the caller catches + emits
 * `routing_audit_write_failed` and proceeds (Rule 8 — recover where justified).
 */
import type { Tracer } from '@opentelemetry/api';

import { emitEvent } from '../memory-event.js';

/** The governed scope a memory was placed in. */
export type ChosenScope = 'session' | 'global';

/** Who the placement is attributed to. */
export type Attribution = 'user' | 'agent';

/** A single placement-decision audit record. */
export interface RoutingAuditRecord {
  readonly workspaceId: string;
  readonly userId: string;
  /** The scope the memory landed in. */
  readonly chosenScope: ChosenScope;
  /** Whether the placement is attributed to the user or the agent. */
  readonly attribution: Attribution;
  /** Who decided (agent id, user id, or a sentinel like `policy-default` / `m9-promotion`). */
  readonly decidedBy: string;
  /** The reason (e.g. `agent-explicit`, `policy-default`, `promotion-distinct-source-threshold`). */
  readonly why: string;
  /** When the decision was made. */
  readonly at: Date;
}

export interface RoutingAuditStore {
  /** Append one placement-decision record. Best-effort — the caller treats a rejection as fail-soft. */
  record(rec: RoutingAuditRecord): Promise<void>;
  /**
   * The most recent placement decisions for `(workspaceId, userId)`, newest first, capped at `limit`
   * (default 100). NEVER returns another tenant's rows — the `(workspace, user)` pair is the scope.
   */
  list(workspaceId: string, userId: string, limit?: number): Promise<RoutingAuditRecord[]>;
}

/** Default + max page size for `list` (mirrors the recall-trace row-cap discipline). */
export const DEFAULT_AUDIT_LIST_LIMIT = 100;
export const MAX_AUDIT_LIST_LIMIT = 1000;

/**
 * Best-effort audit write — the fail-soft primitive every routing/promotion call site uses. A failed
 * audit write MUST NOT propagate: the decision already happened. On failure it emits
 * `routing_audit_write_failed` (Princípio 3 — the audit's own failure is observable) and returns.
 */
export async function recordRoutingDecision(
  store: RoutingAuditStore,
  rec: RoutingAuditRecord,
  tracer?: Tracer,
): Promise<void> {
  try {
    await store.record(rec);
  } catch (err) {
    emitEvent(tracer, 'routing_audit_write_failed', {
      workspace_tier: rec.chosenScope,
      error: err instanceof Error ? err.name : 'unknown',
    });
  }
}

/** In-memory impl — makes the who/what/why + `(workspace, user)` scoping testable WITHOUT a DB. */
export class InMemoryRoutingAuditStore implements RoutingAuditStore {
  private readonly records: RoutingAuditRecord[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract is async; in-memory has no await
  async record(rec: RoutingAuditRecord): Promise<void> {
    this.records.push(rec);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract is async; in-memory has no await
  async list(workspaceId: string, userId: string, limit = DEFAULT_AUDIT_LIST_LIMIT): Promise<RoutingAuditRecord[]> {
    const capped = Math.min(Math.max(1, limit), MAX_AUDIT_LIST_LIMIT);
    return this.records
      .filter((r) => r.workspaceId === workspaceId && r.userId === userId)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, capped);
  }
}
