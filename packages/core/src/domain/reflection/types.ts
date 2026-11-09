/**
 * Types for the reflection execution pipeline per plan v0-4a-reflection-pipeline.
 *
 */
import type { LLM } from '../dip/llm.js';
import type { MemoryItem } from '../memory-item.js';
import type { Scope } from '../scope.js';

/**
 * Draft of a higher-order ("derived") memory returned by the reflection LLM.
 *
 * Per plan D11 + ADR D6: every derived memory MUST cite the source-memory IDs
 * it consolidates from in the `derived_from` array (non-empty array; validated
 * by T4.2 provenance.ts).
 */
export interface DerivedMemoryDraft {
  /** The consolidated insight text produced by the LLM. */
  readonly text: string;
  /** UUIDs of the source memories this draft is derived from. MUST be non-empty per ADR D6 CHECK. */
  readonly derivedFrom: readonly string[];
}

/**
 * Input context for `executeReflection`. Pure data — no DB access.
 */
export interface ReflectionExecuteContext {
  readonly llm: LLM;
  readonly sourceMemories: readonly MemoryItem[];
  readonly scope: Scope;
}

/** Current reflection prompt version. Bump on prompt-shape changes for cache invalidation. */
export const PROMPT_VERSION = '1.1';
