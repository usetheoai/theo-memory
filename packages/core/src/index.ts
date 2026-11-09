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
 */
export { createMemory, createLocalMemory, runMigrations, EvictionNotSupported } from './infrastructure/db/index.js';

/**
 * create-memory-preset — zero-config preset overload of {@link createMemory}.
 *
 * `CreateMemoryPresetConfig` is the `{ postgres, openai?, migrate? }` shape;
 * `InvalidPresetConfig` is the typed error thrown fail-fast on an empty
 * `postgres` (EC-4) — exported so consumers can `catch` it.
 *
 */
export { type CreateMemoryPresetConfig, InvalidPresetConfig } from './infrastructure/db/index.js';

/**
 * Local runtime configuration types — consumer-facing entrypoint for
 * advanced wiring (custom embedder, custom LLM, opt-in eviction).
 *
 */
export type { LocalMemoryConfig, DisposableMemory } from './infrastructure/db/index.js';

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
 */
export { InMemoryVectorStore, PgvectorStore, DrizzleHistoryManager, PgRoutingPolicyStore, PgRoutingAuditStore } from './infrastructure/db/index.js';

/**
 * entity-extraction-nodes-slice1 — default entity-NODE-linking adapter. The
 * factory wires it automatically when `entityBoost !== false`; exported so a
 * consumer can construct/inject their own.
 *
 */
export { PgMemoryEntityStore } from './infrastructure/db/index.js';
export { InMemoryMessageLog, PgMessageLog } from './infrastructure/db/index.js';
export type { LoggedMessage, MessageLog } from './domain/dip/message-log.js';
/**
 * entity-relation-extraction-slice2 — default relation-EDGE-linking adapter,
 * wired under the same `entityBoost`/PgvectorStore gate as the node adapter.
 *
 */
export { PgMemoryGraphStore } from './infrastructure/db/index.js';
export { PgGraphExpansionStore } from './infrastructure/db/index.js';
/**
 * themory-scoped-forget-and-retrieval-counter — default per-scope recall-counter
 * adapter backing `retrieval_api_usage`, wired under the same gate.
 *
 */
export { PgUsageCounterStore } from './infrastructure/db/index.js';
/**
 * `SandboxedSkillExecutor` — default `SkillExecutor` impl (isolated-vm). Wired
 * opt-in via `createLocalMemory({ skillExecutor })` (T2.2). The `isolated-vm`
 * addon is optional + lazy-loaded — importing this symbol does NOT pull it.
 *
 */
export { SandboxedSkillExecutor } from './infrastructure/db/index.js';
/**
 * `SandboxedSkillExecutorDeps` — constructor dependency bundle for the
 * isolated-vm-backed `SandboxedSkillExecutor` (opt-in skill execution).
 *
 */
export type { SandboxedSkillExecutorDeps } from './infrastructure/db/index.js';
/**
 * entity-extraction-nodes-slice1 — default entity extractor (compromise-based,
 * lazy-loaded with a regex fallback). Wired when `entityBoost !== false`.
 *
 */
export { CompromiseEntityExtractor } from './infrastructure/extraction/compromise-entity-extractor.js';

/**
 * Drizzle table objects re-exported for consumers building custom queries
 * outside the `Memory` API (e.g., ETL pipelines, custom dashboards).
 *
 * The 4-verb Memory API is the contract; these tables are the LOAD-BEARING
 * primitives behind it. Consumers using these directly accept the schema-
 * coupling cost in exchange for query freedom.
 *
 */
export { entities, history, memories, memoryEntities } from './infrastructure/db/index.js';

/**
 * Stub adapters for scaffold demos and unit-test fixtures.
 *
 * `StubEmbedder` returns zero vectors; `StubLLM` returns shape-correct
 * empty extractions. NOT for production — wire `LocalTransformerEmbedder`
 * or `OpenAILLM` per ADR D8 of v0-1-local-runtime before shipping.
 *
 */
export { StubEmbedder, StubLLM } from './infrastructure/db/index.js';

/**
 * v0.4a reflection policies — T4.1 of code-review-fixes-v0-2-1.
 *
 * `ThresholdReflectionPolicy` triggers reflection after N remember() calls
 * per scope. `SleepTimeReflectionPolicy` reflects on a time-based schedule.
 * Both require `PgvectorStore` (local runtime).
 *
 */
export {
  ThresholdReflectionPolicy,
  type ThresholdReflectionPolicyConfig,
  SleepTimeReflectionPolicy,
  type SleepTimeReflectionPolicyConfig,
} from './infrastructure/db/reflection/index.js';

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
} from './infrastructure/db/index.js';

/**
 * v0.4b forgetting pipeline configuration + DIP types — re-exported so
 * consumers can write builder helpers that produce `LocalEvictionConfig`
 * without depending on deep `src/local/eviction/*` paths.
 *
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
} from './infrastructure/db/index.js';

/**
 * Re-export the full v0.0 contract from `src/core` — Memory interface,
 * scoped sub-objects, options shapes, error classes, MemoryEvent union,
 * MemoryItem DTO, and the 10 DIP interfaces under `src/core/dip/`.
 *
 * Consumers needing ONLY the contract (e.g., adapter authors implementing
 * `MemoryStore` against a non-local backend) prefer the `./contract`
 * subpath which is the same surface without the local-runtime baggage.
 *
 */
export * from './domain/index.js';

// M27 T4.1 — one-shot write-quality cleanup (reversible soft-delete of pre-fix pollution).
// Exported so the `themory cleanup-write-quality` CLI (and any ops caller) can run it — the
// wiring-triad pillar (a) caller the review required.
export {
  cleanupWriteQuality,
  findPollutedMemories,
  type CleanupCandidate,
  type CleanupResult,
  type PollutionReason,
} from './application/cleanup-write-quality.js';

// Tenant isolation (migration 0029): the workspace scope bound per request and
// the pool wrapper that pushes it down to PostgreSQL for the RLS policies.
export {
  withWorkspaceScope,
  withCrossWorkspaceScope,
  currentScope,
  isCrossWorkspace,
  WorkspaceScopeError,
  tenantScopedPool,
  describeScope,
  assertBackgroundPoolCrossWorkspace,
  assertRequestPoolIsolated,
  measureRequestPosture,
  requireStrictWorkspaceWrites,
  currentWorkspaceWriteMode,
  measureBackgroundReach,
  backgroundReachRefusal,
  type BackgroundReach,
  type WorkspaceScope,
  type CrossWorkspaceScope,
} from './infrastructure/db/index.js';

/** Evidence classification for contextual memory. @see docs/memory-semantics.md */
export { MemoryEvidenceSchema } from './domain/memory-evidence.js';
export type { MemoryEvidence } from './domain/memory-evidence.js';

/** Session lifecycle and exact fact-store integration. @see docs/memory-semantics.md */
export { MemorySession, MemorySessionUnavailable } from './application/memory-session.js';
export type { SessionFactStore, SessionObservation, MemorySessionConfig, MemoryExtractionJob, MemoryExtractionResult } from './application/memory-session.js';

export type { MemoryEvidencePage, MemoryEvidenceReader } from './domain/memory-evidence.js';

export { PgMemoryEvidenceStore } from './infrastructure/db/pg-memory-evidence-store.js';

export { MemoryJobInputSchema, MemoryJobLeaseLost, MemoryJobUnavailable } from './domain/memory-job.js';
export type { MemoryJobInput, MemoryJobActor, MemoryJobSummary, MemoryJobService } from './domain/memory-job.js';

export { PgMemoryJobStore } from './infrastructure/db/pg-memory-job-store.js';

export { MemoryJobWorker } from './application/memory-job-worker.js';
export type { MemoryJobProcessor, MemoryJobWorkResult } from './application/memory-job-worker.js';
export { PgMemoryJobProcessor } from './infrastructure/db/pg-memory-job-processor.js';
