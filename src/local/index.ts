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
import type { Tracer } from '@opentelemetry/api';

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
import type { Message } from '../core/message.js';
import type {
  ForgetOptions,
  GetAllOptions,
  RecallOptions,
  ReflectOptions,
  RememberOptions,
} from '../core/options.js';
import type { ReflectionResult } from '../core/reflection-result.js';
import { runRetrievalPipeline } from '../core/retrieval/pipeline.js';
import type { Filters, Scope } from '../core/scope.js';

export { InMemoryVectorStore } from './in-memory-store.js';
export { PgvectorStore } from './pgvector-store.js';
export { DrizzleHistoryManager } from './history-manager.js';
export { entities, history, memories } from './schema.js';

/** Extended MemoryConfig with the OTel tracer slot from ADR D1.3. */
export interface LocalMemoryConfig extends MemoryConfig {
  readonly tracer?: Tracer;
}

const PROBE_TEXT = '__themem_probe__';

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

class LocalScopedMemory implements ScopedMemory {
  constructor(
    private readonly scope: Scope,
    private readonly filters: Filters,
    private readonly config: LocalMemoryConfig,
    private readonly reflectionPolicy: ReflectionPolicy | undefined,
  ) {}

  async remember(text: string, options?: RememberOptions): Promise<readonly MemoryItem[]> {
    const messages: readonly Message[] = [{ role: 'user', content: text }];
    return runExtractionPipeline(messages, this.filters, {
      vectorStore: this.config.vectorStore,
      embedder: this.config.embedder,
      llm: this.config.llm,
      ...(this.config.historyManager !== undefined ? { historyManager: this.config.historyManager } : {}),
      ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
      ...(this.config.customInstructions !== undefined ? { customInstructions: this.config.customInstructions } : {}),
    }, options);
  }

  async recall(query: string, options?: RecallOptions): Promise<readonly MemoryItemWithScore[]> {
    if (options?.asOf !== undefined) {
      throw new BiTemporalNotSupportedLocally('recall(asOf) is local v0.1; cloud v0.5+ supports it');
    }
    return runRetrievalPipeline(query, this.filters, {
      vectorStore: this.config.vectorStore,
      embedder: this.config.embedder,
      ...(this.config.tracer !== undefined ? { tracer: this.config.tracer } : {}),
    }, options);
  }

  reflect(_options?: ReflectOptions): Promise<ReflectionResult> {
    if (this.reflectionPolicy === undefined) {
      return Promise.reject(
        new ReflectionNotConfigured(
          'reflect() requires a ReflectionPolicy in MemoryConfig (ADR-0005; v0.4a ships ThresholdReflectionPolicy)',
        ),
      );
    }
    void this.scope;
    void _options;
    // v0.1 ships only ManualReflectionPolicy; the policy DIP is wired but the
    // actual reflection algorithm lands at v0.4a per roadmap Item 5.
    return Promise.reject(
      new ReflectionNotConfigured('reflect() implementation deferred to v0.4a (roadmap Item 5)'),
    );
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
  constructor(
    private readonly config: LocalMemoryConfig,
    private readonly reflectionPolicy: ReflectionPolicy | undefined,
  ) {}

  user(userId: string): ScopedMemory {
    const scope: Scope = { kind: 'user', userId };
    return new LocalScopedMemory(scope, filtersFromScope(scope), this.config, this.reflectionPolicy);
  }

  session(sessionId: string): ScopedMemory {
    const scope: Scope = { kind: 'session', sessionId };
    return new LocalScopedMemory(scope, filtersFromScope(scope), this.config, this.reflectionPolicy);
  }

  agent(agentId: string): ScopedMemory {
    const scope: Scope = { kind: 'agent', agentId };
    return new LocalScopedMemory(scope, filtersFromScope(scope), this.config, this.reflectionPolicy);
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
}

async function probeEmbedder(embedder: Embedder): Promise<void> {
  const vector = await embedder.embed(PROBE_TEXT);
  if (vector.length !== MAX_EMBEDDING_DIM) {
    throw new EmbeddingMismatch({ expected: MAX_EMBEDDING_DIM, actual: vector.length });
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
