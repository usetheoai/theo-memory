/**
 * M24 (#146) — bounded per-anchor consolidation for the reflect path.
 *
 * Extracted from `reflect-orchestrator.ts` (keeping that file under the 300-LoC
 * budget) so the consolidation phase — recall candidates → bound into clusters →
 * judge each cluster → persist supersessions → audit M9 promotions — lives next
 * to its single caller and is unit-testable in isolation.
 *
 * The M23 wall this closes: `recallConsolidationCandidates` returns the WHOLE
 * live scope as one cluster, and `LlmJudgedMergeConflictPolicy` ABSTAINS when a
 * cluster exceeds `clusterCap` (default 20). On a real (>20-row) conversation
 * the contradiction pair never reached the judge. `clusterByProximity` splits
 * the candidates into disjoint clusters of ≤ cap so each judge call is focused.
 */
import type { Tracer } from '@opentelemetry/api';

import { clusterByProximity } from '../../domain/consolidation/cluster-by-proximity.js';
import type {
  ConflictResolutionPolicy,
  ConflictResolutionResult,
  ConsolidationCandidate,
} from '../../domain/dip/conflict-resolution-policy.js';
import { recordRoutingDecision, type RoutingAuditStore } from '../../domain/dip/routing-audit-store.js';
import { emitEvent } from '../../domain/memory-event.js';
import type { Filters, Scope } from '../../domain/scope.js';

/** A consolidation candidate carrying the optional M24 clustering embedding. */
export type BoundedCandidate = ConsolidationCandidate & { readonly embedding?: readonly number[] };

/** The store surface the reflect consolidation phase consumes. */
export interface VectorStoreWithConsolidation {
  recallConsolidationCandidates?: (
    filters: Filters,
  ) => Promise<readonly BoundedCandidate[]>;
  persistConsolidations?: (
    results: readonly ConflictResolutionResult[],
    options?: { readonly promote?: boolean },
  ) => Promise<number>;
}

/**
 * Split candidates into bounded clusters and judge each one, aggregating the
 * results. M9 promotion (session→global) reads the WHOLE session scope and is
 * exempt; a store that does not project embeddings degrades to a single
 * whole-scope cluster (pre-M24 behaviour).
 */
export async function consolidateInBoundedClusters(args: {
  readonly candidates: readonly BoundedCandidate[];
  readonly conflictPolicy: ConflictResolutionPolicy;
  readonly scope: Scope;
  readonly cap: number;
  readonly isM9Promotion: boolean;
}): Promise<readonly ConflictResolutionResult[]> {
  const { candidates, conflictPolicy, scope, cap, isM9Promotion } = args;
  const clusters = clusterCandidates(candidates, cap, isM9Promotion);
  const results: ConflictResolutionResult[] = [];
  for (const cluster of clusters) {
    const r = await conflictPolicy.consolidate(cluster, { scope, observationDate: new Date() });
    results.push(...r);
  }
  return results;
}

function clusterCandidates(
  candidates: readonly BoundedCandidate[],
  cap: number,
  isM9Promotion: boolean,
): readonly (readonly BoundedCandidate[])[] {
  if (candidates.length === 0) {
    return [];
  }
  // M9 promotion judges the whole session scope as ONE set (NOT pre-clustered).
  if (isM9Promotion) {
    return [candidates];
  }
  // Backward-compat: a store that does not project embeddings degrades to whole-scope.
  if (candidates.some((c) => c.embedding === undefined)) {
    return [candidates];
  }
  const withEmbedding = candidates.map((c) => ({
    ...c,
    embedding: c.embedding as readonly number[],
  }));
  return clusterByProximity(withEmbedding, cap);
}

/**
 * The full reflect consolidation phase: recall candidates, bound + judge, persist
 * supersessions, and audit an M9 promotion. Behaviour-identical to the former
 * inline `reflect()` block except that consolidation is now bounded (M24).
 */
export async function runConsolidationPhase(args: {
  readonly store: VectorStoreWithConsolidation;
  readonly conflictPolicy: ConflictResolutionPolicy;
  readonly filters: Filters;
  readonly scope: Scope;
  readonly cap: number;
  readonly isM9Promotion: boolean;
  readonly tracer: Tracer | undefined;
  readonly routingAuditStore?: RoutingAuditStore;
}): Promise<void> {
  const { store, conflictPolicy, filters, scope, cap, isM9Promotion, tracer } = args;
  if (
    typeof store.recallConsolidationCandidates !== 'function' ||
    typeof store.persistConsolidations !== 'function'
  ) {
    throw new Error(
      'reflect: conflictResolution requires a vector store with ' +
        'recallConsolidationCandidates() + persistConsolidations() — ' +
        'use PgvectorStore from @usetheo/memory/local.',
    );
  }
  const candidates = await store.recallConsolidationCandidates(filters);
  const consolidationResults = await consolidateInBoundedClusters({
    candidates,
    conflictPolicy,
    scope,
    cap,
    isM9Promotion,
  });
  if (consolidationResults.length === 0) {
    return;
  }
  // M9: the SessionToGlobalConsolidationPolicy PROMOTES the durable representative to
  // global (session_id→NULL). Any other policy keeps the kept row in place. Never crosses
  // (workspace, user) (the store's candidate scoping guards that).
  const promotedCount = await store.persistConsolidations(
    consolidationResults,
    isM9Promotion ? { promote: true } : undefined,
  );
  // Observe only ACTUAL promotions (persistConsolidations returns rows truly flipped,
  // so an idempotent re-run reports 0, never over-counts).
  if (isM9Promotion && promotedCount > 0) {
    emitEvent(tracer, 'consolidation_promoted', {
      scope_tier: scope.kind,
      promoted_count: promotedCount,
    });
    await auditM9Promotion(args.routingAuditStore, filters, scope, tracer);
  }
}

/** Best-effort/fail-soft (Rule 8) audit of an M9 session→global promotion. */
async function auditM9Promotion(
  routingAuditStore: RoutingAuditStore | undefined,
  filters: Filters,
  scope: Scope,
  tracer: Tracer | undefined,
): Promise<void> {
  if (routingAuditStore === undefined) {
    return;
  }
  await recordRoutingDecision(
    routingAuditStore,
    {
      workspaceId: filters.workspace_id ?? 'default',
      userId: filters.user_id ?? (scope.kind === 'session' ? scope.userId ?? 'system' : 'system'),
      chosenScope: 'global',
      attribution: 'agent',
      decidedBy: 'm9-promotion',
      why: 'promotion-distinct-source-threshold',
      at: new Date(),
    },
    tracer,
  );
}
