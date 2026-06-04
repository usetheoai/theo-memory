/**
 * Memory contract centerpiece. Three interfaces define the public + adapter surfaces:
 *
 *   - MemoryStore       — primitive adapters implement (local + cloud share this shape)
 *   - Memory            — top-level public API (returned by createMemory/createCloudMemory at v0.1+)
 *   - ScopedMemory      — sub-object returned by Memory.user/.session/.agent
 *
 * Plus the construction-time config shapes:
 *
 *   - MemoryConfig      — local + cloud common
 *   - CloudMemoryConfig — cloud extension (apiKey + baseUrl)
 *
 * @see ADR-0001 — upstream-shape architecture (adopt the pipeline; diverge on public verbs)
 * @see ADR-0002 — three-tier scope via scoped sub-objects
 * @see ADR-0003 — ADD-only public API (no update method)
 * @see ADR-0004 — API verbs (remember/recall/forget/reflect + parity helpers)
 * @see ADR-0005 — reflection trigger (explicit-only; ReflectionPolicy DIP)
 * @see ADR-0006 — bi-temporal columns (asOf uniform in type; runtime divergence)
 * @see ADR-0007 — entity store opt-out via MemoryConfig.entityBoost
 * @see ADR-0008 — DIP method counts (5 DIPs: VectorStore 11, LLM 2, Embedder 2, HistoryManager 4+3, ReflectionPolicy 1+2)
 * @see ADR-0009 — cloud auth: THEOKIT_API_KEY reuse + optional apiKey override
 */
import type { Embedder } from './dip/embedder.js';
import type { HistoryManager } from './dip/history-manager.js';
import type { LLM } from './dip/llm.js';
import type { ReflectionPolicy } from './dip/reflection-policy.js';
import type { VectorStore } from './dip/vector-store.js';
import type { HistoryEntry } from './history-entry.js';
import type { MemoryItem, MemoryItemWithScore } from './memory-item.js';
import type {
  ForgetOptions,
  GetAllOptions,
  RecallOptions,
  ReflectOptions,
  RememberOptions,
} from './options.js';
import type { ReflectionResult } from './reflection-result.js';
import type { Scope } from './scope.js';
import type { ScopedSkillMemory } from './skill.js';

/**
 * Underlying primitive that adapters (src/local/, src/cloud/) implement.
 * Each operation takes an explicit scope; the public Memory + ScopedMemory APIs
 * derive scope from the sub-object form and forward to this surface.
 */
export interface MemoryStore {
  remember(text: string, scope: Scope, options?: RememberOptions): Promise<readonly MemoryItem[]>;
  recall(query: string, scope: Scope, options?: RecallOptions): Promise<readonly MemoryItemWithScore[]>;
  forget(memoryId: string, options?: ForgetOptions): Promise<void>;
  reflect(scope: Scope, options?: ReflectOptions): Promise<ReflectionResult>;
  get(memoryId: string): Promise<MemoryItem | null>;
  getAll(scope: Scope, options?: GetAllOptions): Promise<readonly MemoryItem[]>;
  history(memoryId: string): Promise<readonly HistoryEntry[]>;
  reset(scope: Scope): Promise<void>;
}

/**
 * Scoped sub-object returned by Memory.user/.session/.agent.
 * Inherits the scope at construction time; downstream calls compose Filters from the captured scope.
 *
 * Notably excludes `forget` (memoryId is globally unique — use top-level Memory.forget)
 * and `update` (ADR-0003 ADD-only).
 */
export interface ScopedMemory {
  remember(text: string, options?: RememberOptions): Promise<readonly MemoryItem[]>;
  recall(query: string, options?: RecallOptions): Promise<readonly MemoryItemWithScore[]>;
  reflect(options?: ReflectOptions): Promise<ReflectionResult>;
  getAll(options?: GetAllOptions): Promise<readonly MemoryItem[]>;
}

/**
 * Top-level public surface. Returned by createMemory(config: MemoryConfig): Memory
 * (or createCloudMemory(config: CloudMemoryConfig): Memory at v0.1+).
 *
 * Three scoped entry-points + four parity helpers.
 */
export interface Memory {
  user(userId: string): ScopedMemory;
  session(sessionId: string): ScopedMemory;
  agent(agentId: string): ScopedMemory;

  /**
   * v0.6: code-as-skill procedural memory entry-point.
   *
   * Scopes the returned skill memory to a single repository identifier;
   * skills written under one `repoId` are isolated from skills under another.
   *
   * @see .claude/knowledge-base/plans/skill-library-plan.md § ADR D5 (no new subpath in v0.6)
   * @see .claude/knowledge-base/plans/skill-library-plan.md § ADR D1 (REUSE v0.4a reflect() chain)
   */
  skills(repoId: string): ScopedSkillMemory;

  /**
   * Globally unique memoryId — no scope required. Soft delete by default;
   * pass `{ hard: true }` for GDPR-style erasure.
   *
   * **v0.4b-fixes T7.1 — PUBLIC API BREAKING CHANGE** (ADR D7 + EC-3
   * absorption): the v0.1 shipped runtime physically deleted the row
   * (`raw SELECT post-forget returned 0 rows`) despite this JSDoc already
   * documenting soft-delete as the default. v0.4b aligns the runtime with
   * the documented contract: raw `SELECT * FROM memories WHERE id = $1`
   * post-forget returns 1 row with `t_invalid IS NOT NULL`. Consumers
   * asserting `count == 0 after forget()` must migrate to
   * `count_where_t_invalid_null == 0`. Historical rows are recoverable via
   * `WHERE t_invalid IS NOT NULL`. The cascade applies to v0.6
   * `ScopedSkillMemory.forget()` (routes through the same path).
   *
   * @see CHANGELOG.md [Unreleased] § Changed `**BREAKING**` entry
   */
  forget(memoryId: string, options?: ForgetOptions): Promise<void>;

  /** Fetch a single memory by id, or null if not present. */
  get(memoryId: string): Promise<MemoryItem | null>;

  /** Audit trail for a memory (chronological events). */
  history(memoryId: string): Promise<readonly HistoryEntry[]>;

  /** Administrative wipe of a scope. Explicit scope required (no implicit cross-scope reset). */
  reset(scope: Scope): Promise<void>;

  /**
   * v0.4a (T4.3 EC-7): wait for all in-flight async reflections to settle.
   *
   * When a configured ReflectionPolicy auto-fires reflect() (e.g.,
   * ThresholdReflectionPolicy after N writes), the reflection runs as a
   * fire-and-forget background promise tracked in a private pending set.
   * flushReflections() returns `Promise.allSettled([...pending])`, completing
   * once every started reflection has settled (success OR failure).
   *
   * Critical for deterministic observability in tests (THE GOAL TEST T6.1)
   * and graceful shutdown.
   */
  flushReflections(): Promise<void>;
}

/**
 * Construction-time config shared by local + cloud runtimes.
 * v0.1 ships createMemory(config: MemoryConfig): Memory factory.
 *
 * @see ADR-0007 — entityBoost default `true`
 */
export interface MemoryConfig {
  readonly embedder: Embedder;
  readonly llm: LLM;
  readonly vectorStore: VectorStore;

  /** Optional. v0.1 ships DummyHistoryManager (no-op) by default; consumers wire SQLite / Supabase later. */
  readonly historyManager?: HistoryManager;

  /** Optional. v0.0 ships ManualReflectionPolicy as the only built-in. */
  readonly reflectionPolicy?: ReflectionPolicy;

  /** Default `true`. When `false`, no entity vector store is instantiated; halves storage cost. @see ADR-0007 */
  readonly entityBoost?: boolean;

  /** Optional system-prompt prefix injected into LLM extraction calls (upstream-pipeline parity). */
  readonly customInstructions?: string;
}

/**
 * Cloud-runtime extension. Adds optional apiKey + baseUrl over MemoryConfig.
 * v0.5 ships createCloudMemory(config: CloudMemoryConfig): Memory factory.
 *
 * @see ADR-0009 — cloud auth: THEOKIT_API_KEY env var by default; apiKey constructor override.
 */
export interface CloudMemoryConfig extends MemoryConfig {
  /** Overrides `THEOKIT_API_KEY` env var when set. */
  readonly apiKey?: string;

  /** Cloud endpoint base URL. Defaults to TheoCloud production; override for dev / staging. */
  readonly baseUrl?: string;
}
