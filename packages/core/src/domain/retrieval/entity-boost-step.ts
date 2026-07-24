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
import { emitEvent } from '../memory-event.js';
import { entityBoost } from '../scoring.js';

import { countMatchedEntitiesPerMemory } from './entity-query-match.js';

/** The narrow slice of the pipeline's dependencies this stage needs (ISP). */
export interface EntityBoostDeps {
  readonly entityBoostStore?:
    | {
        linkedKeysForMemories(params: {
          memoryIds: readonly string[];
          workspaceId?: string | undefined;
        }): Promise<ReadonlyMap<string, readonly string[]>>;
      }
    | undefined;
  readonly workspaceId?: string | undefined;
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
 * can see. Swallowing without recording would also violate `.claude/rules/error-handling.md`
 * § 2.
 */
export async function computeEntityBoost(
  query: string,
  candidateIds: readonly string[],
  deps: EntityBoostDeps,
): Promise<Map<string, number>> {
  const boostById = new Map<string, number>();
  const store = deps.entityBoostStore;
  if (store === undefined || candidateIds.length === 0) {
    return boostById;
  }

  let linkedKeys: ReadonlyMap<string, readonly string[]>;
  try {
    linkedKeys = await store.linkedKeysForMemories({
      memoryIds: candidateIds,
      workspaceId: deps.workspaceId,
    });
  } catch (err: unknown) {
    emitEvent(deps.tracer, 'entity_boost_degraded', {
      error: err instanceof Error ? err.name : 'unknown',
    });
    return boostById;
  }

  for (const [memoryId, numLinked] of countMatchedEntitiesPerMemory(query, linkedKeys)) {
    boostById.set(memoryId, entityBoost(numLinked));
  }
  return boostById;
}
