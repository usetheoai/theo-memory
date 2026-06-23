/**
 * Public contract barrel for `@usetheo/memory/contract`.
 *
 * v0.0 preview surface — re-exports every contract type from Phase 2 + Phase 3.
 * v0.1+ moves the canonical source under the same paths; this barrel stays
 * stable as the consumer-facing entry point.
 *
 * @see .claude/knowledge-base/adrs/ADR-0004-api-verbs.md
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 */

/**
 * Three-tier scope vocabulary (User / Session / Agent) plus v0.6 Repo tier.
 * Public API uses scoped sub-objects (`memory.user(id)`); internal filters
 * converge to a flat `{ user_id, session_id, agent_id }` shape.
 *
 * @see .claude/knowledge-base/adrs/ADR-0002-three-tier-scope.md
 * @see .claude/knowledge-base/adrs/ADR-0010-repo-scope-fourth-tier.md
 */
export type {
  AgentScope,
  Filters,
  RepoScope,
  Scope,
  ScopedContext,
  SessionScope,
  UserScope,
} from './scope.js';

/**
 * `MemoryItem` DTO — the row returned by `recall()` + `remember()`.
 *
 * @see .claude/knowledge-base/plans/completed/memory-contract-v0-0-plan.md
 * @see .claude/knowledge-base/adrs/ADR-0001-vector-based hybrid-architecture.md
 */
export type {
  MemoryItem,
  MemoryItemWithScore,
} from './memory-item.js';

/**
 * Options shapes for the 4 API verbs (remember/recall/forget/reflect) plus
 * the `GetAllOptions` pagination shape for `list()` queries.
 *
 * @see .claude/knowledge-base/adrs/ADR-0004-api-verbs.md
 * @see .claude/knowledge-base/plans/completed/memory-contract-v0-0-plan.md
 */
export type {
  ForgetOptions,
  GetAllOptions,
  RecallOptions,
  ReflectOptions,
  RememberOptions,
} from './options.js';

/**
 * Episodic / message-log read surface (M2 / gap G3): cursor-paginated,
 * bi-temporal-aware temporal projection of the existing memory substrate.
 *
 * @see .claude/knowledge-base/plans/first-class-episodes-plan.md
 */
export type { EpisodeListOptions, EpisodePage, EpisodeCursor } from './episode.js';
/**
 * Episode pagination runtime values + cursor codec (M2 / gap G3): the default +
 * max page-size constants and the opaque `(created_at, id)` cursor encode/decode
 * used by the episodes read surface.
 *
 * @see .claude/knowledge-base/plans/first-class-episodes-plan.md
 */
export {
  EPISODE_LIMIT_DEFAULT,
  EPISODE_LIMIT_MAX,
  decodeEpisodeCursor,
  encodeEpisodeCursor,
  escapeLikePattern,
  resolveEpisodeLimit,
} from './episode.js';

/**
 * `Memory` (top-level) + `ScopedMemory` (after `.user(id)` etc.) + config
 * + store interfaces. The contract `MemoryStore` is what local/ and
 * cloud/ runtimes implement.
 *
 * @see .claude/knowledge-base/adrs/ADR-0001-vector-based hybrid-architecture.md
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 */
export type {
  CloudMemoryConfig,
  Memory,
  MemoryConfig,
  MemoryStore,
  ScopedMemory,
} from './memory-store.js';

/**
 * Audit-trail row shape (`memory.history(memoryId)` consumer).
 *
 * @see .claude/knowledge-base/adrs/ADR-0006-bi-temporal-local-schema.md
 */
export type { HistoryEntry } from './history-entry.js';

/**
 * Result shape returned by `memory.reflect()` — counts of derived facts +
 * provenance back-references.
 *
 * @see .claude/knowledge-base/plans/completed/v0-4a-reflection-pipeline-plan.md
 * @see .claude/knowledge-base/adrs/ADR-0005-reflection-trigger.md
 */
export type { ReflectionResult } from './reflection-result.js';

/**
 * v0.6 skill-library — code-as-skill procedural memory shapes.
 * Exposed via `memory.skills(repoId)` per ADR-0010 RepoScope tier.
 *
 * @see .claude/knowledge-base/plans/completed/skill-library-plan.md
 * @see .claude/knowledge-base/adrs/ADR-0010-repo-scope-fourth-tier.md
 */
export type {
  ConsolidateOptions,
  ConsolidationResult,
  ScopedSkillMemory,
  Skill,
  SkillDraft,
  SkillLanguage,
  SkillRecallOptions,
  SkillWithScore,
  SourceCluster,
} from './skill.js';

/**
 * Domain error classes (real classes, not types) — typed errors at the
 * public API boundary per architecture.md § 8.
 *
 * @see .claude/knowledge-base/adrs/ADR-0001-vector-based hybrid-architecture.md
 * @see .claude/knowledge-base/adrs/ADR-0011-bi-temporal-local-runtime-gate-lift.md (BiTemporalNotSupportedLocally lifecycle)
 */
export {
  BiTemporalNotSupportedLocally,
  EmbeddingMismatch,
  InvalidEmbeddingDim,
  InvalidOntology,
  InvalidScope,
  InvalidSkillError,
  ContentTooLargeError,
  EmbedderError,
  EmbedderUnavailableError,
  EmptyScopeError,
  MemoryNotFound,
  MemoryStoreError,
  MissingScopeError,
  ReflectionNotConfigured,
  RerankerConflict,
  SkillAlreadyExists,
  SkillExecutionNotConfiguredError,
  SkillExecutorUnavailableError,
  ToolInvocationDeniedError,
  WorkspaceMismatch,
} from './errors.js';
/**
 * `ToolInvocationDeniedReason` — the typed literal union carried by
 * `ToolInvocationDeniedError` (which sandbox guard denied a skill execution).
 *
 * @see .claude/knowledge-base/plans/agentic-skill-execution-sandbox-plan.md § T1.2
 */
export type { ToolInvocationDeniedReason } from './errors.js';

/**
 * Multi-tenant workspace-isolation domain types (ADR D1/D2). `Principal` is
 * what an `AuthVerifier` resolves from a credential; `Workspace` is the tenant
 * boundary. The three memory tiers layer UNDER the workspace.
 *
 * @see .claude/knowledge-base/plans/multi-tenant-workspace-isolation-plan.md § T0.1
 */
export type { Principal, Workspace, WorkspaceRole } from './principal.js';

/**
 * `DEFAULT_WORKSPACE_ID` is the stable id of the workspace every legacy /
 * no-credential request collapses to (ADR D7); `makeVerifyShim` builds the
 * backward-compatible boolean `verify` from `resolvePrincipal` (ADR D2).
 *
 * @see .claude/knowledge-base/plans/multi-tenant-workspace-isolation-plan.md § T0.1 + ADR D2/D7
 */
export { DEFAULT_WORKSPACE_ID, DEFAULT_OWNER_USER_ID, makeVerifyShim, roleSatisfies } from './principal.js';

/**
 * Chat-message shape shared across the LLM DIP + v3 history persistence.
 *
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 */
export type {
  LLMResponse,
  Message,
  Role,
} from './message.js';

/**
 * `Embedder` DIP — single-method contract producing a fixed-dim vector
 * from text. Adapters: `StubEmbedder`, `OpenAIEmbedder`, `LocalTransformerEmbedder`.
 *
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 */
export type { Embedder } from './dip/embedder.js';

/**
 * `Reranker` DIP — optional post-threshold relevance re-scoring port (Item 23).
 * Default adapter: `CrossEncoderReranker` (cross-encoder via `@xenova`),
 * shipped behind the `@usetheo/memory/reranker-local` subpath (bundle-isolated).
 *
 * @see .claude/knowledge-base/plans/cross-encoder-reranker-plan.md § ADR D1
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 */
export type { Reranker } from './dip/reranker.js';

/**
 * `AdaptiveRetrievalPolicy` DIP — adaptive-retrieval decision hooks (Item 13).
 * `shouldRetrieve` pre-embed gate + `assess` post-threshold
 * grade-and-correct. Default impl: `HeuristicAdaptiveRetrievalPolicy` (key-free),
 * shipped behind the `@usetheo/memory/adaptive-local` subpath (bundle-isolated).
 * Wire via `createLocalMemory({ retrievalPolicy })`; tune per-call via
 * `RecallOptions.adaptive`.
 *
 * @see .claude/knowledge-base/plans/adaptive-retrieval-plan.md § ADR D1 + D4 + D5
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 */
export type {
  AdaptiveRetrievalPolicy,
  RetrievalDecision,
  RetrievalAssessment,
  AdaptiveTuning,
} from './dip/adaptive-retrieval-policy.js';

/**
 * `GraphExpansionStore` DIP — graph-aware recall traversal port (evolves the
 * entity-relation-extraction feature). `expandByEntities` traverses the existing
 * `entities`/`memory_entities`/`entity_edges` tables (1-2 hop JOINs) to surface
 * memories connected by shared entities. Default impl `PgGraphExpansionStore`,
 * auto-wired by the factory. Enable per-call via `RecallOptions.graphExpand`.
 *
 * @see .claude/knowledge-base/plans/graph-aware-recall-plan.md § ADR D1 + D5
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 */
export type {
  GraphExpansionStore,
  ExpandByEntitiesParams,
  GraphExpansionRow,
} from './dip/graph-expansion-store.js';

/**
 * Domain ontologies (Item 15) — typed per-domain entity/relation vocabularies
 * layered over LLM extraction. `BUILTIN_ONTOLOGIES` ships medical/legal/code/
 * support; `resolveOntology` resolves a registry key OR a custom `Ontology`.
 * Opt-in via `MemoryConfig.ontology`; persisted in the existing tables (no
 * poly-store, no migration).
 *
 * @see .claude/knowledge-base/plans/domain-ontologies-plan.md § ADR D1 + D4
 * @see .claude/knowledge-base/discoveries/blueprints/domain-ontologies-blueprint.md
 */
export type { Ontology, OntologyName } from './ontology.js';
/**
 * Domain-ontology runtime values: the built-in registry (medical/legal/code/
 * support), the `OTHER` coercion fallback constant, and the `resolveOntology`/
 * `validateOntology` resolvers consumers use to build a custom ontology.
 *
 * @see .claude/knowledge-base/plans/domain-ontologies-plan.md § ADR D1 + D4
 */
export { BUILTIN_ONTOLOGIES, ONTOLOGY_FALLBACK_TYPE, resolveOntology, validateOntology } from './ontology.js';

/**
 * `EntityExtractor` DIP — sync, deterministic node extractor from text.
 * Default adapter: `CompromiseEntityExtractor` (JS-native NLP + regex fallback).
 *
 * @see .claude/knowledge-base/discoveries/blueprints/entity-relation-extraction-no-graphdb-blueprint.md
 */
export type { EntityExtractor, EntityType, ExtractedEntity } from './dip/entity-extractor.js';

/**
 * `MemoryEntityStore` DIP — persist-only port: UPSERT extracted entities +
 * link them to their source memory. Default adapter: `PgMemoryEntityStore`.
 *
 * @see .claude/knowledge-base/discoveries/blueprints/entity-relation-extraction-no-graphdb-blueprint.md
 */
export type {
  MemoryEntityStore,
  EntityToLink,
  UpsertAndLinkParams,
  EntityNodeSummary,
  ListEntitiesParams,
} from './dip/memory-entity-store.js';

/**
 * `MemoryGraphStore` DIP — persist + read port for relation edges (slice2).
 * Default adapter: `PgMemoryGraphStore`. ISP-clean (2 methods) per ADR-0008;
 * the `/graph` handler composes this with `MemoryEntityStore.list` for nodes.
 *
 * @see .claude/knowledge-base/plans/entity-relation-extraction-slice2-plan.md § T2.0
 */
export type {
  MemoryGraphStore,
  EdgeToLink,
  UpsertEdgesParams,
  EdgeSummary,
  ListEdgesParams,
} from './dip/memory-graph-store.js';

/**
 * `UsageCounterStore` DIP — persist + read port for the per-scope recall counter
 * (`retrieval_api_usage`). Default adapter: `PgUsageCounterStore`. ISP-clean
 * (2 methods) per ADR-0008. The recall path increments fail-soft; the metrics
 * handler reads the cumulative count.
 *
 * @see .claude/knowledge-base/plans/themory-scoped-forget-and-retrieval-counter-plan.md § T2.2
 */
export type { UsageCounterStore } from './dip/usage-counter-store.js';

/**
 * `SkillExecutor` DIP — the contract for executing a stored skill's code-as-skill
 * payload inside a hardened sandbox. Default impl `SandboxedSkillExecutor` (isolated-vm,
 * T1.3). Pure contract — no I/O, no native addon (DIP per architecture.md § 3).
 *
 * @see .claude/knowledge-base/plans/agentic-skill-execution-sandbox-plan.md § T1.1 + ADR D1
 */
export type {
  SkillExecutor,
  SkillExecutionOptions,
  SkillExecutionResult,
} from './dip/skill-executor.js';

/**
 * `LLM` DIP — chat-completion-shaped fact-extraction interface. Adapters:
 * `StubLLM`, `OpenAILLM` (OpenAI-compatible via `OPENAI_BASE_URL`).
 *
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 */
export type { LLM } from './dip/llm.js';

/**
 * `Tokenizer` 11th DIP — surfaced by v0-8-fixes-cycle-1 T3.1 (F-arch-1
 * absorption) to support pluggable token counting for benchmark cost
 * accounting.
 *
 * @see .claude/knowledge-base/plans/v0-8-fixes-cycle-1-plan.md § T3.1
 */
export type { Tokenizer } from './dip/tokenizer.js';

/**
 * `VectorStore` DIP — persistent vector storage contract. Adapters:
 * `InMemoryVectorStore` (test fixture), `PgvectorStore` (production).
 *
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 */
export type {
  VectorStore,
  VectorStoreResult,
} from './dip/vector-store.js';

/**
 * `HistoryManager` DIP — audit-trail persistence contract backed by the
 * `history` table.
 *
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 * @see .claude/knowledge-base/adrs/ADR-0006-bi-temporal-local-schema.md
 */
export type {
  HistoryBatchRecord,
  HistoryManager,
} from './dip/history-manager.js';

/**
 * `ReflectionPolicy` DIP — pluggable reflection trigger strategy.
 * Adapters: `ManualReflectionPolicy`, `ThresholdReflectionPolicy`,
 * `SleepTimeReflectionPolicy`.
 *
 * @see .claude/knowledge-base/plans/completed/v0-4a-reflection-pipeline-plan.md
 * @see .claude/knowledge-base/adrs/ADR-0005-reflection-trigger.md
 */
export type {
  ManualReflectionPolicy,
  ReflectionPolicy,
  ReflectionTrigger,
} from './dip/reflection-policy.js';

/**
 * `EvictionPolicy` DIP + supporting types — v0.4b triadic-scoring
 * forgetting pipeline contract. Implementations live in `src/local/eviction/`.
 *
 * @see .claude/knowledge-base/plans/completed/v0-4b-forgetting-pipeline-plan.md
 * @see .claude/knowledge-base/adrs/ADR-0008-dip-method-counts.md
 */
export type {
  EvictionPolicy,
  EvictionResult,
  HalfLifePersister,
  NearestNeighborProvider,
  ScoreContext,
} from './dip/eviction-policy.js';

/**
 * Eviction validation helpers — `InvalidFractionError` thrown by
 * `assertValidFraction` boundary guard at v0.4b config-time.
 *
 * @see .claude/knowledge-base/plans/completed/v0-4b-forgetting-pipeline-plan.md
 */
export { InvalidFractionError, assertValidFraction } from './dip/eviction-policy.js';

/**
 * v1.5 `RecallCacheStore` 13th DIP — semantic-recall-cache shapes for
 * opt-in result memoization at the `recall()` layer.
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md § T0.1 / ADR D1
 */
export type {
  RecallCacheStore,
  RecallCacheStoreConfig,
  ScopeTierTtlConfig,
  CachedResult,
} from './dip/recall-cache-store.js';

/**
 * v1.5 cache config validation + defaults — boundary guards plus
 * documented defaults (threshold, TTL by scope tier, max size per scope).
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md
 */
export {
  validateRecallCacheStoreConfig,
  DEFAULT_THRESHOLD,
  DEFAULT_TTL_SECONDS_BY_SCOPE_TIER,
  DEFAULT_MAX_SIZE_PER_SCOPE,
} from './dip/recall-cache-store.js';

/**
 * `InvalidCacheConfig` — typed error from v1.5 cache config validation.
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md
 */
export { InvalidCacheConfig } from './errors.js';

/**
 * `ConflictResolutionPolicy` 9th DIP — v0.7 distillation conflict
 * resolution shapes for episodic → semantic consolidation.
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md
 */
export type {
  ConflictResolutionPolicy,
  ConflictResolutionResult,
  ConsolidationCandidate,
  ConsolidationContext,
} from './dip/conflict-resolution-policy.js';

/**
 * `NoopConflictPolicy` — v0.7 distillation no-op adapter; returns input
 * unchanged. Default when conflict resolution is not configured.
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md
 */
export { NoopConflictPolicy } from './conflict-resolution/noop.js';

/**
 * `LastWriteWinsConflictPolicy` — v0.7 distillation tiebreaker adapter +
 * `compareCandidatesDesc` comparator (lex-deterministic per EC-1 absorption).
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § EC-1
 */
export { LastWriteWinsConflictPolicy, compareCandidatesDesc } from './conflict-resolution/last-write-wins.js';

/**
 * `LlmJudgedMergeConflictPolicy` — v0.7 distillation LLM-judged merge
 * adapter plus the parser for the prompt's response shape.
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md
 */
export {
  LlmJudgedMergeConflictPolicy,
  parseConsolidationResponse,
  type LlmJudgedMergeConflictPolicyOptions,
} from './conflict-resolution/llm-judged-merge.js';

/**
 * v0.7 distillation merge-prompt template + generator function — the
 * canonical prompt sent to the judge LLM during consolidation.
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md
 */
export {
  CONFLICT_MERGE_PROMPT,
  generateConflictMergePrompt,
} from './conflict-resolution/prompts.js';

/**
 * v0.8 `BenchmarkAdapter` 10th DIP — independent benchmark reproduction
 * shapes for LongMemEval / LoCoMo / DMR fixture loaders.
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T0.1 / ADRs D1, D5, D6
 */
export type {
  AddMetrics,
  BenchmarkAdapter,
  BenchmarkCorpus,
  BenchmarkCorpusItem,
  BenchmarkQuery,
  SearchResult,
} from './dip/benchmark-adapter.js';

/**
 * 12th DIP — `AuthVerifier` — pluggable REST-server bearer-auth contract.
 * Default: BearerAuthVerifier from theo-memory-standalone-p0 cycle.
 *
 * @see .claude/knowledge-base/plans/theo-memory-standalone-p0-plan.md § T0.1 / ADR D3
 */
export type { AuthVerifier } from './dip/auth-verifier.js';

/**
 * OIDC authentication contracts — domain-level type definitions for the
 * OAuth2/OIDC bridge (Camada 3). Consumed by `@usetheo/memory-api` and
 * `@usetheo/memory-mcp` via `@usetheo/memory/contract`.
 *
 * @see .claude/knowledge-base/adrs/ADR-0013-oidc-bridge.md
 */
export type {
  IntrospectFn,
  IntrospectionResult,
  OidcDiscoveryConfig,
} from './dip/oidc-contracts.js';

/**
 * `hashFact(text)` — MD5 dedup hash over normalized text. Pure function;
 * Princípio 1 confirmação composite UNIQUE relies on this.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § dedup
 * @see .claude/knowledge-base/plans/principles-alignment-hardening-plan.md § T0.1
 */
export { hashFact } from './dedup.js';

/**
 * Lemmatization primitives — `STOP_WORDS` set + `lemmatizeForBm25`
 * (precomputed at write time) + `simpleStem` helper.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § lemmatization
 */
export { STOP_WORDS, lemmatizeForBm25, simpleStem } from './lemmatization.js';

/**
 * v0.1 additive scoring primitives — `combineScores` runs the additive
 * composition `(semantic + bm25 + entity_boost) / max_possible`;
 * `entityBoost` + `sigmoidBm25` are the per-signal normalizers;
 * `maxPossible` divides for the final ratio.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § scoring
 * @see .claude/knowledge-base/adrs/ADR-0001-vector-based hybrid-architecture.md
 */
export {
  ENTITY_BOOST_WEIGHT,
  combineScores,
  entityBoost,
  maxPossible,
  sigmoidBm25,
} from './scoring.js';

/**
 * Scoring helper types — `ActiveSignals` flags which signals contributed
 * to a row's score; `CandidateScores` is the per-row score breakdown.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § scoring
 */
export type { ActiveSignals, CandidateScores } from './scoring.js';

/**
 * `MAX_EMBEDDING_DIM` — cross-cutting cap (1536) for the embedding
 * dimension probe per ADR D1.7 of v0-1-local-runtime.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § ADR D1.7
 */
export { MAX_EMBEDDING_DIM } from './constants.js';

/**
 * Observable events — `MEMORY_EVENTS` literal union (23 members; latest:
 * entity_edge_linked + entity_edge_linking_failed from slice2 T2.0) + `emitEvent`
 * helper for OTel-typed event emission.
 *
 * @see .claude/knowledge-base/plans/principles-alignment-hardening-plan.md § T1.1
 */
export { MEMORY_EVENTS, emitEvent } from './memory-event.js';

/**
 * `MemoryEvent` union type + `AttributeValue` OTel attribute value shape
 * for the structured-event surface (Princípio 3 § auditability).
 *
 * @see .claude/knowledge-base/plans/principles-alignment-hardening-plan.md
 */
export type { AttributeValue, MemoryEvent } from './memory-event.js';

/**
 * v0.1 extraction-prompt primitives — `AdditiveExtractionSchema` (zod) +
 * `generateAdditiveExtractionPrompt` (template renderer) +
 * `escapeMarkdownHeaders` defensive helper.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § extraction
 */
export {
  AdditiveExtractionSchema,
  escapeMarkdownHeaders,
  generateAdditiveExtractionPrompt,
} from './extraction/prompt.js';

/**
 * Extraction prompt response shapes — `AdditiveExtractionResponse` parsed
 * shape + `PromptResult` raw render envelope.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § extraction
 */
export type { AdditiveExtractionResponse, PromptResult } from './extraction/prompt.js';

/**
 * `runExtractionPipeline` — the 8-phase write pipeline orchestrator.
 * Phase 0 context → Phase 1 retrieval → Phase 2 LLM extract → Phase 3
 * batch embed → Phase 4 hash dedup → Phase 5 payload → Phase 6 persist
 * → Phase 7+ entity linking.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § extraction pipeline
 * @see .claude/knowledge-base/adrs/ADR-0001-vector-based hybrid-architecture.md
 */
export { runExtractionPipeline } from './extraction/pipeline.js';

/**
 * `ExtractionDeps` — DIP-shaped dependency bundle accepted by
 * `runExtractionPipeline`. Used by consumers wiring custom extractors.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § extraction pipeline
 */
export type { ExtractionDeps } from './extraction/pipeline.js';

/**
 * `runRetrievalPipeline` — the 9-step search orchestrator.
 * Preprocess → Embed → Semantic over-fetch → BM25 → Sigmoid normalize
 * → Entity boost → Combined score → Threshold gate → Format.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § retrieval pipeline
 * @see .claude/knowledge-base/adrs/ADR-0001-vector-based hybrid-architecture.md
 */
export { runRetrievalPipeline } from './retrieval/pipeline.js';

/**
 * `RetrievalDeps` — DIP-shaped dependency bundle accepted by
 * `runRetrievalPipeline`. Used by consumers wiring custom retrievers.
 *
 * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § retrieval pipeline
 */
export type { RetrievalDeps } from './retrieval/pipeline.js';
