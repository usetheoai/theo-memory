/**
 * Scoped recall retrieval path extracted from `scoped-memory.ts` (M8 T0 refactor).
 * `this`-free: takes an explicit `RetrievalContext` bundle instead of a class
 * instance, so the recall pipeline logic is unit-testable in isolation and the
 * host file stays under the 300-LoC budget. Behavior is byte-identical to the
 * former `LocalScopedMemory.retrieveResults` / `recallTraceDeps` methods.
 */
import { randomUUID } from 'node:crypto';

import type { RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import {
  DEFAULT_MAX_ROWS_PER_RECALL,
  type RecallTraceStore,
  type RecallTraceStoreConfig,
} from '../../domain/dip/recall-trace-store.js';
import { emitEvent } from '../../domain/memory-event.js';
import type { MemoryItemWithScore } from '../../domain/memory-item.js';
import type { RecallOptions } from '../../domain/options.js';
import { DEFAULT_WORKSPACE_ID } from '../../domain/principal.js';
import { runRetrievalPipeline } from '../../domain/retrieval/pipeline.js';
import type { Filters, Scope } from '../../domain/scope.js';

import { resolveCacheTtl } from './cache-helpers.js';
import type { LocalMemoryConfig } from './config.js';
import { deriveScopeKey } from './recall-cache/scope-key.js';
import { applySkillFilters } from './scope-filters.js';

/** The instance state the recall path reads — bundled so the logic is `this`-free. */
export interface RetrievalContext {
  readonly scope: Scope;
  readonly filters: Filters;
  readonly config: LocalMemoryConfig;
  readonly recallCacheStore: RecallCacheStore | undefined;
  readonly recallTraceStore: RecallTraceStore | undefined;
}

/**
 * explainable-recall (S1) — the recall-trace deps fragment spread into the
 * pipeline's `RetrievalDeps`. Empty when tracing is OFF. Mints a FRESH `recallId`
 * per recall; resolves the tenant `workspaceId`/`scopeKey` HERE (EC-2 — never from
 * the pipeline) and threads `maxRows` (Finding A).
 */
export function recallTraceDeps(
  ctx: RetrievalContext,
  options?: RecallOptions,
): {
  recallTrace?: RecallTraceStore;
  recallTraceContext?: { recallId: string; workspaceId: string; scopeKey: string; maxRows: number };
} {
  const store = ctx.recallTraceStore;
  if (store === undefined) {
    return {};
  }
  // explainable-recall S2 — a caller-supplied recallId (REST handler) keys the
  // trace so it can be returned + looked up; empty/absent ⇒ mint a fresh UUID.
  const suppliedId = options?.recallId;
  const recallId = suppliedId !== undefined && suppliedId.length > 0 ? suppliedId : randomUUID();
  const workspaceId = ctx.filters.workspace_id ?? DEFAULT_WORKSPACE_ID;
  // A config POJO carries maxRowsPerRecall; a store INSTANCE (has record())
  // caps internally, so the pipeline uses the default here (double-cap is safe).
  const cfg = ctx.config.recallTrace;
  const isConfigPojo = cfg !== undefined && typeof (cfg as { record?: unknown }).record !== 'function';
  // M4 (ADR-2) — fail-closed per-workspace opt-out, checked in-memory (no
  // per-recall DB read): a disabled workspace writes ZERO trace rows.
  if (isConfigPojo && (cfg as RecallTraceStoreConfig).disabledWorkspaces?.includes(workspaceId)) {
    return {};
  }
  const maxRows = isConfigPojo
    ? ((cfg as RecallTraceStoreConfig).maxRowsPerRecall ?? DEFAULT_MAX_ROWS_PER_RECALL)
    : DEFAULT_MAX_ROWS_PER_RECALL;
  return {
    recallTrace: store,
    recallTraceContext: { recallId, workspaceId, scopeKey: deriveScopeKey(ctx.scope, workspaceId), maxRows },
  };
}

/** The cache-aware 9-step retrieval (adaptive gate → cache bypass/hit/miss). */
export async function retrieveResults(
  ctx: RetrievalContext,
  query: string,
  options?: RecallOptions,
): Promise<readonly MemoryItemWithScore[]> {
  // adaptive-retrieval T3.1 / ADR D2 (Item 13) — `shouldRetrieve` PRE-embed gate.
  // Opt-in: ONLY when a retrievalPolicy is wired. Fail-soft (ADR D4): a
  // shouldRetrieve outage NEVER takes down recall — on throw, proceed normally.
  const adaptivePolicy = ctx.config.retrievalPolicy;
  if (adaptivePolicy !== undefined) {
    try {
      const decision = await adaptivePolicy.shouldRetrieve(query, ctx.scope);
      if (!decision.retrieve) {
        emitEvent(ctx.config.tracer, 'retrieval_skipped', {
          scope_tier: ctx.scope.kind,
          reason: decision.reason ?? 'policy',
        });
        return [];
      }
    } catch (err) {
      // fail-soft — degrade to normal retrieval (do NOT skip on a policy error).
      emitEvent(ctx.config.tracer, 'retrieval_policy_failed', {
        scope_tier: ctx.scope.kind,
        hook: 'should_retrieve',
        error: err instanceof Error ? err.name : 'unknown',
      });
    }
  }

  // semantic-recall-cache-v1-5 T2.1 — cache applicability boundary (ADR D8).
  // The v1.5 cache key is (scope_key, query_embedding) — it does NOT encode asOf /
  // attributedTo / rerank / graphExpand / adaptive outcome, so ANY of those set
  // BYPASSES the cache (serving a cached plain result would be a correctness bug).
  const cache = ctx.recallCacheStore;
  const cacheApplicable =
    cache !== undefined &&
    options?.asOf === undefined &&
    options?.attributedTo === undefined &&
    options?.rerank === undefined &&
    options?.graphExpand === undefined &&
    ctx.config.retrievalPolicy === undefined;

  if (!cacheApplicable || cache === undefined) {
    return runRetrievalPipeline(query, applySkillFilters(ctx.filters, options), {
      vectorStore: ctx.config.vectorStore,
      embedder: ctx.config.embedder,
      ...(ctx.config.reranker !== undefined ? { reranker: ctx.config.reranker } : {}),
      ...(ctx.config.retrievalPolicy !== undefined ? { retrievalPolicy: ctx.config.retrievalPolicy } : {}),
      ...(ctx.config.graphExpansionStore !== undefined ? { graphExpansionStore: ctx.config.graphExpansionStore } : {}),
      ...recallTraceDeps(ctx, options),
      ...(ctx.config.tracer !== undefined ? { tracer: ctx.config.tracer } : {}),
    }, options);
  }

  // Cache-aware path: embed once, consult cache, populate on miss.
  const queryEmbedding = await ctx.config.embedder.embed(query);
  const cached = await cache.get(queryEmbedding, ctx.scope, ctx.filters.workspace_id ?? undefined);
  if (cached !== undefined) {
    return [...cached.results];
  }
  // T3.1 — wall-clock latency for the MISS path. Dynamic import keeps the metrics
  // module OUT of the default barrel's static graph (bundle isolation).
  const missStart = performance.now();
  const results = await runRetrievalPipeline(query, applySkillFilters(ctx.filters, options), {
    vectorStore: ctx.config.vectorStore,
    embedder: ctx.config.embedder,
    ...recallTraceDeps(ctx, options),
    ...(ctx.config.tracer !== undefined ? { tracer: ctx.config.tracer } : {}),
  }, options);
  const ttlSeconds = resolveCacheTtl(ctx.scope, ctx.config.recallCache);
  await cache.set(queryEmbedding, ctx.scope, results, ttlSeconds, ctx.filters.workspace_id ?? undefined);
  const { getRecallCacheMissDurationHistogram } = await import('./recall-cache/recall-cache-metrics.js');
  getRecallCacheMissDurationHistogram().record(performance.now() - missStart, {
    scope_tier: ctx.scope.kind,
    embedder_kind: ctx.config.embedder.constructor.name,
  });
  return results;
}
