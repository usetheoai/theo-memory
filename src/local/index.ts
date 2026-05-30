/**
 * createLocalMemory factory — T7.1 of v0-1-local-runtime plan v1.3.
 *
 * Wires the 5 DIPs (VectorStore, Embedder, LLM, optional HistoryManager,
 * optional ReflectionPolicy) into a runtime Memory facade that exposes the
 * v0.0 contract surface (Memory + ScopedMemory).
 *
 * Embedder dimension probe (EC-5): at construction time, calls
 * embedder.embed('__themem_probe__') once. If the returned vector length
 * != MAX_EMBEDDING_DIM, throws EmbeddingMismatch BEFORE the first user call —
 * turns a runtime-silent-drop into a startup-loud-error.
 *
 * Per ADR-0005, reflection is explicit-only at v0.0; LocalScopedMemory.reflect
 * throws ReflectionNotConfigured unless config.reflectionPolicy is provided.
 *
 * Per ADR-0006, recall with options.asOf throws BiTemporalNotSupportedLocally.
 *
 * Per EC-12, forget(unknown_id) throws MemoryNotFound.
 * Per EC-13, reset({}) throws InvalidScope (prevents whole-table wipe).
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T7.1
 */
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Tracer } from '@opentelemetry/api';
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

import { MAX_EMBEDDING_DIM } from '../core/constants.js';
import type { Embedder } from '../core/dip/embedder.js';
import type { ReflectionPolicy } from '../core/dip/reflection-policy.js';
import {
  BiTemporalNotSupportedLocally,
  EmbeddingMismatch,
  InvalidScope,
  MemoryNotFound,
  ReflectionNotConfigured,
} from '../core/errors.js';
import { runExtractionPipeline } from '../core/extraction/pipeline.js';
import type { HistoryEntry } from '../core/history-entry.js';
import type { MemoryItem, MemoryItemWithScore } from '../core/memory-item.js';
import type {
  Memory,
  MemoryConfig,
  ScopedMemory,
} from '../core/memory-store.js';
import type { ScopedSkillMemory } from '../core/skill.js';
import type { Message } from '../core/message.js';
import type {
  ForgetOptions,
  GetAllOptions,
  RecallOptions,
  ReflectOptions,
  RememberOptions,
} from '../core/options.js';
import { executeReflection } from '../core/reflection/execute.js';
import { validateProvenance } from '../core/reflection/provenance.js';
import type { ReflectionResult } from '../core/reflection-result.js';
import { runRetrievalPipeline } from '../core/retrieval/pipeline.js';
import type { Filters, Scope } from '../core/scope.js';

export { InMemoryVectorStore } from './in-memory-store.js';
export { PgvectorStore } from './pgvector-store.js';
export { DrizzleHistoryManager } from './history-manager.js';
export { entities, history, memories } from './schema.js';
export { StubEmbedder, StubLLM } from './stubs.js';

/** Extended MemoryConfig with the OTel tracer slot from ADR D1.3. */
export interface LocalMemoryConfig extends MemoryConfig {
  readonly tracer?: Tracer;
}

export const PROBE_TEXT = '__themem_probe__';

function filtersFromScope(scope: Scope): Filters {
  switch (scope.kind) {
    case 'user':
      return { user_id: scope.userId };
    case 'session':
      return scope.userId !== undefined
        ? { user_id: scope.userId, session_id: scope.sessionId }
        : { session_id: scope.sessionId };
    case 'agent':
      return scope.userId !== undefined
        ? { user_id: scope.userId, agent_id: scope.agentId }
        : { agent_id: scope.agentId };
  }
}

function assertScopeIsNonEmpty(scope: Scope): void {
  // Type-safe runtime guard — rejects {} or any malformed input lacking a valid kind.
  const kind = (scope as { kind?: string }).kind;
  if (kind !== 'user' && kind !== 'session' && kind !== 'agent') {
    throw new InvalidScope('reset requires a Scope with kind user/session/agent (EC-13)');
  }
  if (scope.kind === 'user' && scope.userId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
  if (scope.kind === 'session' && scope.sessionId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
  if (scope.kind === 'agent' && scope.agentId === '') {
    throw new InvalidScope('reset requires a non-empty scope key (EC-13)');
  }
}

interface VectorStoreWithDerivedInsert {
  insertDerivedMemory(args: {
    text: string;
    hash: string;
    embedding: readonly number[];
    derivedFrom: readonly string[];
    scope: { userId?: string | null; sessionId?: string | null; agentId?: string | null };
  }): Promise<string>;
}

function scopeToCounterTuple(scope: Scope): {
  userId: string | null;
  sessionId: string | null;
  agentId: string | null;
} {
  switch (scope.kind) {
    case 'user':
      return { userId: scope.userId, sessionId: null, agentId: null };
    case 'session':
      return { userId: scope.userId ?? null, sessionId: scope.sessionId, agentId: null };
    case 'agent':
      return { userId: scope.userId ?? null, sessionId: null, agentId: scope.agentId };
  }
}

class LocalScopedMemory implements ScopedMemory {
  constructor(
    private readonly scope: Scope,
    private readonly filters: Filters,
    private readonly config: LocalMemoryConfig,
    private readonly reflectionPolicy: ReflectionPolicy | undefined,
    /** v0.4a EC-7: shared pending-reflections set owned by LocalMemory. */
    private readonly pendingReflections: Set<Promise<unknown>> = new Set(),
  ) {}

  async remember(text: string, options?: RememberOptions): Promise<readonly MemoryItem[]> {
    const messages: readonly Message[] = [{ role: 'user', content: text }];
    const result = await runExtractionPipeline(messages, this.filters, {
      vectorStore: this.config.vectorStore,
      embedder: this.config.embedder,
      llm: this.config.llm,
      ...(this.config.historyManager !== undefined ? { historyManager: this.config.historyManager } : {}),
      ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
      ...(this.config.customInstructions !== undefined ? { customInstructions: this.config.customInstructions } : {}),
    }, options);

    // v0.4a: after successful write, check ReflectionPolicy. If it says fire,
    // launch reflect() as fire-and-forget tracked via pendingReflections (EC-7).
    if (this.reflectionPolicy !== undefined && this.reflectionPolicy.kind !== 'manual') {
      try {
        const trigger = { kind: this.reflectionPolicy.kind } as const;
        const fire = await this.reflectionPolicy.shouldReflect(this.scope, trigger);
        if (fire) {
          const promise = this.reflect()
            .catch(() => {
              // EC-12: failed reflection does NOT roll back the counter; orchestrator surfaces via onReflectionEnd.
            })
            .finally(() => {
              this.pendingReflections.delete(promise);
            });
          this.pendingReflections.add(promise);
        }
      } catch {
        // Policy decision failures must not block remember(); surface via flushReflections settled-but-rejected.
      }
    }

    return result;
  }

  async recall(query: string, options?: RecallOptions): Promise<readonly MemoryItemWithScore[]> {
    if (options?.asOf !== undefined) {
      throw new BiTemporalNotSupportedLocally();
    }
    return runRetrievalPipeline(query, this.filters, {
      vectorStore: this.config.vectorStore,
      embedder: this.config.embedder,
      ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
    }, options);
  }

  async reflect(options?: ReflectOptions): Promise<ReflectionResult> {
    void options;
    if (this.reflectionPolicy === undefined) {
      throw new ReflectionNotConfigured();
    }

    // Fetch source memories
    const [results] = await this.config.vectorStore.list(this.filters, 100);
    const sourceMemories: MemoryItem[] = results.map((r) => ({
      id: r.id,
      text: String(r.payload['text'] ?? ''),
      hash: String(r.payload['hash'] ?? r.id),
      scope: this.scope,
      metadata: { ...r.payload },
      createdAt: new Date(),
      updatedAt: new Date(),
      tValid: new Date(),
      tInvalid: null,
    }));

    // EC-5: empty-source short-circuit
    if (sourceMemories.length === 0) {
      const result: ReflectionResult = {
        higherOrderMemories: [],
        sourceIds: [],
        derivedMemoriesCreated: 0,
        reason: 'no-source-memories',
      };
      if (this.reflectionPolicy.onReflectionEnd !== undefined) {
        await this.reflectionPolicy.onReflectionEnd(this.scope, result);
      }
      return result;
    }

    // Run policy hook
    if (this.reflectionPolicy.onReflectionStart !== undefined) {
      await this.reflectionPolicy.onReflectionStart(this.scope, options ?? {});
    }

    try {
      // Execute reflection LLM call
      const drafts = await executeReflection({
        llm: this.config.llm,
        sourceMemories,
        scope: this.scope,
      });

      const sourceIds = sourceMemories.map((m) => m.id);

      // EC-13: LLM returned empty array (no consolidation)
      if (drafts.length === 0) {
        const result: ReflectionResult = {
          higherOrderMemories: [],
          sourceIds,
          derivedMemoriesCreated: 0,
          reason: 'no-consolidation',
        };
        if (this.reflectionPolicy.onReflectionEnd !== undefined) {
          await this.reflectionPolicy.onReflectionEnd(this.scope, result);
        }
        return result;
      }

      // Provenance validation (throws ReflectionProvenanceMissingError on fail)
      validateProvenance(drafts, sourceIds);

      // Embed + persist drafts. Store extension provides insertDerivedMemory.
      const storeWithDerived = this.config.vectorStore as unknown as VectorStoreWithDerivedInsert;
      if (typeof storeWithDerived.insertDerivedMemory !== 'function') {
        throw new Error(
          'reflect: configured vector store does not implement insertDerivedMemory; ' +
            'pass a PgvectorStore or InMemoryVectorStore from @usetheo/memory/local.',
        );
      }

      const counterTuple = scopeToCounterTuple(this.scope);
      const persisted: MemoryItem[] = [];
      for (const draft of drafts) {
        const embedding = await this.config.embedder.embed(draft.text);
        const hash = `derived-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
        const id = await storeWithDerived.insertDerivedMemory({
          text: draft.text,
          hash,
          embedding,
          derivedFrom: draft.derivedFrom,
          scope: counterTuple,
        });
        persisted.push({
          id,
          text: draft.text,
          hash,
          scope: this.scope,
          metadata: { kind: 'derived' },
          createdAt: new Date(),
          updatedAt: new Date(),
          tValid: new Date(),
          tInvalid: null,
        });
      }

      const result: ReflectionResult = {
        higherOrderMemories: persisted,
        sourceIds,
        derivedMemoriesCreated: persisted.length,
      };
      if (this.reflectionPolicy.onReflectionEnd !== undefined) {
        await this.reflectionPolicy.onReflectionEnd(this.scope, result);
      }
      return result;
    } catch (err) {
      if (this.reflectionPolicy.onReflectionEnd !== undefined) {
        await this.reflectionPolicy.onReflectionEnd(
          this.scope,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      throw err;
    }
  }

  async getAll(options?: GetAllOptions): Promise<readonly MemoryItem[]> {
    const limit = options?.topK ?? 100;
    const [results] = await this.config.vectorStore.list(this.filters, limit);
    return results.map((r) => ({
      id: r.id,
      text: String(r.payload['text'] ?? ''),
      hash: String(r.payload['hash'] ?? r.id),
      scope: this.scope,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { ...r.payload },
      tValid: new Date(),
      tInvalid: null,
    }));
  }
}

class LocalMemory implements Memory {
  /** v0.4a (T4.3 EC-7): in-flight reflection promises tracked for flushReflections(). */
  private readonly pendingReflections = new Set<Promise<unknown>>();

  constructor(
    private readonly config: LocalMemoryConfig,
    private readonly reflectionPolicy: ReflectionPolicy | undefined,
  ) {}

  user(userId: string): ScopedMemory {
    const scope: Scope = { kind: 'user', userId };
    return new LocalScopedMemory(
      scope,
      filtersFromScope(scope),
      this.config,
      this.reflectionPolicy,
      this.pendingReflections,
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
    );
  }

  async flushReflections(): Promise<void> {
    // Snapshot the current set; new reflections may be added during iteration.
    const snapshot = [...this.pendingReflections];
    await Promise.allSettled(snapshot);
  }

  async forget(memoryId: string, options?: ForgetOptions): Promise<void> {
    void options;
    const existing = await this.config.vectorStore.get(memoryId);
    if (existing === null) {
      throw new MemoryNotFound(`memoryId ${memoryId} not found (EC-12: divergence from REDACTED's silent no-op)`);
    }
    await this.config.vectorStore.delete(memoryId);
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
        // Silent swallow per REDACTED pattern (history failure must not block forget)
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
   * T1.1 lands the type contract per plan ADR D5; the runtime implementation
   * (`LocalScopedSkillMemory` class + factory wiring) ships in T4.1 alongside
   * the RepoScope union extension. Until then this placeholder satisfies the
   * `Memory` interface without fabricating behavior — invocation surfaces an
   * honest BLOCKED state rather than a silent no-op (Inquebrável Rule 3).
   *
   * @see .claude/knowledge-base/plans/skill-library-plan.md § T4.1
   */
  skills(repoId: string): ScopedSkillMemory {
    throw new Error(
      `LocalMemory.skills(${JSON.stringify(repoId)}) is not yet wired — lands at T4.1 (LocalScopedSkillMemory + RepoScope).`,
    );
  }
}

async function probeEmbedder(embedder: Embedder): Promise<void> {
  const vector = await embedder.embed(PROBE_TEXT);
  if (vector.length !== MAX_EMBEDDING_DIM) {
    throw new EmbeddingMismatch(MAX_EMBEDDING_DIM, vector.length);
  }
}

/**
 * Public factory. Probes embedder dimension first; throws EmbeddingMismatch
 * before the first user call if mismatched.
 */
export async function createLocalMemory(config: LocalMemoryConfig): Promise<Memory> {
  await probeEmbedder(config.embedder);
  await config.vectorStore.initialize();
  return new LocalMemory(config, config.reflectionPolicy);
}

/** Alias matching the public surface name (T7.2 re-exports). */
export { createLocalMemory as createMemory };

/**
 * Apply pgvector + Drizzle migrations to a Postgres database.
 *
 * For production use: run once at app boot before constructing `createMemory`.
 * Idempotent across BOTH provisioning paths (F-T7.1-2):
 *   1. fresh DB                              → `CREATE EXTENSION` + run migrations
 *   2. already migrated (journal present)    → `migrate()` is a journal-aware no-op
 *   3. schema pushed via `drizzle-kit push`  → detects orphan schema (tables present
 *      but no `__drizzle_migrations` journal), logs a warning, and skips `migrate()`
 *      to avoid "relation already exists" crashes. The push-flow is dev-only;
 *      mixing it with `runMigrations()` in prod is a config smell the warning surfaces.
 *
 * Resolves the migrations folder shipped inside the npm package (`src/local/migrations/`).
 * Consumers do NOT need to know the path — they just provide the pool.
 *
 * Per F-dom-2 + db-migrations CRITICAL #2: addresses the production gap where
 * createLocalMemory previously assumed the schema already existed. Now consumers
 * can either:
 *   - dev:  `npm run db:push` (introspection-based, runs CREATE EXTENSION first via npm script)
 *   - prod: `await runMigrations(pool)` at app boot, then `createMemory({...})`.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  // pgvector extension MUST exist before tables with vector columns can be created.
  // Idempotent; safe to re-run.
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

  // Detect the "drizzle-kit push" footgun: schema present but not journal-tracked.
  // Without this guard, `migrate()` would throw "relation already exists" on re-run.
  const journalCheck = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
     ) AS exists`,
  );
  const journalExists = journalCheck.rows[0]?.exists === true;

  if (!journalExists) {
    const memoriesCheck = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'memories'
       ) AS exists`,
    );
    const memoriesExists = memoriesCheck.rows[0]?.exists === true;
    if (memoriesExists) {
      // Schema present but not journal-tracked → push-flow was used. Skip migrate()
      // gracefully; this is a deployment-config smell, not a runtime error.
      // eslint-disable-next-line no-console
      console.warn(
        '[themory] schema present but `drizzle.__drizzle_migrations` journal missing. ' +
          'Likely `drizzle-kit push` was used — skipping runMigrations(). ' +
          'For production reproducibility, prefer `runMigrations()` on a fresh DB (F-T7.1-2).',
      );
      return;
    }
  }

  // Resolve migrations folder shipped inside this package.
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolvePath(here, 'migrations');

  const db = drizzleNodePostgres(pool);
  await migrate(db, { migrationsFolder });
}
