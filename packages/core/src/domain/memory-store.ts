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
import type { EpisodeListOptions, EpisodePage } from './episode.js';
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
  /**
   * @param text — free-form natural language. **Storage is verbatim** — NO input
   *   sanitization or HTML escaping is applied. Consumers rendering memory text in
   *   HTML MUST escape on render per OWASP output-encoding discipline. React
   *   auto-escapes JSX by default; raw HTML renderers require explicit sanitization
   *   (e.g., DOMPurify). This is a deliberate design: input sanitization would
   *   corrupt legitimate content containing HTML-like strings in code memories.
   *   @see RED TEAM F4 (red-team-full-system-fixes-cycle-1 T3.1)
   */
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
 * Excludes `update` (ADR-0003 ADD-only). `forget` IS available here as a
 * SUBJECT-SCOPED delete (themory-scoped-forget T1.1, ADR D1): unlike the
 * workspace-only `Memory.forget`, this variant deletes a memory ONLY when it
 * belongs to THIS scope (cross-scope id → MemoryNotFound → 404, no existence
 * leak), so a multi-tenant gateway can delete-by-id without an O(scope)
 * ownership pre-check.
 */
export interface ScopedMemory {
  /**
   * @param text — free-form natural language. **Storage is verbatim** — see
   *   MemoryStore.remember JSDoc for the full XSS-safety contract (consumers
   *   MUST escape on render; no input sanitization applied).
   */
  remember(text: string, options?: RememberOptions): Promise<readonly MemoryItem[]>;
  recall(query: string, options?: RecallOptions): Promise<readonly MemoryItemWithScore[]>;
  reflect(options?: ReflectOptions): Promise<ReflectionResult>;
  getAll(options?: GetAllOptions): Promise<readonly MemoryItem[]>;

  /**
   * Episodic / message-log read surface (M2 / gap G3): list this scope's
   * memories as a cursor-paginated, bi-temporal-aware TEMPORAL log. The episode
   * boundary is the Session tier (`session_id`), generalizing to user/agent as
   * the temporal projection of whatever scope this sub-object is bound to.
   *
   * Distinct from `recall()` (semantic) and `getAll()` (unordered page): episodes
   * are ordered by `(created_at, id)`, cursor-paginated (`after`/`before`/`limit`/
   * `order`), exclude soft-deleted rows by default, and honor `asOf` bi-temporal
   * replay (a row soft-deleted AFTER `asOf` still appears at `asOf`). An optional
   * `queryText` applies a literal partial-text filter (NOT semantic search).
   *
   * Additive: the 4 existing verbs (remember/recall/forget/getAll) are unchanged.
   *
   * @see .claude/knowledge-base/plans/first-class-episodes-plan.md § T1.2 + ADRs D1-D4
   */
  episodes(options?: EpisodeListOptions): Promise<EpisodePage>;

  /**
   * Subject-scoped delete. Deletes `memoryId` ONLY if it belongs to this scope
   * (+ workspace); a cross-scope / cross-workspace / missing id throws
   * `MemoryNotFound` (→ 404 at the REST layer, never 403 — no existence leak).
   * Soft by default (`t_invalid` on the Pg runtime); `{ hard: true }` for
   * GDPR-style physical erasure. @see ADR D1 of themory-scoped-forget plan.
   */
  forget(memoryId: string, options?: ForgetOptions): Promise<void>;
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
   * multi-tenant-workspace-isolation T3.1 (ADR D1/D3): return a view of this
   * memory bound to a `workspaceId`, so every subsequent `.user()/.session()/
   * .agent()` scopes its queries + inserts by that workspace. The REST/MCP
   * layer calls this with the authenticated Principal's workspace; the
   * workspace is resolved from the credential, NEVER from the request body.
   *
   * OPTIONAL during the migration window — impls that predate workspace
   * isolation omit it; the default (no binding) maps to the `default`
   * workspace at the store layer (ADR D7).
   *
   * @see .claude/knowledge-base/plans/multi-tenant-workspace-isolation-plan.md § T3.1 + ADR D1/D3
   */
  withWorkspace?(workspaceId: string): Memory;

  /**
   * v0.6: code-as-skill procedural memory entry-point.
   *
   * Scopes the returned skill memory to a single repository identifier;
   * skills written under one `repoId` are isolated from skills under another.
   *
   * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § ADR D5 (no new subpath in v0.6)
   * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § ADR D1 (REUSE v0.4a reflect() chain)
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

  /**
   * Optional. v0.0 shipped ManualReflectionPolicy as the only built-in; v0.4a
   * added ThresholdReflectionPolicy + SleepTimeReflectionPolicy behind the
   * same DIP.
   *
   * Behavior under `createLocalMemory` (ADR-0005 v1.1 supplementary
   * amendment, locked by verbs-as-cli-fixes-cycle-1 T1.1):
   * - **Key OMITTED** → factory defaults to `{ kind: 'manual', shouldReflect: () => Promise.resolve(true) }`.
   *   `reflect()` succeeds without explicit wiring.
   * - **Explicit `undefined` (key present)** → preserves the ADR-0005 v1.0
   *   `ReflectionNotConfigured` throw on the first `reflect()` call. Use this
   *   path when consumer code MUST fail loudly on missing-policy. Type
   *   widened to `ReflectionPolicy | undefined` by verbs-as-cli-fixes-cycle-2
   *   ADR D3 so this opt-in is typed-reachable under
   *   `exactOptionalPropertyTypes: true`.
   * - **Explicit policy** → factory wires the passed reference (no
   *   substitution); the policy's `onReflectionEnd` hook fires on each
   *   `reflect()` call.
   *
   * @see ADR-0005 § Supplementary amendment v1.1 — the runtime distinction
   * @see src/local/__tests__/factory.test.ts § EC-2 paths a/b/c — locks the 3 paths
   */
  readonly reflectionPolicy?: ReflectionPolicy | undefined;

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
