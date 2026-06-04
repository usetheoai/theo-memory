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

/**
 * Default factory functions for the local runtime (Postgres + pgvector).
 *
 * - `createMemory` — convenience wrapper around `createLocalMemory` for the
 *   common case (1-arg config; local-only).
 * - `createLocalMemory` — explicit local runtime factory; ADR-0008 DIP shape.
 * - `runMigrations` — Drizzle migration runner; required ONCE per fresh DB.
 * - `EvictionNotSupported` — typed error thrown when v0.4b eviction is
 *   configured against an `InMemoryVectorStore` (PG-only feature).
 *
 * @see .claude/knowledge-base/adrs/ADR-0001-vector-based hybrid-architecture.md
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § T7.2
 * @see .claude/knowledge-base/plans/completed/v0-4b-fixes-cycle-plan.md § ADR D6 (EvictionNotSupported)
 */
export { createMemory, createLocalMemory, runMigrations, EvictionNotSupported } from './local/index.js';

/**
 * Local runtime configuration types — consumer-facing entrypoint for
 * advanced wiring (custom embedder, custom LLM, opt-in eviction).
 *
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md
 */
export type { LocalMemoryConfig, DisposableMemory } from './local/index.js';

/**
 * Local-runtime adapter classes — advanced consumers wiring custom
 * `createLocalMemory({ vectorStore, ... })` configurations directly.
 *
 * - `InMemoryVectorStore` — unit-test fixture; non-persistent.
 * - `PgvectorStore` — production-grade Postgres + pgvector adapter (HNSW
 *   cosine index per ADR D1.7).
 * - `DrizzleHistoryManager` — audit-trail manager backed by the `history`
 *   table (Princípio 3 § auditability).
 *
 * @see .claude/knowledge-base/adrs/ADR-0006-bi-temporal-local-schema.md
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § T4.x
 */
export { InMemoryVectorStore, PgvectorStore, DrizzleHistoryManager } from './local/index.js';

/**
 * Drizzle table objects re-exported for consumers building custom queries
 * outside the `Memory` API (e.g., ETL pipelines, custom dashboards).
 *
 * The 4-verb Memory API is the contract; these tables are the LOAD-BEARING
 * primitives behind it. Consumers using these directly accept the schema-
 * coupling cost in exchange for query freedom.
 *
 * @see .claude/knowledge-base/adrs/ADR-0006-bi-temporal-local-schema.md
 * @see .claude/knowledge-base/plans/completed/v1-1-multi-peer-and-bi-temporal-plan.md
 */
export { entities, history, memories } from './local/index.js';

/**
 * Stub adapters for scaffold demos and unit-test fixtures.
 *
 * `StubEmbedder` returns zero vectors; `StubLLM` returns shape-correct
 * empty extractions. NOT for production — wire `LocalTransformerEmbedder`
 * or `OpenAILLM` per ADR D8 of v0-1-local-runtime before shipping.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § ADR D8
 * @see .claude/knowledge-base/plans/completed/adapters-stub-embedder-llm-cycle-1-plan.md
 */
export { StubEmbedder, StubLLM } from './local/index.js';

/**
 * v0.4b forgetting pipeline surface — exported so consumers can construct
 * the triadic-scoring eviction pipeline manually OR consume the types for
 * builder helpers.
 *
 * Closes v0.4b-fixes F-dom-2 CRITICAL — before this barrel re-export,
 * eviction was reachable only via deep `src/local/eviction/*` paths.
 *
 * Princípio 2 (priorização > volume) materialises here: triadic-scoring
 * combines Ebbinghaus decay + LRU + LLM-judged importance + long-tail
 * isolation guardrail.
 *
 * @see .claude/knowledge-base/plans/completed/v0-4b-forgetting-pipeline-plan.md
 * @see .claude/knowledge-base/plans/completed/v0-4b-fixes-cycle-plan.md § T4.1
 */
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

/**
 * v0.4b forgetting pipeline configuration + DIP types — re-exported so
 * consumers can write builder helpers that produce `LocalEvictionConfig`
 * without depending on deep `src/local/eviction/*` paths.
 *
 * @see .claude/knowledge-base/plans/completed/v0-4b-forgetting-pipeline-plan.md
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md (Evictor + HalfLifePersister + NearestNeighborProvider DIPs)
 */
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

/**
 * Re-export the full v0.0 contract from `src/core` — Memory interface,
 * scoped sub-objects, options shapes, error classes, MemoryEvent union,
 * MemoryItem DTO, and the 10 DIP interfaces under `src/core/dip/`.
 *
 * Consumers needing ONLY the contract (e.g., adapter authors implementing
 * `MemoryStore` against a non-local backend) prefer the `./contract`
 * subpath which is the same surface without the local-runtime baggage.
 *
 * @see .claude/knowledge-base/adrs/ADR-0001-vector-based hybrid-architecture.md
 * @see .claude/knowledge-base/plans/completed/memory-contract-v0-0-plan.md
 * @see .claude/knowledge-base/adrs/ADR-0002-three-tier-scope.md (User / Session / Agent)
 */
export * from './core/index.js';
