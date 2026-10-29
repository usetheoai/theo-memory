import { evidenceFromPayload } from '../../memory-evidence.js';
/**
 * Row → DTO mapping + scope helpers for the recall pipeline (M19 / #124; extracted from
 * pipeline.ts).
 *
 * `makeRowToItem(scope, now)` returns the mapper closure the orchestrator used inline — `scope`
 * and `now` are passed explicitly (not captured from an enclosing scope) so the extraction is
 * behavior-identical: the same `scope` on every row and the same `now` fallback for a missing
 * `created_at`.
 */
import type { MemoryItemWithScore } from '../../memory-item.js';
import type { Filters, Scope } from '../../scope.js';

import type { Payload, ScoredRow } from './threshold-filter.js';

export function scopeFromFilters(filters: Filters): Scope {
  if (filters.user_id !== undefined) {
    return { kind: 'user', userId: filters.user_id };
  }
  if (filters.session_id !== undefined) {
    return { kind: 'session', sessionId: filters.session_id };
  }
  if (filters.agent_id !== undefined) {
    return { kind: 'agent', agentId: filters.agent_id };
  }
  return { kind: 'user', userId: '' };
}

function payloadToScore(payload: Payload, fallback: number): number {
  const raw = payload['_score'];
  return typeof raw === 'number' ? raw : fallback;
}

/** Builds the `ScoredRow → MemoryItemWithScore` mapper bound to one `scope` + `now`. */
export function makeRowToItem(
  scope: Scope,
  now: Date,
): (row: ScoredRow) => MemoryItemWithScore {
  return (row: ScoredRow): MemoryItemWithScore => {
    // v1.1 T2.1: surface attributed_to from the row payload (rowToResult in pgvector-store
    // projects the column into payload[attributed_to] when non-null). String coercion +
    // undefined-when-absent preserves the DTO's optional contract.
    const attributedToRaw = row.payload['attributed_to'];
    const attributedTo = typeof attributedToRaw === 'string' ? attributedToRaw : undefined;
    // principles-alignment-hardening T2.1 / EC-6 — hoist confirmation_count from row payload
    // (search SQL now projects it). recall() results now surface Princípio 1 confirmação signal.
    const confirmationCountRaw = row.payload['confirmation_count'];
    const confirmationCount = typeof confirmationCountRaw === 'number' ? confirmationCountRaw : undefined;
    // M10 T1.1 — hoist the REAL created_at (rowToResult projects it into payload as an ISO string)
    // so the recency signal is available to the scope-aware reweight; fall back to `now` only when
    // the projection is absent (legacy/stale-impl rows) — never silently lie.
    const createdAtRaw = row.payload['created_at'];
    const parsedCreatedAt =
      typeof createdAtRaw === 'string' && !Number.isNaN(Date.parse(createdAtRaw))
        ? new Date(createdAtRaw)
        : now;
    return {
      id: row.id,
      text: String(row.payload['text'] ?? ''),
      hash: String(row.payload['hash'] ?? row.id),
      scope,
      createdAt: parsedCreatedAt,
      updatedAt: parsedCreatedAt,
      metadata: { ...row.payload },
        tValid: now,
      tInvalid: null,
      ...evidenceFromPayload(row.payload),
      ...(attributedTo !== undefined ? { attributedTo } : {}),
      ...(confirmationCount !== undefined ? { confirmationCount } : {}),
      score: row.score === 0 ? payloadToScore(row.payload, row.score) : row.score,
    };
  };
}
