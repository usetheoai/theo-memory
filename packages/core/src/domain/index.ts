/**
 * Public contract barrel for `@usetheo/memory/contract`.
 *
 * v0.0 preview surface — re-exports every contract type from Phase 2 + Phase 3.
 * v0.1+ moves the canonical source under the same paths; this barrel stays
 * stable as the consumer-facing entry point.
 *
 */

/**
 * Three-tier scope vocabulary (User / Session / Agent) plus v0.6 Repo tier.
 * Public API uses scoped sub-objects (`memory.user(id)`); internal filters
 * converge to a flat `{ user_id, session_id, agent_id }` shape.
 *
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
 */
export type {
  MemoryItem,
  MemoryItemWithScore,
} from './memory-item.js';

/**
 * Options shapes for the 4 API verbs (remember/recall/forget/reflect) plus
 * the `GetAllOptions` pagination shape for `list()` queries.
 *
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
 */
export type { EpisodeListOptions, EpisodePage, EpisodeCursor } from './episode.js';
/**
 * Episode pagination runtime values + cursor codec (M2 / gap G3): the default +
 * max page-size constants and the opaque `(created_at, id)` cursor encode/decode
 * used by the episodes read surface.
 *
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
 */
export type {
  CloudMemoryConfig,
  Memory,
  MemoryConfig,
  MemoryStore,
  ScopedMemory,
  SearchMessagesOptions,
} from './memory-store.js';

/**
 * Audit-trail row shape (`memory.history(memoryId)` consumer).
 *
 */
export type { HistoryAction, HistoryEntry } from './history-entry.js';

/**
 * Result shape returned by `memory.reflect()` — counts of derived facts +
 * provenance back-references.
 *
 */
export type { ReflectionResult } from './reflection-result.js';

/**
 * Exposed via `memory.skills(repoId)` per ADR-0010 RepoScope tier.
 *
 */
export type {
  ConsolidateOptions,
  ConsolidationResult,
  ScopedSkillMemory,
  Skill,
  SkillDraft,
  SkillLanguage,
  SkillRecallOptions,
  SkillsBySubjectOptions,
  SkillsBySubjectPage,
  SkillWithRepo,
  SkillWithScore,
  SourceCluster,
} from './skill.js';

/**
 * Domain error classes (real classes, not types) — typed errors at the
 * public API boundary per architecture.md § 8.
 *
 */
export {
  BiTemporalNotSupportedLocally,
  EmbeddingMismatch,
  InvalidEmbeddingDim,
  InvalidOntology,
  InvalidScope,
  InvalidSkillError,
  ContentTooLargeError,
  DerivedMemorySourcesUnavailableError,
  EmbedderError,
  EmbedderUnavailableError,
  EmptyScopeError,
  MemoryNotFound,
  MemoryStoreError,
  MissingScopeError,
  ReflectionNotConfigured,
  MessageLogNotConfigured,
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
 */
export type { ToolInvocationDeniedReason } from './errors.js';

/**
 * Multi-tenant workspace-isolation domain types (ADR D1/D2). `Principal` is
 * what an `AuthVerifier` resolves from a credential; `Workspace` is the tenant
 * boundary. The three memory tiers layer UNDER the workspace.
 *
 */
export type { Principal, Workspace, WorkspaceRole } from './principal.js';

/**
 * `DEFAULT_WORKSPACE_ID` is the stable id of the workspace every legacy /
 * no-credential request collapses to (ADR D7); `makeVerifyShim` builds the
 * backward-compatible boolean `verify` from `resolvePrincipal` (ADR D2).
 *
 */
export { DEFAULT_WORKSPACE_ID, DEFAULT_OWNER_USER_ID, makeVerifyShim, roleSatisfies } from './principal.js';

/**
 * Chat-message shape shared across the LLM DIP + v3 history persistence.
 *
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
 */
export type { Embedder } from './dip/embedder.js';
export type { LoggedMessage, ScoredLoggedMessage, SurroundingTurns } from './dip/message-log.js';

/**
 * `Reranker` DIP — optional post-threshold relevance re-scoring port (Item 23).
 * Default adapter: `CrossEncoderReranker` (cross-encoder via `@xenova`),
 * shipped behind the `@usetheo/memory/reranker-local` subpath (bundle-isolated).
 *
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
 */
export type { Ontology, OntologyName } from './ontology.js';
/**
 * Domain-ontology runtime values: the built-in registry (medical/legal/code/
 * support), the `OTHER` coercion fallback constant, and the `resolveOntology`/
 * `validateOntology` resolvers consumers use to build a custom ontology.
 *
 */
export { BUILTIN_ONTOLOGIES, ONTOLOGY_FALLBACK_TYPE, resolveOntology, validateOntology } from './ontology.js';

/**
 * M13 (#111) — the closed default entity taxonomy applied when no Item 15
 * ontology is configured (ADR D1), plus the Phase-7 linking primitives the
 * `themory reextract` composition root orchestrates (blueprint Q8 — the job
 * reuses the write-path pieces; zero new extraction stack).
 *
 */
export { DEFAULT_ENTITY_TAXONOMY } from './ontology.js';
export { linkEntities } from './extraction/entity-linking.js';
export type { EntityLinkingDeps, LinkableItem } from './extraction/entity-linking.js';
export { applyOntologyToEntities } from './extraction/pipeline-helpers.js';

/**
 * `EntityExtractor` DIP — sync, deterministic node extractor from text.
 * Default adapter: `CompromiseEntityExtractor` (JS-native NLP + regex fallback).
 *
 */
export type { EntityExtractor, EntityType, ExtractedEntity } from './dip/entity-extractor.js';

/**
 * `MemoryEntityStore` DIP — persist-only port: UPSERT extracted entities +
 * link them to their source memory. Default adapter: `PgMemoryEntityStore`.
 *
 */
export type {
  MemoryEntityStore,
  EntityToLink,
  UpsertAndLinkParams,
  EntityNodeSummary,
  ListEntitiesParams,
  ForgetEntityResult,
} from './dip/memory-entity-store.js';
// M14 T2.4a — value export (class) for the fail-closed forget guard (#252).
export { EntityForgetScopeError } from './dip/memory-entity-store.js';

/**
 * `MemoryGraphStore` DIP — persist + read port for relation edges (slice2).
 * Default adapter: `PgMemoryGraphStore`. ISP-clean (2 methods) per ADR-0008;
 * the `/graph` handler composes this with `MemoryEntityStore.list` for nodes.
 *
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
 */
export type { UsageCounterStore } from './dip/usage-counter-store.js';

/**
 * `SkillExecutor` DIP — the contract for executing a stored skill's code-as-skill
 * payload inside a hardened sandbox. Default impl `SandboxedSkillExecutor` (isolated-vm,
 * T1.3). Pure contract — no I/O, no native addon (DIP per architecture.md § 3).
 *
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
 */
export type { LLM } from './dip/llm.js';

/**
 * `Tokenizer` 11th DIP — surfaced by v0-8-fixes-cycle-1 T3.1 (F-arch-1
 * absorption) to support pluggable token counting for benchmark cost
 * accounting.
 *
 */
export type { Tokenizer } from './dip/tokenizer.js';

/**
 * `VectorStore` DIP — persistent vector storage contract. Adapters:
 * `InMemoryVectorStore` (test fixture), `PgvectorStore` (production).
 *
 */
export type {
  VectorStore,
  VectorStoreResult,
} from './dip/vector-store.js';

/**
 * `HistoryManager` DIP — audit-trail persistence contract backed by the
 * `history` table.
 *
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
 */
export { InvalidFractionError, assertValidFraction } from './dip/eviction-policy.js';

/**
 * v1.5 `RecallCacheStore` 13th DIP — semantic-recall-cache shapes for
 * opt-in result memoization at the `recall()` layer.
 *
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
 */
export {
  validateRecallCacheStoreConfig,
  DEFAULT_THRESHOLD,
  DEFAULT_TTL_SECONDS_BY_SCOPE_TIER,
  DEFAULT_MAX_SIZE_PER_SCOPE,
} from './dip/recall-cache-store.js';

/**
 * explainable-recall (S1) — the 14th DIP: the "accountable forgetting" recall
 * trace store contract + row/batch/drop-reason shapes.
 *
 */
export type {
  DropReason,
  RecallTraceBatch,
  RecallTraceRow,
  RecallTraceStore,
  RecallTraceStoreConfig,
} from './dip/recall-trace-store.js';

/**
 * explainable-recall (S1) — recall-trace config validation + row-cap bounds.
 *
 */
export {
  validateRecallTraceStoreConfig,
  DEFAULT_MAX_ROWS_PER_RECALL,
  MAX_ROWS_PER_RECALL,
} from './dip/recall-trace-store.js';

/**
 * `InvalidCacheConfig` — typed error from v1.5 cache config validation.
 *
 */
export { InvalidCacheConfig } from './errors.js';

/**
 * M11 — routing-policy DIP (per-`(workspace, user)` config, fail-closed default) + its typed error.
 */
export {
  FAILCLOSED_DEFAULT_POLICY,
  RoutingPolicySchema,
  parseRoutingPolicy,
  InMemoryRoutingPolicyStore,
} from './dip/routing-policy-store.js';
export type { DefaultScope, RoutingPolicy, RoutingPolicyStore } from './dip/routing-policy-store.js';
export { InvalidRoutingPolicy } from './errors.js';

/**
 * M11 — placement-decision audit DIP (Princípio 3) + the fail-soft write primitive.
 */
export {
  InMemoryRoutingAuditStore,
  recordRoutingDecision,
  DEFAULT_AUDIT_LIST_LIMIT,
  MAX_AUDIT_LIST_LIMIT,
} from './dip/routing-audit-store.js';
export type { Attribution, ChosenScope, RoutingAuditRecord, RoutingAuditStore } from './dip/routing-audit-store.js';

/**
 * `ConflictResolutionPolicy` 9th DIP — v0.7 distillation conflict
 * resolution shapes for episodic → semantic consolidation.
 *
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
 */
export { NoopConflictPolicy } from './conflict-resolution/noop.js';

/**
 * `LastWriteWinsConflictPolicy` — v0.7 distillation tiebreaker adapter +
 * `compareCandidatesDesc` comparator (lex-deterministic per EC-1 absorption).
 *
 */
export { LastWriteWinsConflictPolicy, compareCandidatesDesc } from './conflict-resolution/last-write-wins.js';

/**
 * `LlmJudgedMergeConflictPolicy` — v0.7 distillation LLM-judged merge
 * adapter plus the parser for the prompt's response shape.
 *
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
 */
export {
  CONFLICT_MERGE_PROMPT,
  generateConflictMergePrompt,
} from './conflict-resolution/prompts.js';

/**
 * M9 — `SessionToGlobalConsolidationPolicy` — promotes a durable session cluster
 * (confirmation_count ≥ threshold, Princípio 1) to the user's global scope. A
 * `ConflictResolutionPolicy` impl reused at the reflect boundary; persistence
 * (session_id→NULL) is the store's `promoteToGlobal`.
 */
export { SessionToGlobalConsolidationPolicy } from './consolidation/session-to-global-policy.js';

/**
 * 12th DIP — `AuthVerifier` — pluggable REST-server bearer-auth contract.
 * Default: BearerAuthVerifier from theo-memory-standalone-p0 cycle.
 *
 */
export type { AuthVerifier } from './dip/auth-verifier.js';

/**
 * OIDC authentication contracts — domain-level type definitions for the
 * OAuth2/OIDC bridge (Camada 3). Consumed by `@usetheo/memory-api` and
 * `@usetheo/memory-mcp` via `@usetheo/memory/contract`.
 *
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
 */
export { hashFact } from './dedup.js';

/**
 * Lemmatization primitives — `STOP_WORDS` set + `lemmatizeForBm25`
 * (precomputed at write time) + `simpleStem` helper.
 *
 */
export { STOP_WORDS, lemmatizeForBm25, simpleStem } from './lemmatization.js';

/**
 * v0.1 additive scoring primitives — `combineScores` runs the additive
 * composition `(semantic + bm25 + entity_boost) / max_possible`;
 * `entityBoost` + `sigmoidBm25` are the per-signal normalizers;
 * `maxPossible` divides for the final ratio.
 *
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
 */
export type { ActiveSignals, CandidateScores } from './scoring.js';

/**
 * `MAX_EMBEDDING_DIM` — cross-cutting cap (1536) for the embedding
 * dimension probe per ADR D1.7 of v0-1-local-runtime.
 *
 */
export { MAX_EMBEDDING_DIM } from './constants.js';

/**
 * Observable events — `MEMORY_EVENTS` literal union (35 members; latest:
 * entity_noise_filtered from entity-extraction-noise-filter EG-2) + `emitEvent`
 * helper for OTel-typed event emission.
 *
 */
export { MEMORY_EVENTS, emitEvent } from './memory-event.js';

/**
 * `MemoryEvent` union type + `AttributeValue` OTel attribute value shape
 * for the structured-event surface (Princípio 3 § auditability).
 *
 */
export type { AttributeValue, MemoryEvent } from './memory-event.js';

/**
 * v0.1 extraction-prompt primitives — `AdditiveExtractionSchema` (zod) +
 * `generateAdditiveExtractionPrompt` (template renderer) +
 * `escapeMarkdownHeaders` defensive helper.
 *
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
 */
export type { AdditiveExtractionResponse, PromptResult } from './extraction/prompt.js';

/**
 * `runExtractionPipeline` — the 8-phase write pipeline orchestrator.
 * Phase 0 context → Phase 1 retrieval → Phase 2 LLM extract → Phase 3
 * batch embed → Phase 4 hash dedup → Phase 5 payload → Phase 6 persist
 * → Phase 7+ entity linking.
 *
 */
export { runExtractionPipeline } from './extraction/pipeline.js';
// M27 — durable-fact predicates (single source of truth; reused by the eval parity metric
// and the one-shot cleanup so the "is this a durable fact?" rule lives in exactly one place).
export {
  classifyNonFact,
  isNonDurableFact,
  isSingleThirdPersonFact,
  isDump,
  isInterrogative,
  isFirstPersonOpener,
  ATOMIC_FACT_MAX_CHARS,
} from './extraction/fact-gate.js';
export type { NonFactReason } from './extraction/fact-gate.js';

/**
 * `ExtractionDeps` — DIP-shaped dependency bundle accepted by
 * `runExtractionPipeline`. Used by consumers wiring custom extractors.
 *
 */
export type { ExtractionDeps } from './extraction/pipeline.js';

/**
 * Auto-categorization surface (auto-categorization-write-pipeline). `AutoCategorizeConfig`
 * is the `LocalMemoryConfig.autoCategorize` shape (off-switch + custom taxonomy);
 * `DEFAULT_CATEGORY_TAXONOMY` is the fixed list; `classifyCategorySource` labels an
 * assigned category `taxonomy` vs `suggested`.
 */
export { DEFAULT_CATEGORY_TAXONOMY, classifyCategorySource } from './extraction/taxonomy.js';
export type { AutoCategorizeConfig, CategorySource } from './extraction/taxonomy.js';

/**
 * `runRetrievalPipeline` — the 9-step search orchestrator.
 * Preprocess → Embed → Semantic over-fetch → BM25 → Sigmoid normalize
 * → Entity boost → Combined score → Threshold gate → Format.
 *
 */
export { runRetrievalPipeline } from './retrieval/pipeline.js';

/**
 * `RetrievalDeps` — DIP-shaped dependency bundle accepted by
 * `runRetrievalPipeline`. Used by consumers wiring custom retrievers.
 *
 */
export type { RetrievalDeps } from './retrieval/pipeline.js';

/** Evidence classification for contextual memory. @see docs/memory-semantics.md */
export { MemoryEvidenceSchema } from './memory-evidence.js';
export type { MemoryEvidence } from './memory-evidence.js';

export { IdempotencyConflict } from './errors.js';

export type { MemoryEvidencePage, MemoryEvidenceReader } from './memory-evidence.js';

export { MemoryJobInputSchema, MemoryJobLeaseLost, MemoryJobUnavailable } from './memory-job.js';
export type { MemoryJobInput, MemoryJobActor, MemoryJobSummary, MemoryJobService } from './memory-job.js';
