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
import type { ScoredLoggedMessage } from './dip/message-log.js';
import type { EpisodeListOptions, EpisodePage } from './episode.js';
import type { HistoryEntry } from './history-entry.js';
import type { MemoryItem, MemoryItemWithScore } from './memory-item.js';
import type { Message } from './message.js';
import type {
  ForgetOptions,
  GetAllOptions,
  RecallOptions,
  ReflectOptions,
  RememberOptions,
} from './options.js';
import type { ReflectionResult } from './reflection-result.js';
import type { Scope } from './scope.js';
import type {
  ScopedSkillMemory,
  SkillsBySubjectOptions,
  SkillsBySubjectPage,
} from './skill.js';

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
 * One SESSION sub-scope of a `(workspace, user)` anchor, as returned by
 * `ScopedMemory.listSessions()` (session-separation fix 2026-07-23).
 */
export interface SessionSummary {
  readonly sessionId: string;
  /** Live (non-soft-deleted) memories currently held by this session. */
  readonly memoryCount: number;
  /** `MAX(created_at)` over the session's live rows — newest activity. */
  readonly lastActivityAt: Date;
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
/** Options of `ScopedMemory.searchMessages`. */
export interface SearchMessagesOptions {
  /** Maximum number of messages, 1..100. Default 5. */
  readonly limit?: number;
  /** Leave out messages observed (or, without an observation time, logged) after this instant. */
  readonly asOf?: Date;
}

export interface ScopedMemory {
  /**
   * @param text — free-form natural language. **Storage is verbatim** — see
   *   MemoryStore.remember JSDoc for the full XSS-safety contract (consumers
   *   MUST escape on render; no input sanitization applied).
   */
  remember(text: string, options?: RememberOptions): Promise<readonly MemoryItem[]>;
  /**
   * Extract and persist a batch of already-attributed conversation turns in one
   * pipeline invocation. Role labels are preserved as source evidence. This is
   * useful for ingesting a session atomically without flattening its speakers.
   */
  rememberMessages(messages: readonly Message[], options?: RememberOptions): Promise<readonly MemoryItem[]>;
  recall(query: string, options?: RecallOptions): Promise<readonly MemoryItemWithScore[]>;
  reflect(options?: ReflectOptions): Promise<ReflectionResult>;
  getAll(options?: GetAllOptions): Promise<readonly MemoryItem[]>;

  /**
   * REAL total of active (live) memories in this scope — a store-level COUNT,
   * never the length of a paginated `getAll()` page (#113: the dashboard showed
   * "TOTAL MEMORIES = 100" for a 440-memory scope because the page cap leaked
   * into the metric). Cheap: single SQL COUNT under the scope filter.
   */
  count(): Promise<number>;

  /**
   * Distinct SESSION sub-scopes under this scope's `(workspace, user)` anchor,
   * newest activity first, live rows only (session-separation fix 2026-07-23 —
   * without it the M8 session tier was unenumerable, so no UI session picker).
   */
  listSessions(): Promise<readonly SessionSummary[]>;

  /**
   * Search over the raw messages this scope can see, best first, separate from `recall`: BM25
   * fused with embedding similarity by Reciprocal Rank Fusion (ADR-0031), so a paraphrase finds
   * the turn too, and neighbours by meaning can fill the list. `score` is the fused score. It
   * reaches what was said even when extraction kept no fact of it. The query is embedded with the
   * memory's embedder, and an embedder failure throws, as in `recall`. A user-bound
   * session sees its own messages and the user's global ones, like `recall`. `limit` defaults
   * to 5 and must be an integer in 1..100 (`RangeError` otherwise); throws
   * `MessageLogNotConfigured` when the memory was created with `messageLog: false`.
   */
  searchMessages(query: string, options?: SearchMessagesOptions): Promise<readonly ScoredLoggedMessage[]>;

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
  /**
   * M8 (ADR D6) — optional `userId` binds the session to a user, making its scope
   * `(workspace, user, session)`. Callers with an authenticated Principal pass
   * `principal.userId`; SDK/workspace-admin callers omit it (workspace-scoped).
   * Backward-compatible: the 1-arg form is unchanged.
   */
  session(sessionId: string, userId?: string): ScopedMemory;
  agent(agentId: string, userId?: string): ScopedMemory;

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
   */
  withWorkspace?(workspaceId: string): Memory;

  /**
   * v0.6: code-as-skill procedural memory entry-point.
   *
   * Scopes the returned skill memory to a single repository identifier;
   * skills written under one `repoId` are isolated from skills under another.
   *
   */
  skills(repoId: string): ScopedSkillMemory;

  /**
   * skills-cross-repo-flat-list (ADR D2/D4) — list ALL skills for a `subject`
   * across EVERY repo (flat), each row carrying its `repoId`. Tenant isolation is
   * enforced by the `agent_id` prefix the gateway namespaces per authenticated
   * subject; the listing filters `agent_id LIKE '{subject}:%'` (wildcards
   * escaped) AND the bound workspace. Offset pagination + optional `q`
   * description filter. Complements `skills(repoId)` (single-repo) — the browse
   * surface that does not require knowing a repoId upfront.
   *
   */
  listSkillsBySubject(
    subject: string,
    options?: SkillsBySubjectOptions,
  ): Promise<SkillsBySubjectPage>;

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
 * Config contracts moved to `memory-config.ts` (2026-07-23 module-size split);
 * re-exported here so existing `from './memory-store.js'` importers are unchanged.
 */
export type { MemoryConfig, CloudMemoryConfig } from './memory-config.js';
