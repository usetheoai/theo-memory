/**
 * LocalMemory — the top-level Memory implementation for the local runtime.
 *
 * M8 T0-b refactor: skill-factory methods moved to `local-skill-factory.ts` and the
 * repeated `new LocalScopedMemory(...)` construction deduped into `scoped()`, so this
 * file stays under the 300-LoC budget.
 */
import type { RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import type { RecallTraceStore } from '../../domain/dip/recall-trace-store.js';
import type { ReflectionPolicy } from '../../domain/dip/reflection-policy.js';
import { MemoryNotFound, WorkspaceMismatch } from '../../domain/errors.js';
import type { HistoryEntry } from '../../domain/history-entry.js';
import { emitEvent } from '../../domain/memory-event.js';
import { evidenceFromPayload } from '../../domain/memory-evidence.js';
import type { MemoryItem } from '../../domain/memory-item.js';
import type { Memory, ScopedMemory } from '../../domain/memory-store.js';
import type { ForgetOptions } from '../../domain/options.js';
import type { Filters } from '../../domain/scope.js';
import type { Scope } from '../../domain/scope.js';
import type {
  ScopedSkillMemory,
  SkillsBySubjectOptions,
  SkillsBySubjectPage,
} from '../../domain/skill.js';

import type { LocalMemoryConfig } from './config.js';
import { PgEvictor } from './eviction/index.js';
import { listSkillsBySubjectImpl, makeScopedSkillMemory } from './local-skill-factory.js';
import { PgvectorStore as PgvectorStoreClass } from './pgvector-store.js';
import {
  assertScopeIsNonEmpty,
  deriveScopeFromPayload,
  filtersFromScope,
  LocalScopedMemory,
} from './scoped-memory.js';

/**
 * v0.4b-fixes T4.1: the returned Memory carries a `dispose()` (stops the cron job +
 * releases trigger resources). Non-eviction memories expose it as a no-op so
 * consumers can `await memory.dispose()` unconditionally. Only the local factory
 * return type widens; the `Memory` interface is unchanged (cloud unaffected).
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
     * `undefined` = unbound (SDK/unit path → store column default 'default'); set
     * via {@link withWorkspace} on the REST/server path from the Principal.
     */
    private readonly workspaceId: string | undefined = undefined,
    /** explainable-recall (S1) — undefined when tracing disabled (default OFF). */
    private readonly recallTraceStore: RecallTraceStore | undefined = undefined,
  ) {}

  /**
   * multi-tenant-workspace-isolation T3.1 (ADR D3): return a view bound to
   * `workspaceId`, so every subsequent `.user()/.session()/.agent()` scopes its
   * queries + inserts by that workspace. The REST handler calls this with the
   * authenticated Principal's workspace; the workspace NEVER comes from the body.
   */
  withWorkspace(workspaceId: string): Memory {
    return new LocalMemory(
      this.config,
      this.reflectionPolicy,
      this.recallCacheStore,
      workspaceId,
      this.recallTraceStore,
    );
  }

  /** Construct a scoped memory for `scope` (shared by user/session/agent). */
  private scoped(scope: Scope): ScopedMemory {
    return new LocalScopedMemory(
      scope,
      filtersFromScope(scope, this.workspaceId),
      this.config,
      this.reflectionPolicy,
      this.pendingReflections,
      this.recallCacheStore,
      this.recallTraceStore,
    );
  }

  user(userId: string): ScopedMemory {
    return this.scoped({ kind: 'user', userId });
  }

  session(sessionId: string, userId?: string): ScopedMemory {
    // M8 (ADR D6): bind the session to the user when supplied → scope becomes
    // (workspace, user, session); omitted (SDK/workspace-admin) → workspace-scoped.
    return this.scoped({ kind: 'session', sessionId, ...(userId !== undefined ? { userId } : {}) });
  }

  agent(agentId: string, userId?: string): ScopedMemory {
    // M8 (ADR D6): bind the agent scope to the user when supplied.
    return this.scoped({ kind: 'agent', agentId, ...(userId !== undefined ? { userId } : {}) });
  }

  async flushReflections(): Promise<void> {
    // Snapshot the current set; new reflections may be added during iteration.
    const snapshot = [...this.pendingReflections];
    await Promise.allSettled(snapshot);
  }

  /**
   * v0.4b-fixes T7.1 — PUBLIC API BREAKING CHANGE (ADR D7 + EC-3 absorption).
   * Default forget is a soft-delete (`t_invalid = NOW()`) via the PgEvictor path
   * (consistent with auto-eviction); a raw SELECT post-forget returns 1 row with
   * `t_invalid IS NOT NULL`. Use `{ hard: true }` for GDPR-style physical delete.
   * `InMemoryVectorStore` (dev/test) keeps the v0.1 hard-delete (no `t_invalid`).
   * @see CHANGELOG.md [Unreleased] § Changed `**BREAKING**` entry
   */
  async forget(memoryId: string, options?: ForgetOptions): Promise<void> {
    const existing = await this.config.vectorStore.get(memoryId);
    if (existing === null) {
      throw new MemoryNotFound(`memoryId ${memoryId} not found (EC-12: strict-mode forget throws on missing id)`);
    }
    // multi-tenant-workspace-isolation T3.1 / EC-5: a forget targeting a row in
    // ANOTHER workspace is treated as not-found (→ 404); the other workspace's row
    // is NEVER soft-deleted (no destructive cross-workspace IDOR). Unbound (SDK)
    // callers skip the check.
    if (this.workspaceId !== undefined) {
      const rowWorkspace = (existing.payload['workspace_id'] as string | undefined) ?? 'default';
      if (rowWorkspace !== this.workspaceId) {
        // /review F-wire-1: typed WorkspaceMismatch (maps to 404 at the handler per
        // ADR D6 — NOT 403, no existence leak). Handler treats it like MemoryNotFound.
        throw new WorkspaceMismatch(
          `memoryId ${memoryId} not in workspace ${this.workspaceId} (cross-workspace forget → 404, EC-5)`,
        );
      }
    }
    // EC-10: derive the memory's scope BEFORE the delete so we can issue a targeted
    // `invalidateScope` instead of an all-scope sweep. Undefined when the payload
    // carries no scope column (defensive — pre-v0.1 rows in theory).
    const scopeFromMemory = deriveScopeFromPayload(existing.payload);
    const hardDelete = options?.hard === true;
    const isPgStore = this.config.vectorStore instanceof PgvectorStoreClass;
    if (hardDelete || !isPgStore) {
      // GDPR-style physical delete OR non-Pg adapter fallback (no t_invalid concept).
      await this.config.vectorStore.delete(memoryId);
      // ADR-0027 — a physical delete erases the memory's source messages. Postgres does it in
      // the delete's transaction (trigger); this covers adapters without one.
      const log = this.config.messageLog;
      if (log !== undefined && log !== false) {
        const p = existing.payload;
        const text = (key: string): string | undefined => (typeof p[key] === 'string' ? (p[key]) : undefined);
        const filters = Object.fromEntries(
          (['workspace_id', 'user_id', 'session_id', 'agent_id'] as const)
            .map((key) => [key, text(key)])
            .filter(([, value]) => value !== undefined),
        ) as Filters;
        await log.eraseSourcesOf(filters, memoryId);
      }
    } else {
      // Default soft-delete via PgEvictor — idempotent on an already-invalid row.
      const evictor = new PgEvictor(this.config.vectorStore.poolForEviction);
      await evictor.evict([memoryId]);
    }
    // M1 forget-propagation — invalidate the edges this memory produced so they do
    // not outlive it. Fail-soft: a graph-store failure must NEVER fail the forget
    // (the memory soft-delete already succeeded). Hard-delete cascades edges via FK.
    if (this.config.memoryGraphStore !== undefined) {
      try {
        await this.config.memoryGraphStore.invalidateEdgesByMemory(memoryId);
      } catch (err) {
        // Observable-not-silent (Princípio 3): an edge outliving its forgotten memory
        // is diagnosable — mirrors the recall-cache invalidation swallow below.
        // eslint-disable-next-line no-console
        console.error('[themory] edge invalidateEdgesByMemory (forget) failed:', err);
      }
    }
    // A hard forget erases the memory's history by cascade, so it records none (#236).
    if (this.config.historyManager !== undefined && !hardDelete) {
      try {
        await this.config.historyManager.addHistory(
          memoryId,
          String(existing.payload['text'] ?? ''),
          null,
          'forget',
          new Date(),
        );
      } catch (err) {
        // The forget already happened; a missing audit row must be visible, not silent.
        emitEvent(this.config.tracer, 'history_persist_failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    // Item 19 AC#3 cache invalidation post-success. EC-11: sequentially awaited.
    // EC-10: targeted to the memory's resolved scope when discoverable; otherwise
    // no-op (cache continues serving — slightly stale but bounded by TTL).
    if (this.recallCacheStore !== undefined && scopeFromMemory !== undefined) {
      try {
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
    // A FORGOTTEN memory is not readable. `forget` soft-deletes (sets `t_invalid`), and every
    // other read path filters it — but this by-id read did not, so a memory the user had just
    // forgotten still came back (found by the M14 live test). The raw store `get` intentionally
    // still returns the row so `forget({hard:true})` can GDPR-erase an already-forgotten one.
    if (result.payload['t_invalid'] !== undefined && result.payload['t_invalid'] !== null) {
      return null;
    }
    const expiry = result.payload['expires_at'];
    if (typeof expiry === 'string' && Date.parse(expiry) <= Date.now()) return null;
    // Workspace isolation (mirrors `forget` EC-5, theo-memory#82): a workspace-bound Memory
    // NEVER reads another tenant's row. The raw `vectorStore.get(id)` is unscoped (WHERE id=$1);
    // without this guard, `get(id)` was a cross-tenant IDOR (caught by the M14 Phase 5 isolation
    // gate). When no workspace is bound (single-tenant / no-auth dev), the row is served as-is.
    if (this.workspaceId !== undefined) {
      const rowWorkspace = (result.payload['workspace_id'] as string | undefined) ?? 'default';
      if (rowWorkspace !== this.workspaceId) {
        return null;
      }
    }
    const createdAt = result.createdAt ?? (typeof result.payload['created_at'] === 'string' ? new Date(result.payload['created_at']) : new Date());
    return {
      id: result.id,
      text: String(result.payload['text'] ?? ''),
      hash: String(result.payload['hash'] ?? result.id),
      scope: { kind: 'user', userId: String(result.payload['user_id'] ?? '') },
      createdAt,
      updatedAt: createdAt,
      metadata: { ...result.payload },
        tValid: createdAt,
      tInvalid: null,
      ...evidenceFromPayload(result.payload),
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
    // includeSoftDeleted=true: an administrative scope wipe must physically remove
    // EVERY row in scope, including already-forgotten tombstones (GDPR erasure).
    const [results] = await this.config.vectorStore.list(filters, 10_000, true);
    for (const r of results) {
      await this.config.vectorStore.delete(r.id);
    }
  }

  /**
   * v0.6: code-as-skill memory entry-point — a `LocalScopedSkillMemory` bound to
   * `repoId` (maps to the `agent_id` column, `kind='skill'` discriminator).
   * @throws InvalidScope on empty `repoId`.
   */
  skills(repoId: string): ScopedSkillMemory {
    return makeScopedSkillMemory(
      this.config,
      this.workspaceId,
      (id: string) => this.forget(id),
      (id: string) => this.get(id),
      repoId,
    );
  }

  /** skills-cross-repo-flat-list (ADR D2/D4) — flat cross-repo skills listing. */
  listSkillsBySubject(subject: string, options?: SkillsBySubjectOptions): Promise<SkillsBySubjectPage> {
    return listSkillsBySubjectImpl(this.config, this.workspaceId, subject, options);
  }
}
