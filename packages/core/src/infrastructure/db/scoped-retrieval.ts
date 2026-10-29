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
function recallTraceDeps(
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

/**
 * M15 T3.1 (#122) — the entity-graph slice the recall pipeline needs for Step 6.
 *
 * Spread into BOTH pipeline call sites (cached and uncached) so the boost is not silently
 * absent on one of the two paths. Omitted entirely when no entity store is configured, so
 * a deployment without a populated graph behaves exactly as before.
 *
 * `config.entityBoost === false` also turns it off, honouring ADR-0007 on the READ side.
 * The flag already gates the WRITE side (the factory skips instantiating the entity store),
 * so in the default wiring "flag off" implies "no store" and this check is redundant — but a
 * consumer who injects their own `memoryEntityStore` while setting the flag to `false` would
 * otherwise get a boost the documented contract says is disabled.
 */
function entityBoostDeps(ctx: RetrievalContext): {
  entityBoostStore?: LocalMemoryConfig['memoryEntityStore'];
} {
  const store = ctx.config.memoryEntityStore;
  if (store === undefined || ctx.config.entityBoost === false) return {};
  // The tenant anchor is NOT copied here: the pipeline already receives `filters`, which
  // carries it. A second carrier could disagree with the first, and the JOIN would then match
  // zero rows without throwing — a silently-zero boost, which is the #122 failure class.
  return { entityBoostStore: store };
}

/**
 * The dependency fragment both pipeline call sites share: recall trace, entity boost and
 * tracer. Extracted so the cached and uncached paths cannot drift apart — a signal silently
 * present on one path and absent on the other is the failure mode this guards against.
 */
function sharedPipelineDeps(ctx: RetrievalContext, options?: RecallOptions) {
  return {
    ...recallTraceDeps(ctx, options),
    ...entityBoostDeps(ctx),
    ...(ctx.config.tracer !== undefined ? { tracer: ctx.config.tracer } : {}),
  };
}

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
  // attributedTo / rerank / graphExpand / scopes / adaptive outcome, so ANY of those set
  // BYPASSES the cache (serving a cached plain result would be a correctness bug).
  // M10 F-arch-1: `scopes` reorders the pool exactly like rerank/graphExpand — a HIT would
  // skip the reweight and a MISS would store the reweighted order under a scopes-blind key,
  // poisoning a later plain recall (breaking "default byte-identical"). It MUST bypass too.
  const cache = ctx.recallCacheStore;
  // M22 / #141 (ADR D3): recencyCollapse re-orders/prunes the pool like scopes/rerank/
  // graphExpand and is NOT in the cache key, so it MUST bypass too (else a cached plain
  // result poisons a collapse request, and vice-versa).
  const cacheApplicable =
    cache !== undefined &&
    options?.asOf === undefined &&
    options?.attributedTo === undefined &&
    options?.rerank === undefined &&
    options?.graphExpand === undefined &&
    options?.scopes === undefined &&
    options?.recencyCollapse === undefined &&
    ctx.config.retrievalPolicy === undefined;

  if (!cacheApplicable || cache === undefined) {
    return runRetrievalPipeline(query, applySkillFilters(ctx.filters, options), {
      vectorStore: ctx.config.vectorStore,
      embedder: ctx.config.embedder,
      ...(ctx.config.reranker !== undefined ? { reranker: ctx.config.reranker } : {}),
      ...(ctx.config.retrievalPolicy !== undefined ? { retrievalPolicy: ctx.config.retrievalPolicy } : {}),
      ...(ctx.config.graphExpansionStore !== undefined ? { graphExpansionStore: ctx.config.graphExpansionStore } : {}),
      ...sharedPipelineDeps(ctx, options),
    }, options);
  }

  // Cache-aware path: embed once, consult cache, populate on miss.
  const queryEmbedding = await ctx.config.embedder.embed(query);
  const cached = await cache.get(queryEmbedding, ctx.scope, ctx.filters.workspace_id ?? undefined);
  if (cached !== undefined && cached.results.every((item) => item.expiresAt == null || new Date(item.expiresAt).getTime() > Date.now())) {
    return [...cached.results];
  }
  // T3.1 — wall-clock latency for the MISS path. Dynamic import keeps the metrics
  // module OUT of the default barrel's static graph (bundle isolation).
  const missStart = performance.now();
  const results = await runRetrievalPipeline(query, applySkillFilters(ctx.filters, options), {
    vectorStore: ctx.config.vectorStore,
    embedder: ctx.config.embedder,
    ...sharedPipelineDeps(ctx, options),
  }, options);
  const ttlSeconds = resolveCacheTtl(ctx.scope, ctx.config.recallCache);
  // The cache write is a write-behind optimization — best-effort. A failure (SERIALIZABLE retry
  // exhaustion under contention #132, connection reset, …) must NEVER reject the recall: the
  // results are already computed. Degrade to an observable cache MISS and return them (#132).
  try {
    await cache.set(queryEmbedding, ctx.scope, results, ttlSeconds, ctx.filters.workspace_id ?? undefined);
  } catch (err) {
    emitEvent(ctx.config.tracer, 'recall_cache_write_failed', {
      scope_tier: ctx.scope.kind,
      error: err instanceof Error ? err.name : 'unknown',
    });
  }
  const { getRecallCacheMissDurationHistogram } = await import('./recall-cache/recall-cache-metrics.js');
  getRecallCacheMissDurationHistogram().record(performance.now() - missStart, {
    scope_tier: ctx.scope.kind,
    embedder_kind: ctx.config.embedder.constructor.name,
  });
  return results;
}
