/**
 * LocalMemory — the top-level Memory implementation for the local runtime.
 *
 * Extracted from index.ts (T1.2 of architecture-review-fixes plan).
 */
import type { RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import type { ReflectionPolicy } from '../../domain/dip/reflection-policy.js';
import type { VectorStore } from '../../domain/dip/vector-store.js';
import {
  InvalidScope,
  MemoryNotFound,
  WorkspaceMismatch,
} from '../../domain/errors.js';
import type { HistoryEntry } from '../../domain/history-entry.js';
import type { MemoryItem } from '../../domain/memory-item.js';
import type {
  Memory,
  ScopedMemory,
} from '../../domain/memory-store.js';
import type {
  ForgetOptions,
} from '../../domain/options.js';
import type { RepoScope, Scope } from '../../domain/scope.js';
import type {
  ScopedSkillMemory,
  SkillsBySubjectOptions,
  SkillsBySubjectPage,
  SkillWithRepo,
} from '../../domain/skill.js';


import type { LocalMemoryConfig } from './config.js';
import { PgEvictor } from './eviction/index.js';
import { PgvectorStore as PgvectorStoreClass } from './pgvector-store.js';
import {
  assertScopeIsNonEmpty,
  deriveScopeFromPayload,
  filtersFromScope,
  LocalScopedMemory,
} from './scoped-memory.js';
import { LocalScopedSkillMemory } from './scoped-skill-memory.js';
import type { VectorStoreWithSkillInsert } from './skill-store-args.js';
import { decodeSkillPayload } from './skills/payload.js';

/**
 * v0.4b-fixes T4.1 extension: returned Memory carries a `dispose()` method
 * that stops the cron job + releases trigger resources. Non-eviction memories
 * still expose `dispose()` as a no-op so consumers can `await memory.dispose()`
 * unconditionally without runtime branching.
 *
 * Decision per SEPA iter 5 pre-RED CRITICAL #1 option (C): widen ONLY the
 * local factory return type — `Memory` interface stays unchanged so the cloud
 * runtime is not affected.
 */
export type DisposableMemory = Memory & { dispose(): Promise<void> };

export class LocalMemory implements Memory {
  /** v0.4a (T4.3 EC-7): in-flight reflection promises tracked for flushReflections(). */
  private readonly pendingReflections = new Set<Promise<unknown>>();

  constructor(
    private readonly config: LocalMemoryConfig,
    private readonly reflectionPolicy: ReflectionPolicy | undefined,
    /** semantic-recall-cache-v1-5 T2.1 — undefined when cache disabled. */
    private readonly recallCacheStore: RecallCacheStore | undefined = undefined,
    /**
     * multi-tenant-workspace-isolation T3.1: the bound workspace (ADR D1/D3).
     * `undefined` = unbound (SDK/unit path → store column default 'default');
     * set via {@link withWorkspace} on the REST/server path from the Principal.
     */
    private readonly workspaceId: string | undefined = undefined,
  ) {}

  /**
   * multi-tenant-workspace-isolation T3.1 (ADR D3): return a view of this memory
   * bound to `workspaceId`, so every subsequent `.user()/.session()/.agent()`
   * scopes its queries + inserts by that workspace. The REST handler calls this
   * with the authenticated Principal's workspace; the workspace NEVER comes from
   * the request body.
   */
  withWorkspace(workspaceId: string): Memory {
    return new LocalMemory(this.config, this.reflectionPolicy, this.recallCacheStore, workspaceId);
  }

  user(userId: string): ScopedMemory {
    const scope: Scope = { kind: 'user', userId };
    return new LocalScopedMemory(
      scope,
      filtersFromScope(scope, this.workspaceId),
      this.config,
      this.reflectionPolicy,
      this.pendingReflections,
      this.recallCacheStore,
    );
  }

  session(sessionId: string): ScopedMemory {
    const scope: Scope = { kind: 'session', sessionId };
    return new LocalScopedMemory(
      scope,
      filtersFromScope(scope, this.workspaceId),
      this.config,
      this.reflectionPolicy,
      this.pendingReflections,
      this.recallCacheStore,
    );
  }

  agent(agentId: string): ScopedMemory {
    const scope: Scope = { kind: 'agent', agentId };
    return new LocalScopedMemory(
      scope,
      filtersFromScope(scope, this.workspaceId),
      this.config,
      this.reflectionPolicy,
      this.pendingReflections,
      this.recallCacheStore,
    );
  }

  async flushReflections(): Promise<void> {
    // Snapshot the current set; new reflections may be added during iteration.
    const snapshot = [...this.pendingReflections];
    await Promise.allSettled(snapshot);
  }

  /**
   * v0.4b-fixes T7.1 — PUBLIC API BREAKING CHANGE (ADR D7 + EC-3 absorption).
   *
   * Behavior contract delta vs v0.1:
   * - **v0.1 (shipped)**: physical DELETE via `vectorStore.delete()`; raw
   *   `SELECT * FROM memories WHERE id = $1` post-forget returned 0 rows. This
   *   violated the documented `ForgetOptions.hard?: false` default at
   *   `src/core/options.ts:55-62`.
   * - **v0.4b-fixes (this)**: soft-delete via `t_invalid = NOW()` through the
   *   `PgEvictor` path (consistent with auto-eviction). Raw SELECT post-forget
   *   returns 1 row with `t_invalid IS NOT NULL`. Use `{ hard: true }` for
   *   GDPR-style physical delete.
   * - **Migration**: replace `assert count_after_forget == 0` with
   *   `assert count_where_t_invalid_null_after_forget == 0`. Historical rows
   *   recoverable via `WHERE t_invalid IS NOT NULL`.
   * - **Cascade**: v0.6 `ScopedSkillMemory.forget()` routes through this same
   *   path via `LocalScopedSkillMemory.forgetDelegate` — skill consumers also
   *   see the BREAKING change.
   *
   * `InMemoryVectorStore` consumers (dev/test) keep the v0.1 hard-delete
   * behavior — `t_invalid` is a Postgres-only concept; the in-memory adapter
   * does not model it. This preserves unit-test ergonomics while the
   * Postgres production path gains the soft-delete contract.
   *
   * @see CHANGELOG.md [Unreleased] § Changed `**BREAKING**` entry
   * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T7.1 + ADR D7
   * @see .claude/knowledge-base/reviews/v0-4b-fixes-cycle-edge-cases-2026-05-30.md § EC-3
   */
  async forget(memoryId: string, options?: ForgetOptions): Promise<void> {
    const existing = await this.config.vectorStore.get(memoryId);
    if (existing === null) {
      throw new MemoryNotFound(`memoryId ${memoryId} not found (EC-12: strict-mode forget throws on missing id)`);
    }
    // multi-tenant-workspace-isolation T3.1 / EC-5: when this memory is bound to
    // a workspace, a forget targeting a row in ANOTHER workspace is treated as
    // not-found (→ 404), and the other workspace's row is NEVER soft-deleted
    // (no destructive cross-workspace IDOR). Unbound (SDK) callers skip the check.
    if (this.workspaceId !== undefined) {
      const rowWorkspace = (existing.payload['workspace_id'] as string | undefined) ?? 'default';
      if (rowWorkspace !== this.workspaceId) {
        // /review F-wire-1: throw the typed WorkspaceMismatch (maps to 404 at the
        // handler per ADR D6 — NOT 403, no existence leak). The handler treats
        // WorkspaceMismatch and MemoryNotFound identically (both → 404).
        throw new WorkspaceMismatch(
          `memoryId ${memoryId} not in workspace ${this.workspaceId} (cross-workspace forget → 404, EC-5)`,
        );
      }
    }
    // semantic-recall-cache-v1-5 T2.2 — EC-10 absorption: derive the memory's
    // scope BEFORE the delete so we can issue a targeted `invalidateScope`
    // instead of an all-scope sweep. Falls back to undefined when the payload
    // does not carry any scope column (defensive — pre-v0.1 rows in theory).
    const scopeFromMemory = deriveScopeFromPayload(existing.payload);
    const hardDelete = options?.hard === true;
    const isPgStore = this.config.vectorStore instanceof PgvectorStoreClass;
    if (hardDelete || !isPgStore) {
      // GDPR-style physical delete (ForgetOptions.hard=true) OR non-Pg adapter
      // fallback (InMemoryVectorStore has no t_invalid concept).
      await this.config.vectorStore.delete(memoryId);
    } else {
      // Default soft-delete via PgEvictor — consistent with the v0.4b
      // auto-eviction path. Idempotent: a row already carrying t_invalid is
      // returned in `alreadyInvalid` without an exception.
      const evictor = new PgEvictor(this.config.vectorStore.poolForEviction);
      await evictor.evict([memoryId]);
    }
    // M1 forget-propagation — invalidate the edges this memory produced so they
    // do not outlive it (edge-own t_invalid, for the direct-edge-read surfaces).
    // Fail-soft: a graph-store failure must NEVER fail the memory forget (the
    // memory soft-delete above already succeeded). Hard-delete already cascades
    // the edges via the source_memory_id FK, so this only matters for soft-delete.
    if (this.config.memoryGraphStore !== undefined) {
      try {
        await this.config.memoryGraphStore.invalidateEdgesByMemory(memoryId);
      } catch {
        // swallow — edge invalidation is best-effort; forget is already durable.
      }
    }
    if (this.config.historyManager !== undefined) {
      try {
        await this.config.historyManager.addHistory(
          memoryId,
          String(existing.payload['text'] ?? ''),
          null,
          'forget',
          new Date(),
        );
      } catch {
        // Silent swallow — history persistence failure must not block forget
      }
    }
    // semantic-recall-cache-v1-5 T2.2 — Item 19 AC#3 cache invalidation
    // post-success. EC-11: sequentially awaited. EC-10: targeted to the
    // memory's resolved scope when discoverable; otherwise no-op (the cache
    // simply continues serving — slightly stale but bounded by TTL).
    if (this.recallCacheStore !== undefined && scopeFromMemory !== undefined) {
      try {
        // T3.1: scope cache invalidation to the forgotten row's workspace so
        // the correct workspace's cache entries are cleared (EC-8).
        const rowWorkspace = (existing.payload['workspace_id'] as string | undefined) ?? undefined;
        await this.recallCacheStore.invalidateScope(scopeFromMemory, rowWorkspace);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[themory] recall-cache invalidateScope (forget) failed:', err);
      }
    }
  }

  async get(memoryId: string): Promise<MemoryItem | null> {
    const result = await this.config.vectorStore.get(memoryId);
    if (result === null) {
      return null;
    }
    return {
      id: result.id,
      text: String(result.payload['text'] ?? ''),
      hash: String(result.payload['hash'] ?? result.id),
      scope: { kind: 'user', userId: String(result.payload['user_id'] ?? '') },
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { ...result.payload },
      tValid: new Date(),
      tInvalid: null,
    };
  }

  async history(memoryId: string): Promise<readonly HistoryEntry[]> {
    if (this.config.historyManager === undefined) {
      return [];
    }
    return this.config.historyManager.getHistory(memoryId);
  }

  async reset(scope: Scope): Promise<void> {
    assertScopeIsNonEmpty(scope);
    const filters = filtersFromScope(scope);
    // includeSoftDeleted=true: an administrative scope wipe must physically
    // remove EVERY row in scope, including already-forgotten (soft-deleted)
    // tombstones — otherwise GDPR erasure would leave them behind (the default
    // live-only list() excludes them).
    const [results] = await this.config.vectorStore.list(filters, 10_000, true);
    for (const r of results) {
      await this.config.vectorStore.delete(r.id);
    }
  }

  /**
   * v0.6: code-as-skill memory entry-point.
   *
   * Returns a `LocalScopedSkillMemory` bound to `repoId`. Internally maps to
   * the existing `agent_id` column at the store layer per the EC-4 absorption
   * in `filtersFromScope`; the `kind='skill'` discriminator disambiguates skill
   * rows from regular agent memories sharing the same id.
   *
   * @throws InvalidScope on empty `repoId`.
   * @see .claude/knowledge-base/plans/skill-library-plan.md § T4.1
   */
  skills(repoId: string): ScopedSkillMemory {
    // The local stores (PgvectorStore + InMemoryVectorStore) implement the
    // VectorStoreWithSkillInsert extension as duck-typed methods (off-DIP per
    // T2.1 design note); narrow at the boundary so the orchestrator sees the
    // augmented surface.
    const skillStore = this.config.vectorStore as VectorStore & VectorStoreWithSkillInsert;
    return new LocalScopedSkillMemory(repoId, {
      vectorStore: skillStore,
      embedder: this.config.embedder,
      llm: this.config.llm,
      // T3.1: thread the workspace binding so skill add/recall/consolidate isolate.
      ...(this.workspaceId !== undefined ? { workspaceId: this.workspaceId } : {}),
      // T4.1 / F10 + EC-2: forget delegates to LocalMemory.forget (canonical
      // path: writes the 'forget' history event); get delegates to LocalMemory.get
      // for the pre-delegate scope-isolation guard.
      forgetDelegate: (id: string) => this.forget(id),
      getDelegate: (id: string) => this.get(id),
      ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
      // agentic-skill-execution-sandbox T2.2 — opt-in execution: thread the
      // SkillExecutor when wired; absent ⇒ execute() throws not-configured (D3).
      ...(this.config.skillExecutor !== undefined
        ? { skillExecutor: this.config.skillExecutor }
        : {}),
    });
  }

  /**
   * skills-cross-repo-flat-list (ADR D2/D4) — flat cross-repo skills listing for
   * a subject. Delegates to the store's tenant-safe prefix scan, then decodes
   * each row into a `SkillWithRepo` (the `agent_id` with the `'{subject}:'`
   * prefix stripped → `repoId`). The bound workspace (ADR D3) is threaded; an
   * unbound Memory falls back to the `'default'` workspace (store column default).
   */
  async listSkillsBySubject(
    subject: string,
    options?: SkillsBySubjectOptions,
  ): Promise<SkillsBySubjectPage> {
    if (subject.length === 0) {
      throw new InvalidScope('listSkillsBySubject requires a non-empty subject');
    }
    // The ':' delimiter is the namespace separator; a subject carrying it would
    // produce an ambiguous prefix → reject (tenant-safety, Drawback #2).
    if (subject.includes(':')) {
      throw new InvalidScope('listSkillsBySubject subject must not contain ":"');
    }
    const store = this.config.vectorStore as VectorStore & VectorStoreWithSkillInsert;
    const workspaceId = this.workspaceId ?? 'default';
    const prefix = `${subject}:`;
    const [rows, total] = await store.listSkillsBySubject({
      workspaceId,
      subject,
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
      includeSuperseded: options?.includeSuperseded === true,
      ...(options?.q !== undefined ? { q: options.q } : {}),
    });
    const skills: SkillWithRepo[] = [];
    for (const r of rows) {
      const agentId = r.payload['agent_id'];
      // Defensive: the prefix scan should only return matching rows, but skip any
      // row whose agent_id does not carry the expected prefix (never emit a wrong
      // repoId). Inquebrável Rule 3 — honest over silently-wrong.
      if (typeof agentId !== 'string' || !agentId.startsWith(prefix)) {
        continue;
      }
      const repoId = agentId.slice(prefix.length);
      const scope: RepoScope = { kind: 'repo', repoId };
      const decoded = decodeSkillPayload(r.id, r.payload, scope);
      if (decoded === null) {
        continue;
      }
      const withCreatedAt = r.createdAt !== undefined ? { ...decoded, createdAt: r.createdAt } : decoded;
      skills.push({ ...withCreatedAt, repoId });
    }
    return { skills, total };
  }
}
