/**
 * LocalMemory — the top-level Memory implementation for the local runtime.
 *
 * Extracted from index.ts (T1.2 of architecture-review-fixes plan).
 */
import type { RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import type { ReflectionPolicy } from '../../domain/dip/reflection-policy.js';
import type { VectorStore } from '../../domain/dip/vector-store.js';
import {
  MemoryNotFound,
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
import type { Scope } from '../../domain/scope.js';
import type { ScopedSkillMemory } from '../../domain/skill.js';

import type { LocalMemoryConfig } from './config.js';
import { PgEvictor } from './eviction/index.js';
import { PgvectorStore as PgvectorStoreClass } from './pgvector-store.js';
import { LocalScopedSkillMemory } from './scoped-skill-memory.js';
import {
  assertScopeIsNonEmpty,
  deriveScopeFromPayload,
  filtersFromScope,
  LocalScopedMemory,
} from './scoped-memory.js';
import type { VectorStoreWithSkillInsert } from './skill-store-args.js';

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
  ) {}

  user(userId: string): ScopedMemory {
    const scope: Scope = { kind: 'user', userId };
    return new LocalScopedMemory(
      scope,
      filtersFromScope(scope),
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
      filtersFromScope(scope),
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
      filtersFromScope(scope),
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
        await this.recallCacheStore.invalidateScope(scopeFromMemory);
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
    const [results] = await this.config.vectorStore.list(filters, 10_000);
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
      // T4.1 / F10 + EC-2: forget delegates to LocalMemory.forget (canonical
      // path: writes the 'forget' history event); get delegates to LocalMemory.get
      // for the pre-delegate scope-isolation guard.
      forgetDelegate: (id: string) => this.forget(id),
      getDelegate: (id: string) => this.get(id),
      ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
    });
  }
}
