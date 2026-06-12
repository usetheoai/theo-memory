
// Import via the package preview path (resolves through tsconfig paths map)
import type {
  AgentScope,
  CloudMemoryConfig,
  Embedder,
  Filters,
  ForgetOptions,
  GetAllOptions,
  HistoryBatchRecord,
  HistoryEntry,
  HistoryManager,
  LLM,
  LLMResponse,
  ManualReflectionPolicy,
  Memory,
  MemoryConfig,
  MemoryItem,
  MemoryItemWithScore,
  MemoryStore,
  Message,
  RecallOptions,
  ReflectOptions,
  ReflectionPolicy,
  ReflectionResult,
  ReflectionTrigger,
  RememberOptions,
  Role,
  Scope,
  ScopedMemory,
  SessionScope,
  UserScope,
  VectorStore,
  VectorStoreResult,
} from '@usetheo/memory/contract';
import type {
  BiTemporalNotSupportedLocally,
  EmbeddingMismatch,
  InvalidScope,
  MemoryNotFound,
  ReflectionNotConfigured,
} from '@usetheo/memory/contract';
import { expectTypeOf, test } from 'vitest';

test('barrel re-exports every Phase 2/3 type via @usetheo/memory/contract', () => {
  // Scope module
  expectTypeOf<Scope>().not.toBeAny();
  expectTypeOf<UserScope>().not.toBeAny();
  expectTypeOf<SessionScope>().not.toBeAny();
  expectTypeOf<AgentScope>().not.toBeAny();
  expectTypeOf<Filters>().not.toBeAny();

  // MemoryItem module
  expectTypeOf<MemoryItem>().not.toBeAny();
  expectTypeOf<MemoryItemWithScore>().not.toBeAny();

  // Options module
  expectTypeOf<RememberOptions>().not.toBeAny();
  expectTypeOf<RecallOptions>().not.toBeAny();
  expectTypeOf<ForgetOptions>().not.toBeAny();
  expectTypeOf<ReflectOptions>().not.toBeAny();
  expectTypeOf<GetAllOptions>().not.toBeAny();

  // Memory-store module (centerpiece)
  expectTypeOf<MemoryStore>().not.toBeAny();
  expectTypeOf<Memory>().not.toBeAny();
  expectTypeOf<ScopedMemory>().not.toBeAny();
  expectTypeOf<MemoryConfig>().not.toBeAny();
  expectTypeOf<CloudMemoryConfig>().not.toBeAny();

  // History + Reflection result modules
  expectTypeOf<HistoryEntry>().not.toBeAny();
  expectTypeOf<ReflectionResult>().not.toBeAny();

  // Message module
  expectTypeOf<Role>().not.toBeAny();
  expectTypeOf<Message>().not.toBeAny();
  expectTypeOf<LLMResponse>().not.toBeAny();

  // DIPs
  expectTypeOf<Embedder>().not.toBeAny();
  expectTypeOf<LLM>().not.toBeAny();
  expectTypeOf<VectorStore>().not.toBeAny();
  expectTypeOf<VectorStoreResult>().not.toBeAny();
  expectTypeOf<HistoryManager>().not.toBeAny();
  expectTypeOf<HistoryBatchRecord>().not.toBeAny();
  expectTypeOf<ReflectionPolicy>().not.toBeAny();
  expectTypeOf<ReflectionTrigger>().not.toBeAny();
  expectTypeOf<ManualReflectionPolicy>().not.toBeAny();
});

test('error classes re-export via barrel are Error subtypes (instance check via type)', () => {
  expectTypeOf<MemoryNotFound>().toMatchTypeOf<Error>();
  expectTypeOf<InvalidScope>().toMatchTypeOf<Error>();
  expectTypeOf<EmbeddingMismatch>().toMatchTypeOf<Error>();
  expectTypeOf<BiTemporalNotSupportedLocally>().toMatchTypeOf<Error>();
  expectTypeOf<ReflectionNotConfigured>().toMatchTypeOf<Error>();
});

type CreateMemoryFactory = (config: MemoryConfig) => Memory;

test('Memory consumed end-to-end via the package path (cross-module integrity)', () => {
  // Synthetic consumer signature for what v0.1+ ships as createMemory(config): Memory
  type ConsumerFlow = (factory: CreateMemoryFactory) => Promise<readonly MemoryItem[]>;
  const _flow: ConsumerFlow = async (factory) => {
    const config: MemoryConfig = {
      embedder: {} as Embedder,
      llm: {} as LLM,
      vectorStore: {} as VectorStore,
    };
    const memory = factory(config);
    return memory.user('alice').remember('text');
  };
  expectTypeOf(_flow).toBeFunction();
});
