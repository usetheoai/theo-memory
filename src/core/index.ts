/**
 * Public contract barrel for `@usetheo/memory/contract`.
 *
 * v0.0 preview surface — re-exports every contract type from Phase 2 + Phase 3.
 * v0.1+ moves the canonical source under the same paths; this barrel stays
 * stable as the consumer-facing entry point.
 *
 * @see ADR-0004 — API verbs (Memory + ScopedMemory expose remember/recall/forget/reflect)
 * @see ADR-0008 — DIP method counts (5 DIPs surface here)
 */

// Domain types
export type {
  AgentScope,
  Filters,
  RepoScope,
  Scope,
  SessionScope,
  UserScope,
} from './scope.js';

export type {
  MemoryItem,
  MemoryItemWithScore,
} from './memory-item.js';

export type {
  ForgetOptions,
  GetAllOptions,
  RecallOptions,
  ReflectOptions,
  RememberOptions,
} from './options.js';

export type {
  CloudMemoryConfig,
  Memory,
  MemoryConfig,
  MemoryStore,
  ScopedMemory,
} from './memory-store.js';

export type { HistoryEntry } from './history-entry.js';

export type { ReflectionResult } from './reflection-result.js';

// v0.6 — code-as-skill procedural memory (voyager-skill-library)
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

// Domain errors (real classes — not types)
export {
  BiTemporalNotSupportedLocally,
  EmbeddingMismatch,
  InvalidScope,
  InvalidSkillError,
  MemoryNotFound,
  MissingScopeError,
  ReflectionNotConfigured,
} from './errors.js';

// Chat-message shape (shared across LLM + V3 history)
export type {
  LLMResponse,
  Message,
  Role,
} from './message.js';

// DIPs
export type { Embedder } from './dip/embedder.js';

export type { LLM } from './dip/llm.js';

export type {
  VectorStore,
  VectorStoreResult,
} from './dip/vector-store.js';

export type {
  HistoryBatchRecord,
  HistoryManager,
} from './dip/history-manager.js';

export type {
  ManualReflectionPolicy,
  ReflectionPolicy,
  ReflectionTrigger,
} from './dip/reflection-policy.js';

export type {
  SkillRepresentation,
  SkillRepresentationStrategy,
} from './dip/skill-representation-strategy.js';

export type {
  EvictionPolicy,
  EvictionResult,
  HalfLifePersister,
  NearestNeighborProvider,
  ScoreContext,
} from './dip/eviction-policy.js';
export { InvalidFractionError, assertValidFraction } from './dip/eviction-policy.js';

export type {
  ConflictResolutionPolicy,
  ConflictResolutionResult,
  ConsolidationCandidate,
  ConsolidationContext,
} from './dip/conflict-resolution-policy.js';
export { NoopConflictPolicy } from './conflict-resolution/noop.js';
export { LastWriteWinsConflictPolicy, compareCandidatesDesc } from './conflict-resolution/last-write-wins.js';
export {
  LlmJudgedMergeConflictPolicy,
  parseConsolidationResponse,
  type LlmJudgedMergeConflictPolicyOptions,
} from './conflict-resolution/llm-judged-merge.js';
export {
  CONFLICT_MERGE_PROMPT,
  generateConflictMergePrompt,
} from './conflict-resolution/prompts.js';

// Pure-core algorithms (v0.1, Phase 1)
export { hashFact } from './dedup.js';
export { STOP_WORDS, lemmatizeForBm25, simpleStem } from './lemmatization.js';
export {
  ENTITY_BOOST_WEIGHT,
  combineScores,
  entityBoost,
  maxPossible,
  sigmoidBm25,
} from './scoring.js';
export type { ActiveSignals, CandidateScores } from './scoring.js';

// Cross-cutting constants
export { MAX_EMBEDDING_DIM } from './constants.js';

// Observable events (Phase 4 + Phase 5)
export { MEMORY_EVENTS, emitEvent } from './memory-event.js';
export type { AttributeValue, MemoryEvent } from './memory-event.js';

// Extraction prompt (Phase 4)
export {
  AdditiveExtractionSchema,
  escapeMarkdownHeaders,
  generateAdditiveExtractionPrompt,
} from './extraction/prompt.js';
export type { AdditiveExtractionResponse, PromptResult } from './extraction/prompt.js';

// Extraction pipeline (Phase 4 — the 8-phase write)
export { runExtractionPipeline } from './extraction/pipeline.js';
export type { ExtractionDeps } from './extraction/pipeline.js';

// Retrieval pipeline (Phase 5 — the 9-step search)
export { runRetrievalPipeline } from './retrieval/pipeline.js';
export type { RetrievalDeps } from './retrieval/pipeline.js';
