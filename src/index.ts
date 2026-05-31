/**
 * Public surface for `@usetheo/memory` — T7.2 of v0-1-local-runtime plan v1.3.
 *
 * Consumers import from this barrel:
 *   import { createMemory, type Memory } from '@usetheo/memory'
 *
 * The default factory points at the local runtime (Postgres + pgvector).
 * The `@usetheo/memory/cloud` subpath (v0.5) will export `createCloudMemory`
 * for the TheoCloud-managed runtime; the `./contract` subpath stays as the
 * v0.0 contract-preview entry for adapter authors who only need types.
 */

// Default factory (local runtime)
export { createMemory, createLocalMemory, runMigrations, EvictionNotSupported } from './local/index.js';
export type { LocalMemoryConfig, DisposableMemory } from './local/index.js';

// Local-runtime adapter classes (advanced consumers wiring custom configs)
export { InMemoryVectorStore, PgvectorStore, DrizzleHistoryManager } from './local/index.js';
export { entities, history, memories } from './local/index.js';
// Stub adapters for scaffold demos (ADR D8 — replace before production)
export { StubEmbedder, StubLLM } from './local/index.js';

// v0.4b-fixes T4.1: v0.4b eviction surface re-exported so consumers can
// construct the pipeline manually OR just consume the type for builder helpers.
// Closes F-dom-2 CRITICAL — before this, eviction was reachable only via
// `src/local/eviction/*` deep paths.
export {
  TriadicScoringPolicy,
  PgEvictor,
  PgHalfLifePersister,
  PgNearestNeighborProvider,
  CapacityBasedTrigger,
  TimeBasedTrigger,
  InvalidWeightsError,
  InvalidCronExpressionError,
  DEFAULT_TRIADIC_WEIGHTS,
  DEFAULT_TRIADIC_CONSTANTS,
  getNeighborScopeId,
  scopeColumn,
  scopeValue,
  advisoryLockKey,
  scopeWhereClause,
  computeRecency,
  computeFrequency,
  computeImportance,
  computeHalfLifeSeconds,
  computeOverflowFraction,
} from './local/index.js';
export type {
  LocalEvictionConfig,
  TriadicScoringPolicyOptions,
  TriadicWeights,
  TriadicConstants,
  HalfLifePersister,
  NearestNeighborProvider,
  Evictor,
  TimeBasedTriggerConfig,
} from './local/index.js';

// Re-export the full v0.0 contract from src/core
export * from './core/index.js';
