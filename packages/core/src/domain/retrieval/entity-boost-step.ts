/**
 * Step 6 of the recall pipeline — the entity boost (M15 / theo-memory#122).
 *
 * Until M15 this step created an empty `Map` and never filled it, so `combineScores` summed
 * a third component that was always `0`: what the docs called "semantic + BM25 + entity
 * boost" was, in practice, "semantic + BM25". The entity graph has been populated since
 * M13; this connects it to the ranking.
 *
 * Lives in its own module rather than inline in `pipeline.ts` because it is a distinct
 * stage with its own failure mode, and because the pipeline file is already far past the
 * repo's size budget (tracked separately — see the implementation log).
 */
import type { MemoryEntityStore } from '../dip/memory-entity-store.js';
import { emitEvent } from '../memory-event.js';
import type { Filters } from '../scope.js';
import { entityBoost } from '../scoring.js';

import { countMatchedEntitiesPerMemory } from './entity-query-match.js';

/**
 * Ceiling for the entity lookup on the hot read path.
 *
 * The plan's Failure-scenarios section promised a timeout would degrade the boost, but only a
 * THROWN error did. A query that hangs — a saturated pool, a lock, a wedged connection — has
 * no error to catch, so it would hang every recall behind it. Recall is a read path: losing
 * the third signal is far cheaper than blocking the caller.
 */
const DEFAULT_BOOST_TIMEOUT_MS = 750;

/** Rejects when `promise` outruns `ms`, so the caller's catch can degrade. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('EntityBoostTimeout'));
        }, ms);
        // Never hold the process open just for this guard.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The narrow slice of the pipeline's dependencies this stage needs (ISP). */
export interface EntityBoostDeps {
  readonly entityBoostStore?: Pick<MemoryEntityStore, 'linkedKeysForMemories'> | undefined;
  /** Overrides {@link DEFAULT_BOOST_TIMEOUT_MS}. Exists so tests can prove the guard fires. */
  readonly timeoutMs?: number | undefined;
  readonly tracer?: Parameters<typeof emitEvent>[0];
}

/**
 * Returns the per-candidate entity boost, keyed by memory id. Candidates with no matched
 * entity are ABSENT from the map, which keeps `entityBoostById.size > 0` an honest
 * predicate for "the entity signal contributed to this query".
 *
 * Degrades to an empty map — never throws — in three cases:
 *
 * - no entity store configured (a valid deployment, not a failure);
 * - no candidates to look up;
 * - the store threw (timeout, connection reset, …).
 *
 * The third case emits `entity_boost_degraded`. Recall is a read path, so losing the third
 * signal beats returning an error to the caller — but a silent degradation would recreate
 * the very defect this change fixes: a boost that is quietly always zero and that nobody
 * can see. Swallowing without recording would also violate the project's error-handling rule
 * § 2.
 */
export async function computeEntityBoost(
  query: string,
  candidateIds: readonly string[],
  filters: Filters,
  deps: EntityBoostDeps,
): Promise<Map<string, number>> {
  const boostById = new Map<string, number>();
  const store = deps.entityBoostStore;
  if (store === undefined || candidateIds.length === 0) {
    return boostById;
  }

  let linkedKeys: ReadonlyMap<string, readonly string[]>;
  try {
    linkedKeys = await withTimeout(
      store.linkedKeysForMemories({ memoryIds: candidateIds, filters }),
      deps.timeoutMs ?? DEFAULT_BOOST_TIMEOUT_MS,
    );
  } catch (err: unknown) {
    emitEvent(deps.tracer, 'entity_boost_degraded', {
      error: err instanceof Error ? err.name : 'unknown',
    });
    return boostById;
  }

  for (const [memoryId, numLinked] of countMatchedEntitiesPerMemory(query, linkedKeys)) {
    boostById.set(memoryId, entityBoost(numLinked));
  }

  // Liveness, not just failure. A `boosted` of 0 is a legitimate outcome (the query mentions
  // nothing in the graph), but a scope where it stays 0 across every recall is the dead
  // signal of #122 coming back — and that state throws nothing, so the catch above would
  // never see it.
  emitEvent(deps.tracer, 'entity_boost_applied', {
    candidates: candidateIds.length,
    boosted: boostById.size,
  });
  return boostById;
}
