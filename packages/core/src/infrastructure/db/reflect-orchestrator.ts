/**
 * Reflection orchestrator for the local runtime.
 *
 * Extracted from `LocalScopedMemory.reflect()` (scoped-memory.ts) to keep that
 * file under the 500-LoC soft budget per `rules/architecture.md`. Pure function
 * over an explicit dependency bag — no `this`, fully unit-testable in isolation.
 *
 * Carries `scopeToCounterTuple` plus the two structural store-extension
 * interfaces (derived-insert + consolidation) that only the reflection path
 * consumes, so they live next to their single caller instead of in the class
 * module.
 *
 */
import { DEFAULT_CLUSTER_CAP } from '../../domain/conflict-resolution/llm-judged-merge.js';
import { SESSION_TO_GLOBAL_KIND } from '../../domain/consolidation/session-to-global-policy.js';
import type { RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import type { ReflectionPolicy } from '../../domain/dip/reflection-policy.js';
import type { RoutingAuditStore } from '../../domain/dip/routing-audit-store.js';
import { ReflectionNotConfigured } from '../../domain/errors.js';
import type { MemoryItem } from '../../domain/memory-item.js';
import type { ReflectOptions } from '../../domain/options.js';
import { executeReflection } from '../../domain/reflection/execute.js';
import type { ReflectionResult } from '../../domain/reflection-result.js';
import type { Filters, Scope } from '../../domain/scope.js';

import type { LocalMemoryConfig } from './config.js';
import {
  runConsolidationPhase,
  type VectorStoreWithConsolidation,
} from './reflect-consolidation.js';
import {
  persistDraftsWithQuarantine,
  type VectorStoreWithDerivedInsert,
} from './reflect-drafts.js';
import { rowsToMemoryItems } from './row-mapping.js';

/**
 * Map a Scope onto the (userId, sessionId, agentId) column tuple persisted by
 * the store layer. RepoScope persists `repoId` in the `agent_id` column per
 * v0.6 EC-4 (mirrors `filtersFromScope`).
 */
export function scopeToCounterTuple(scope: Scope): {
  userId: string | null;
  sessionId: string | null;
  agentId: string | null;
} {
  switch (scope.kind) {
    case 'user':
      return { userId: scope.userId, sessionId: null, agentId: null };
    case 'session':
      return { userId: scope.userId ?? null, sessionId: scope.sessionId, agentId: null };
    case 'agent':
      return { userId: scope.userId ?? null, sessionId: null, agentId: scope.agentId };
    case 'repo':
      // v0.6 (EC-4): RepoScope persists `repoId` in the `agent_id` column at the
      // store layer (see filtersFromScope). Counter rows mirror that mapping.
      return { userId: null, sessionId: null, agentId: scope.repoId };
  }
}

/**
 * Build + fire-and-return a zero-derivation reflection result. Shared by the
 * three early-exit paths (empty source scope, LLM produced no drafts, every
 * draft quarantined) so the `onReflectionEnd` hook + result shape live once.
 */
async function finishEmptyReflection(
  reflectionPolicy: ReflectionPolicy,
  scope: Scope,
  sourceIds: readonly string[],
  reason: 'no-source-memories' | 'no-consolidation',
): Promise<ReflectionResult> {
  const result: ReflectionResult = {
    higherOrderMemories: [],
    sourceIds,
    derivedMemoriesCreated: 0,
    reason,
  };
  if (reflectionPolicy.onReflectionEnd !== undefined) {
    await reflectionPolicy.onReflectionEnd(scope, result);
  }
  return result;
}

/**
 * The exact slice of LocalScopedMemory state the reflection path needs, passed
 * explicitly so the orchestrator is `this`-free. `config` is narrowed to the
 * three collaborators reflect() actually touches (vectorStore, llm, embedder).
 */
export interface ReflectDeps {
  readonly reflectionPolicy: ReflectionPolicy | undefined;
  readonly config: Pick<LocalMemoryConfig, 'vectorStore' | 'llm' | 'embedder' | 'tracer'>;
  readonly filters: Filters;
  readonly scope: Scope;
  readonly recallCacheStore: RecallCacheStore | undefined;
  /** M11 — optional audit port; when wired, a session→global PROMOTION emits a fail-soft audit row. */
  readonly routingAuditStore?: RoutingAuditStore;
}

/**
 * Run the consolidation + reflection + derived-memory-persist pipeline for one
 * scope. Behaviour-identical to the former inline `reflect()` body; see the
 * EC-5 / EC-7 / EC-8 / EC-13 absorptions inline.
 */
export async function runReflection(
  deps: ReflectDeps,
  options?: ReflectOptions,
): Promise<ReflectionResult> {
  const { reflectionPolicy, config, filters, scope, recallCacheStore } = deps;
  void options;
  if (reflectionPolicy === undefined) {
    throw new ReflectionNotConfigured();
  }

  // Fetch source memories
  const [results] = await config.vectorStore.list(filters, 100);
  const sourceMemories: MemoryItem[] = rowsToMemoryItems(results, scope).items;

  // EC-5: empty-source short-circuit
  if (sourceMemories.length === 0) {
    return finishEmptyReflection(reflectionPolicy, scope, [], 'no-source-memories');
  }

  // Run policy hook
  if (reflectionPolicy.onReflectionStart !== undefined) {
    await reflectionPolicy.onReflectionStart(scope, options ?? {});
  }

  try {
    // v0.7 T2.1: pre-derivation conflict-resolution phase.
    // EC-7 absorbed: empty scope already short-circuited above
    // ("EC-5: empty-source short-circuit"); here we additionally guard on
    // sourceMemories.length < 2 (nothing to consolidate with a singleton).
    // EC-8 absorbed: persistConsolidations
    // wraps t_invalid UPDATE + insertConsolidationHistory INSERT in a
    // single withTransaction (rollback on any error). Runs BEFORE
    // executeReflection so LLM-extraction failure paths don't mask the
    // consolidation's own failure modes.
    const conflictPolicy = options?.conflictResolution;
    // F-review fix: the v0.7 distillation MERGE needs ≥2 memories to consolidate a pair, but
    // M9 promotes each durable memory INDIVIDUALLY — a lone durable session fact (3 exact
    // mentions dedup to ONE confirmation_count=3 row, the literal DoD scenario) MUST still
    // promote. So the M9 policy runs with ≥1 source memory; other policies keep the ≥2 gate.
    const isM9Promotion =
      conflictPolicy?.kind === SESSION_TO_GLOBAL_KIND && scope.kind === 'session';
    const minSources = isM9Promotion ? 1 : 2;
    if (conflictPolicy !== undefined && sourceMemories.length >= minSources) {
      // M24 (#146): bounded per-anchor consolidation. `runConsolidationPhase`
      // recalls the candidates, splits them into clusters of <= DEFAULT_CLUSTER_CAP
      // (so the LLM judge never abstains at scale — the M23 wall), judges each,
      // persists supersessions, and audits an M9 promotion.
      await runConsolidationPhase({
        store: config.vectorStore as unknown as VectorStoreWithConsolidation,
        conflictPolicy,
        filters,
        scope,
        cap: DEFAULT_CLUSTER_CAP,
        isM9Promotion,
        tracer: config.tracer,
        ...(deps.routingAuditStore !== undefined
          ? { routingAuditStore: deps.routingAuditStore }
          : {}),
      });
    }

    // Execute reflection LLM call
    const drafts = await executeReflection({
      llm: config.llm,
      sourceMemories,
      scope,
    });

    const sourceIds = sourceMemories.map((m) => m.id);

    // EC-13: LLM returned empty array (no consolidation)
    if (drafts.length === 0) {
      return finishEmptyReflection(reflectionPolicy, scope, sourceIds, 'no-consolidation');
    }

    // M24 T3.2 (#145): embed + persist drafts, QUARANTINING any provenance-invalid
    // draft (empty/hallucinated derivedFrom) rather than throwing — one bad row of
    // many must not abort an otherwise-good reflect (Rule 8 recoverable).
    const storeWithDerived = config.vectorStore as unknown as VectorStoreWithDerivedInsert;
    if (typeof storeWithDerived.insertDerivedMemory !== 'function') {
      throw new Error(
        'reflect: configured vector store does not implement insertDerivedMemory; ' +
          'pass a PgvectorStore or InMemoryVectorStore from @usetheo/memory/local.',
      );
    }

    const { persisted } = await persistDraftsWithQuarantine({
      drafts,
      sourceIds,
      embedder: config.embedder,
      store: storeWithDerived,
      scope,
      counterTuple: scopeToCounterTuple(scope),
      workspaceId: filters.workspace_id ?? null,
      tracer: config.tracer,
    });

    // Every draft was quarantined → nothing to persist (no-consolidation, no throw).
    if (persisted.length === 0) {
      return finishEmptyReflection(reflectionPolicy, scope, sourceIds, 'no-consolidation');
    }

    const result: ReflectionResult = {
      higherOrderMemories: persisted,
      sourceIds,
      derivedMemoriesCreated: persisted.length,
    };
    if (reflectionPolicy.onReflectionEnd !== undefined) {
      await reflectionPolicy.onReflectionEnd(scope, result);
    }
    // semantic-recall-cache-v1-5 T2.2 — EC-6 absorption: reflect() produces
    // derived memories (v0.4a) + distillation rows (v0.7). Without scope
    // invalidation, the cache serves stale results post-reflect for the
    // same scope. Same correctness gate as remember/forget per Item 19 AC#3.
    // Awaited sequentially (EC-11). Failures logged but do NOT poison reflect().
    if (recallCacheStore !== undefined && persisted.length > 0) {
      try {
        await recallCacheStore.invalidateScope(scope);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[themory] recall-cache invalidateScope (reflect) failed:', err);
      }
    }
    return result;
  } catch (err) {
    if (reflectionPolicy.onReflectionEnd !== undefined) {
      await reflectionPolicy.onReflectionEnd(
        scope,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    throw err;
  }
}
