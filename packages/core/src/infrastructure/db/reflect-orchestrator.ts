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
import type { ConflictResolutionResult } from '../../domain/dip/conflict-resolution-policy.js';
import type { RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import { recordRoutingDecision, type RoutingAuditStore } from '../../domain/dip/routing-audit-store.js';
import type { ReflectionPolicy } from '../../domain/dip/reflection-policy.js';
import { ReflectionNotConfigured } from '../../domain/errors.js';
import { SESSION_TO_GLOBAL_KIND } from '../../domain/consolidation/session-to-global-policy.js';
import { emitEvent } from '../../domain/memory-event.js';
import type { MemoryItem } from '../../domain/memory-item.js';
import type { ReflectOptions } from '../../domain/options.js';
import { executeReflection } from '../../domain/reflection/execute.js';
import { validateProvenance } from '../../domain/reflection/provenance.js';
import type { ReflectionResult } from '../../domain/reflection-result.js';
import type { Filters, Scope } from '../../domain/scope.js';

import type { LocalMemoryConfig } from './config.js';

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

interface VectorStoreWithDerivedInsert {
  insertDerivedMemory(args: {
    text: string;
    hash: string;
    embedding: readonly number[];
    derivedFrom: readonly string[];
    scope: {
      workspaceId?: string | null;
      userId?: string | null;
      sessionId?: string | null;
      agentId?: string | null;
    };
  }): Promise<string>;
}

interface VectorStoreWithConsolidation {
  recallConsolidationCandidates?: (
    filters: Filters,
  ) => Promise<readonly { memoryId: string; text: string; createdAt: Date; confirmationCount?: number }[]>;
  persistConsolidations?: (
    results: readonly ConflictResolutionResult[],
    options?: { readonly promote?: boolean },
  ) => Promise<number>;
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
  const sourceMemories: MemoryItem[] = results.map((r) => ({
    id: r.id,
    text: String(r.payload['text'] ?? ''),
    hash: String(r.payload['hash'] ?? r.id),
    scope,
    metadata: { ...r.payload },
    createdAt: new Date(),
    updatedAt: new Date(),
    tValid: new Date(),
    tInvalid: null,
  }));

  // EC-5: empty-source short-circuit
  if (sourceMemories.length === 0) {
    const result: ReflectionResult = {
      higherOrderMemories: [],
      sourceIds: [],
      derivedMemoriesCreated: 0,
      reason: 'no-source-memories',
    };
    if (reflectionPolicy.onReflectionEnd !== undefined) {
      await reflectionPolicy.onReflectionEnd(scope, result);
    }
    return result;
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
      const storeWithConsolidate = config.vectorStore as unknown as VectorStoreWithConsolidation;
      if (
        typeof storeWithConsolidate.recallConsolidationCandidates !== 'function' ||
        typeof storeWithConsolidate.persistConsolidations !== 'function'
      ) {
        throw new Error(
          'reflect: conflictResolution requires a vector store with ' +
            'recallConsolidationCandidates() + persistConsolidations() — ' +
            'use PgvectorStore from @usetheo/memory/local.',
        );
      }
      const candidates = await storeWithConsolidate.recallConsolidationCandidates(
        filters,
      );
      const consolidationResults = await conflictPolicy.consolidate(
        candidates,
        { scope, observationDate: new Date() },
      );
      if (consolidationResults.length > 0) {
        // M9 (T3.1): the SessionToGlobalConsolidationPolicy on a session scope PROMOTES the
        // durable representative to global (session_id→NULL). Any other policy (v0.7
        // distillation) keeps the kept row in place. Never crosses (workspace, user) (the
        // store's candidate scoping guards that).
        const promotedCount = await storeWithConsolidate.persistConsolidations(
          consolidationResults,
          isM9Promotion ? { promote: true } : undefined,
        );
        // pillar (c) — observe only ACTUAL promotions (F-arch-3: persistConsolidations returns
        // the rows truly flipped, so an idempotent re-run reports 0, never over-counts).
        if (isM9Promotion && promotedCount > 0) {
          emitEvent(config.tracer, 'consolidation_promoted', {
            scope_tier: scope.kind,
            promoted_count: promotedCount,
          });
          // M11 F-tests-1 — audit the PROMOTION decision (session→global). Best-effort/fail-soft
          // (Rule 8): a failed audit never fails the promotion. Keyed by the same (workspace, user)
          // the promoted rows live under, so it is retrievable via the same audit surface as routing.
          if (deps.routingAuditStore !== undefined) {
            await recordRoutingDecision(
              deps.routingAuditStore,
              {
                workspaceId: filters.workspace_id ?? 'default',
                userId: filters.user_id ?? (scope.kind === 'session' ? scope.userId ?? 'system' : 'system'),
                chosenScope: 'global',
                attribution: 'agent',
                decidedBy: 'm9-promotion',
                why: 'promotion-confirmation-threshold',
                at: new Date(),
              },
              config.tracer,
            );
          }
        }
      }
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
      const result: ReflectionResult = {
        higherOrderMemories: [],
        sourceIds,
        derivedMemoriesCreated: 0,
        reason: 'no-consolidation',
      };
      if (reflectionPolicy.onReflectionEnd !== undefined) {
        await reflectionPolicy.onReflectionEnd(scope, result);
      }
      return result;
    }

    // Provenance validation (throws ReflectionProvenanceMissingError on fail)
    validateProvenance(drafts, sourceIds);

    // Embed + persist drafts. Store extension provides insertDerivedMemory.
    const storeWithDerived = config.vectorStore as unknown as VectorStoreWithDerivedInsert;
    if (typeof storeWithDerived.insertDerivedMemory !== 'function') {
      throw new Error(
        'reflect: configured vector store does not implement insertDerivedMemory; ' +
          'pass a PgvectorStore or InMemoryVectorStore from @usetheo/memory/local.',
      );
    }

    const counterTuple = scopeToCounterTuple(scope);
    const persisted: MemoryItem[] = [];
    for (const draft of drafts) {
      const embedding = await config.embedder.embed(draft.text);
      const hash = `derived-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
      const id = await storeWithDerived.insertDerivedMemory({
        text: draft.text,
        hash,
        embedding,
        derivedFrom: draft.derivedFrom,
        // multi-tenant-workspace-isolation /review F-dom-api-2: the reflection-
        // derived row stays in the SAME workspace as its sources (the bound
        // workspace flows in via filters.workspace_id), not the 'default' tenant.
        scope: { ...counterTuple, workspaceId: filters.workspace_id ?? null },
      });
      persisted.push({
        id,
        text: draft.text,
        hash,
        scope,
        metadata: { kind: 'derived' },
        createdAt: new Date(),
        updatedAt: new Date(),
        tValid: new Date(),
        tInvalid: null,
      });
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
