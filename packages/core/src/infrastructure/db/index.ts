/**
 * Barrel module for the local infrastructure/db layer.
 *
 * After the T1.1-T1.4 extraction (architecture-review-fixes plan), this file
 * is ONLY re-exports. Every symbol that was previously defined here now lives
 * in a focused file:
 *
 *   config.ts           — LocalMemoryConfig, EvictionNotSupported, PROBE_TEXT
 *   scoped-memory.ts    — LocalScopedMemory + scope/filter helpers
 *   local-memory.ts     — LocalMemory, DisposableMemory
 *   factory.ts          — createLocalMemory, createMemory, cache/embed helpers
 *   migrations-runner.ts — runMigrations (+ internal applyDimChange)
 *
 */

// ── Existing third-party re-exports (unchanged) ─────────────────────────
export { InMemoryVectorStore } from './in-memory-store.js';
export { PgvectorStore } from './pgvector-store.js';
export { DrizzleHistoryManager } from './history-manager.js';
export { PgMemoryEntityStore } from './pg-memory-entity-store.js';
export { PgMemoryGraphStore } from './pg-memory-graph-store.js';
export { PgGraphExpansionStore } from './pg-graph-expansion-store.js';
export { PgUsageCounterStore } from './pg-usage-counter-store.js';
export { PgRoutingPolicyStore } from './routing-policy-store-pg.js';
export { PgRoutingAuditStore } from './routing-audit-store-pg.js';
export { SandboxedSkillExecutor } from './sandboxed-skill-executor.js';
export type { SandboxedSkillExecutorDeps } from './sandboxed-skill-executor.js';
export {
  entities,
  entityEdges,
  history,
  memories,
  memoryEntities,
  recallTraces,
  scopeUsageCounters,
} from './schema.js';
export { StubEmbedder, StubLLM } from './stubs.js';
// v0.7 T2.1 — re-export conflict-resolution policies for convenience
// (integration tests + consumer apps).
export {
  NoopConflictPolicy,
  LastWriteWinsConflictPolicy,
  LlmJudgedMergeConflictPolicy,
} from '../../domain/index.js';
export * from './eviction/index.js';

// ── Extracted modules ───────────────────────────────────────────────────
// T1.1: config types
export { type LocalMemoryConfig, EvictionNotSupported, PROBE_TEXT } from './config.js';
// T1.1: scoped-memory helpers + class
export {
  applySkillFilters,
  filtersFromScope,
  assertScopeIsNonEmpty,
  deriveScopeFromPayload,
  LocalScopedMemory,
} from './scoped-memory.js';
// scopeToCounterTuple relocated to reflect-orchestrator.ts (alongside runReflection).
export { scopeToCounterTuple, runReflection, type ReflectDeps } from './reflect-orchestrator.js';
// T1.2: LocalMemory + DisposableMemory
export { LocalMemory, type DisposableMemory } from './local-memory.js';
// T1.3: factory + cache/embed helpers
export { createLocalMemory, createMemory } from './factory.js';
// create-memory-preset (T2.1): zero-config preset shape + its typed error.
// `assemblePresetMemory` stays @internal (deep-imported by the GOAL test, NOT
// re-exported here) per plan D5.
export { type CreateMemoryPresetConfig, InvalidPresetConfig } from './preset.js';
// T1.4: migrations
export { runMigrations } from './migrations-runner.js';
// Tenant isolation: the request-bound workspace context and the pool that
// applies it. Exported so the API layer can bind the scope per request and
// wrap the pool it hands to the stores.
export {
  withWorkspaceScope,
  withCrossWorkspaceScope,
  currentScope,
  isCrossWorkspace,
  requireScopeValue,
  WorkspaceScopeError,
  type WorkspaceScope,
  type CrossWorkspaceScope,
} from './workspace-scope.js';
export { tenantScopedPool, describeScope } from './tenant-scoped-pool.js';
// The other half of the same guarantee: work that must span workspaces asserts
// that it CAN, over a named policy, before it starts.
export {
  assertBackgroundPoolCrossWorkspace,
  measureBackgroundReach,
  backgroundReachRefusal,
  type BackgroundReach,
} from './background-pool-reach.js';
