/**
 * Public barrel for the v0.4b forgetting / eviction surface.
 *
 * Closes F-dom-2 CRITICAL + F-arch-5 + F-wire-2 + F-xval-3 MAJOR per ADR D6
 * — before T4.1, consumers had to reach into `src/local/eviction/{file}.js`
 * deep paths to compose an eviction pipeline. With this barrel + the
 * factory wiring in `src/local/index.ts`, the canonical opt-in shape is:
 *
 *   const memory = await createLocalMemory({
 *     vectorStore: new PgvectorStore(pool),
 *     embedder: ...,
 *     llm: ...,
 *     eviction: { trigger: 'capacity', maxMemoriesPerScope: 1000 },
 *   });
 *
 */
import type { Scope } from '../../../domain/scope.js';

export { TriadicScoringPolicy, type TriadicScoringPolicyOptions, type TriadicWeights, type TriadicConstants, getNeighborScopeId, DEFAULT_TRIADIC_WEIGHTS, DEFAULT_TRIADIC_CONSTANTS, InvalidWeightsError, computeRecency, computeFrequency, computeImportance, computeHalfLifeSeconds } from './triadic-scoring-policy.js';
// v0.4b-fixes T5.1: HalfLifePersister + NearestNeighborProvider relocated to
// core/dip/eviction-policy.ts per F-arch-2 (concrete depends on abstraction;
// abstraction does NOT live with concrete). Re-exported here so the eviction
// barrel remains the one-stop-shop for v0.4b consumers.
export type { HalfLifePersister, NearestNeighborProvider } from '../../../domain/dip/eviction-policy.js';
export { PgEvictor, type Evictor } from './pg-evictor.js';
export { PgHalfLifePersister } from './pg-half-life-persister.js';
export { PgNearestNeighborProvider } from './pg-nearest-neighbor-provider.js';
export { CapacityBasedTrigger, computeOverflowFraction } from './capacity-based-trigger.js';
export { TimeBasedTrigger, InvalidCronExpressionError, type TimeBasedTriggerConfig } from './time-based-trigger.js';
export { scopeColumn, scopeValue, advisoryLockKey, scopeWhereClause } from './scope-where.js';

/**
 * Public opt-in eviction config consumed by `createLocalMemory({ eviction })`.
 *
 * Discriminated by `trigger`. Capacity-based triggers fire post-`remember()`
 * when the scope's active-row count exceeds `maxMemoriesPerScope`; time-based
 * triggers run on a cron-driven schedule that fires `evictionFraction` of the
 * scope each tick.
 *
 * **Constraint:** eviction REQUIRES a PostgreSQL-backed vector store
 * (PgvectorStore) because the trigger pipeline uses PG advisory locks +
 * pgvector cosine distance. `createLocalMemory` throws `EvictionNotSupported`
 * when `eviction` is set with `InMemoryVectorStore`.
 */
export type LocalEvictionConfig =
  | {
      readonly trigger: 'capacity';
      readonly maxMemoriesPerScope: number;
    }
  | {
      readonly trigger: 'time';
      readonly cronExpression: string;
      readonly evictionFraction: number;
      readonly scope: Scope;
    };
