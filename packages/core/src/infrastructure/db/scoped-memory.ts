/**
 * LocalScopedMemory — the scoped memory implementation for the local runtime.
 *
 * M8 T0 refactor: the pure scope→filter helpers moved to `scope-filters.ts`, the
 * shared row mapping to `row-mapping.ts`, and the cache-aware retrieval path to
 * `scoped-retrieval.ts` — so this file stays under the 300-LoC budget. The helper
 * functions are re-exported below for backward compatibility with existing importers.
 */
import type { RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import type { RecallTraceStore } from '../../domain/dip/recall-trace-store.js';
import type { ReflectionPolicy } from '../../domain/dip/reflection-policy.js';
import {
  type EpisodeListOptions,
  type EpisodePage,
  encodeEpisodeCursor,
  resolveEpisodeLimit,
} from '../../domain/episode.js';
import { InvalidScope, MemoryNotFound } from '../../domain/errors.js';
import { runExtractionPipeline } from '../../domain/extraction/pipeline.js';
import { emitEvent } from '../../domain/memory-event.js';
import type { MemoryItem, MemoryItemWithScore } from '../../domain/memory-item.js';
import type { ScopedMemory, SessionSummary } from '../../domain/memory-store.js';
import type { Message } from '../../domain/message.js';
import { resolveOntology } from '../../domain/ontology.js';
import type {
  ForgetOptions,
  GetAllOptions,
  RecallOptions,
  ReflectOptions,
  RememberOptions,
} from '../../domain/options.js';
import type { ReflectionResult } from '../../domain/reflection-result.js';
import type { Filters, Scope } from '../../domain/scope.js';

import type { LocalMemoryConfig } from './config.js';
import { runReflection } from './reflect-orchestrator.js';
import { rowsToMemoryItems } from './row-mapping.js';
import { getAllItems, listScopeSessions } from './scoped-listing.js';
import { type RetrievalContext, retrieveResults } from './scoped-retrieval.js';

// Backward-compat re-exports (M8 T0 — helpers moved to scope-filters.ts).
export {
  applySkillFilters,
  filtersFromScope,
  assertScopeIsNonEmpty,
  deriveScopeFromPayload,
} from './scope-filters.js';

export class LocalScopedMemory implements ScopedMemory {
  constructor(
    private readonly scope: Scope,
    private readonly filters: Filters,
    private readonly config: LocalMemoryConfig,
    private readonly reflectionPolicy: ReflectionPolicy | undefined,
    /** v0.4a EC-7: shared pending-reflections set owned by LocalMemory. */
    private readonly pendingReflections: Set<Promise<unknown>> = new Set(),
    /** semantic-recall-cache-v1-5 T2.1 — opt-in cache wrap; undefined = unchanged behavior. */
    private readonly recallCacheStore: RecallCacheStore | undefined = undefined,
    /** explainable-recall (S1) — opt-in recall-trace store; undefined = no tracing. */
    private readonly recallTraceStore: RecallTraceStore | undefined = undefined,
  ) {}

  /** Bundle the instance state the extracted recall path reads (M8 T0). */
  private retrievalContext(): RetrievalContext {
    return {
      scope: this.scope,
      filters: this.filters,
      config: this.config,
      recallCacheStore: this.recallCacheStore,
      recallTraceStore: this.recallTraceStore,
    };
  }

  /**
   * Best-effort scope cache invalidation shared by remember (post-write) and
   * forget (post-delete). A cache failure is a degraded path — logged loudly, never
   * propagated (the write/delete already succeeded).
   */
  private async invalidateCacheScope(source: string): Promise<void> {
    if (this.recallCacheStore === undefined) {
      return;
    }
    try {
      await this.recallCacheStore.invalidateScope(this.scope, this.filters.workspace_id ?? undefined);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[themory] recall-cache invalidateScope (${source}) failed:`, err);
    }
  }

  async remember(text: string, options?: RememberOptions): Promise<readonly MemoryItem[]> {
    const messages: readonly Message[] = [{ role: 'user', content: text }];
    const result = await runExtractionPipeline(messages, this.filters, {
      vectorStore: this.config.vectorStore,
      embedder: this.config.embedder,
      llm: this.config.llm,
      ...(this.config.historyManager !== undefined ? { historyManager: this.config.historyManager } : {}),
      ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
      ...(this.config.customInstructions !== undefined ? { customInstructions: this.config.customInstructions } : {}),
      // entity-extraction-nodes-slice1 T3.1 — thread Phase 7 ports (factory sets
      // them when entityBoost !== false); both present → Phase 7 runs.
      ...(this.config.entityExtractor !== undefined ? { entityExtractor: this.config.entityExtractor } : {}),
      ...(this.config.memoryEntityStore !== undefined ? { memoryEntityStore: this.config.memoryEntityStore } : {}),
      // slice2 T3.2 — thread the edge port so Phase 7 edge linking runs.
      ...(this.config.memoryGraphStore !== undefined ? { memoryGraphStore: this.config.memoryGraphStore } : {}),
      // domain-ontologies T3.1 — resolve the ontology config (key|object) to a concrete Ontology.
      ...(this.config.ontology !== undefined ? { ontology: resolveOntology(this.config.ontology) } : {}),
      // auto-categorization-write-pipeline F-H1 — thread the config (default-on when absent).
      ...(this.config.autoCategorize !== undefined ? { autoCategorize: this.config.autoCategorize } : {}),
    }, options);

    if (result.length > 0 && result.every(item => item.idempotentReplay === true)) return result;

    // v0.4b-fixes T4.1: post-remember hook for the capacity-trigger pipeline.
    // Awaited inline so consumers' next remember() sees the post-evict state.
    // Errors do NOT block remember() result (observability-only).
    if (this.config.postRememberHook !== undefined) {
      try {
        await this.config.postRememberHook(this.scope, this.filters.workspace_id ?? undefined);
      } catch {
        // Eviction failures are observability-only; do not poison remember().
      }
    }

    // semantic-recall-cache-v1-5 T2.2 — Item 19 AC#3: write-trigger cache
    // invalidation post-success (EC-11: AWAITED sequentially so the consumer's next
    // recall() in the same scope sees the fresh post-write state).
    await this.invalidateCacheScope('remember');

    // v0.4a: after a successful write, check ReflectionPolicy. If it says fire,
    // launch reflect() as fire-and-forget tracked via pendingReflections (EC-7).
    if (this.reflectionPolicy !== undefined && this.reflectionPolicy.kind !== 'manual') {
      try {
        const trigger = { kind: this.reflectionPolicy.kind } as const;
        const fire = await this.reflectionPolicy.shouldReflect(this.scope, trigger);
        if (fire) {
          const promise = this.reflect()
            .catch(() => {
              // EC-12: failed reflection does NOT roll back the counter.
            })
            .finally(() => {
              this.pendingReflections.delete(promise);
            });
          this.pendingReflections.add(promise);
        }
      } catch {
        // Policy decision failures must not block remember().
      }
    }

    return result;
  }

  async recall(query: string, options?: RecallOptions): Promise<readonly MemoryItemWithScore[]> {
    // v1.1 T3.1 + EC-3 + ADR-0011: boundary validation rejects an invalid Date
    // (architecture.md § 8). A rejected recall does NOT count — the throw precedes
    // the increment.
    if (options?.asOf !== undefined && Number.isNaN(options.asOf.getTime())) {
      throw new InvalidScope('asOf must be a valid Date');
    }

    const results = await retrieveResults(this.retrievalContext(), query, options);

    // T2.3 — per-scope recall usage counter (once per recall across all paths).
    // FAIL-SOFT (Princípio 3): a counter write MUST NEVER fail a recall. EC-6: skill
    // (repo) scope is served by LocalScopedSkillMemory (not wired to the counter).
    const counter = this.config.usageCounterStore;
    if (counter !== undefined) {
      try {
        await counter.increment(this.filters);
      } catch (err) {
        emitEvent(this.config.tracer, 'retrieval_counted_failed', {
          scope_tier: this.scope.kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  async reflect(options?: ReflectOptions): Promise<ReflectionResult> {
    // Orchestration extracted to reflect-orchestrator.ts (this-free, unit-testable).
    return runReflection(
      {
        reflectionPolicy: this.reflectionPolicy,
        config: this.config,
        filters: this.filters,
        scope: this.scope,
        recallCacheStore: this.recallCacheStore,
        // M11 — thread the audit port so a session→global promotion emits a fail-soft audit row.
        ...(this.config.routingAuditStore !== undefined ? { routingAuditStore: this.config.routingAuditStore } : {}),
      },
      options,
    );
  }

  /**
   * Subject-scoped delete (themory-scoped-forget T1.1, ADR D1). Deletes the row
   * ONLY if it belongs to THIS scope (+ workspace); a cross-scope / cross-workspace
   * / missing id → MemoryNotFound (→ 404, no existence leak). Cache invalidation +
   * history are best-effort (a side-effect failure does NOT undo the delete).
   */
  async forget(memoryId: string, options?: ForgetOptions): Promise<void> {
    const matched = await this.config.vectorStore.deleteInScope(memoryId, this.filters, options?.hard ?? false);
    if (!matched) {
      throw new MemoryNotFound(`memoryId ${memoryId} not found in this scope`);
    }
    // Stale cache after a delete is a real bug — invalidate this scope (best-effort).
    await this.invalidateCacheScope('scoped forget');
    if (this.config.historyManager !== undefined) {
      try {
        await this.config.historyManager.addHistory(memoryId, '', null, 'forget', new Date());
      } catch {
        // history persistence failure must not block forget
      }
    }
  }

  /** #113 — real scope total from the store's COUNT (list() already computes it). */
  async count(): Promise<number> {
    const [, total] = await this.config.vectorStore.list(this.filters, 1);
    return total;
  }

  /**
   * Session enumeration (session-separation fix 2026-07-23) — internals in
   * `scoped-listing.ts` (module-budget split; skills-methods duck-typed
   * precedent, kept off the VectorStore DIP per ADR-0008).
   */
  async listSessions(): Promise<readonly SessionSummary[]> {
    return listScopeSessions(this.config, this.filters);
  }

  /** Paged scope listing; `entity` option = theo-cloud#252 memory_entities filter. */
  async getAll(options?: GetAllOptions): Promise<readonly MemoryItem[]> {
    return getAllItems(this.config, this.scope, this.filters, options);
  }

  /**
   * first-class-episodes M2 T2.2 — episodic / message-log read surface. Reuses the
   * SAME `this.filters` the recall/forget/getAll paths use (isolation parity is
   * automatic). Delegates the temporal query to `vectorStore.listEpisodes` (cursor
   * + asOf + t_invalid at the store, EC-1), then trims the cap+1 over-fetch and
   * computes `nextCursor` from the last kept row (EC-3). EC-3: an invalid `asOf`
   * throws `InvalidScope` BEFORE any query runs.
   */
  async episodes(options?: EpisodeListOptions): Promise<EpisodePage> {
    if (options?.asOf !== undefined && Number.isNaN(options.asOf.getTime())) {
      throw new InvalidScope('asOf must be a valid Date');
    }
    const cap = resolveEpisodeLimit(options?.limit);
    const rows = await this.config.vectorStore.listEpisodes(this.filters, options ?? {});
    const hasMore = rows.length > cap;
    const kept = hasMore ? rows.slice(0, cap) : rows;
    const { items, fallbackCount } = rowsToMemoryItems(kept, this.scope);
    if (fallbackCount > 0) {
      emitEvent(this.config.tracer, 'getall_temporal_fallback', { count: fallbackCount });
    }
    if (!hasMore || items.length === 0) {
      return { items };
    }
    const last = items[items.length - 1] as MemoryItem;
    return { items, nextCursor: encodeEpisodeCursor(last.createdAt, last.id) };
  }
}
