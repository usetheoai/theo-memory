import { expectTypeOf, test } from 'vitest';

import type { Embedder } from './dip/embedder.js';
import type { HistoryManager } from './dip/history-manager.js';
import type { LLM } from './dip/llm.js';
import type { ReflectionPolicy } from './dip/reflection-policy.js';
import type { VectorStore } from './dip/vector-store.js';
import type { EpisodeListOptions, EpisodePage } from './episode.js';
import type { HistoryEntry } from './history-entry.js';
import type { MemoryItem, MemoryItemWithScore } from './memory-item.js';
import type {
  CloudMemoryConfig,
  Memory,
  MemoryConfig,
  MemoryStore,
  ScopedMemory,
} from './memory-store.js';
import type { ForgetOptions, GetAllOptions, RecallOptions, ReflectOptions, RememberOptions } from './options.js';
import type { ReflectionResult } from './reflection-result.js';
import type { Scope } from './scope.js';

test('Memory.user/.session/.agent each return a ScopedMemory', () => {
  expectTypeOf<Memory['user']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<Memory['user']>().returns.toEqualTypeOf<ScopedMemory>();
  expectTypeOf<Memory['session']>().returns.toEqualTypeOf<ScopedMemory>();
  expectTypeOf<Memory['agent']>().returns.toEqualTypeOf<ScopedMemory>();
});

test('Memory top-level surface has forget + get + history + reset (parity helpers)', () => {
  expectTypeOf<Memory['forget']>().parameters.toEqualTypeOf<[string, ForgetOptions?]>();
  expectTypeOf<Memory['forget']>().returns.resolves.toEqualTypeOf<void>();
  expectTypeOf<Memory['get']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<Memory['get']>().returns.resolves.toEqualTypeOf<MemoryItem | null>();
  expectTypeOf<Memory['history']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<Memory['history']>().returns.resolves.toEqualTypeOf<readonly HistoryEntry[]>();
  expectTypeOf<Memory['reset']>().parameters.toEqualTypeOf<[Scope]>();
  expectTypeOf<Memory['reset']>().returns.resolves.toEqualTypeOf<void>();
});

test('Memory has exactly the 11 top-level keys (v0.4a flushReflections; v0.6 skills; workspace-isolation withWorkspace; skills-cross-repo-flat-list listSkillsBySubject)', () => {
  type Keys = keyof Memory;
  expectTypeOf<Keys>().toEqualTypeOf<
    | 'user'
    | 'session'
    | 'agent'
    | 'skills'
    | 'listSkillsBySubject'
    | 'forget'
    | 'get'
    | 'history'
    | 'reset'
    | 'flushReflections'
    | 'withWorkspace'
  >();
});

test('ScopedMemory has the scoped verbs + episodes + count + listSessions read surfaces (#113; session-separation 2026-07-23)', () => {
  type Keys = keyof ScopedMemory;
  expectTypeOf<Keys>().toEqualTypeOf<
    'remember' | 'rememberMessages' | 'recall' | 'reflect' | 'getAll' | 'forget' | 'episodes' | 'count' | 'listSessions' | 'searchMessages'
  >();
});

test('ScopedMemory.episodes returns Promise<EpisodePage> (first-class-episodes M2 T1.2)', () => {
  expectTypeOf<ScopedMemory['episodes']>().parameters.toEqualTypeOf<[EpisodeListOptions?]>();
  expectTypeOf<ScopedMemory['episodes']>().returns.resolves.toEqualTypeOf<EpisodePage>();
});

test('ScopedMemory.remember returns Promise<readonly MemoryItem[]>', () => {
  expectTypeOf<ScopedMemory['remember']>().parameters.toEqualTypeOf<[string, RememberOptions?]>();
  expectTypeOf<ScopedMemory['remember']>().returns.resolves.toEqualTypeOf<readonly MemoryItem[]>();
});

test('ScopedMemory.recall returns Promise<readonly MemoryItemWithScore[]>', () => {
  expectTypeOf<ScopedMemory['recall']>().parameters.toEqualTypeOf<[string, RecallOptions?]>();
  expectTypeOf<ScopedMemory['recall']>().returns.resolves.toEqualTypeOf<readonly MemoryItemWithScore[]>();
});

test('ScopedMemory.reflect returns Promise<ReflectionResult>', () => {
  expectTypeOf<ScopedMemory['reflect']>().parameters.toEqualTypeOf<[ReflectOptions?]>();
  expectTypeOf<ScopedMemory['reflect']>().returns.resolves.toEqualTypeOf<ReflectionResult>();
});

test('ScopedMemory.getAll returns Promise<readonly MemoryItem[]>', () => {
  expectTypeOf<ScopedMemory['getAll']>().parameters.toEqualTypeOf<[GetAllOptions?]>();
  expectTypeOf<ScopedMemory['getAll']>().returns.resolves.toEqualTypeOf<readonly MemoryItem[]>();
});

test('Memory does NOT expose update at the type level (ADR-0003 invariant)', () => {
  // @ts-expect-error — no update method on Memory (ADD-only)
  type _ = Memory['update'];
});

test('ScopedMemory.forget is the subject-scoped delete (themory-scoped-forget T1.1, ADR D1)', () => {
  expectTypeOf<ScopedMemory['forget']>().parameters.toEqualTypeOf<[string, ForgetOptions?]>();
  expectTypeOf<ScopedMemory['forget']>().returns.resolves.toEqualTypeOf<void>();
});

test('MemoryStore underlying primitive surface (8 methods adapters implement)', () => {
  type Keys = keyof MemoryStore;
  expectTypeOf<Keys>().toEqualTypeOf<
    | 'remember'
    | 'recall'
    | 'forget'
    | 'reflect'
    | 'get'
    | 'getAll'
    | 'history'
    | 'reset'
  >();
});

test('MemoryStore.remember takes (text, scope, options?) — explicit scope', () => {
  expectTypeOf<MemoryStore['remember']>().parameters.toEqualTypeOf<
    [string, Scope, RememberOptions?]
  >();
  expectTypeOf<MemoryStore['remember']>().returns.resolves.toEqualTypeOf<readonly MemoryItem[]>();
});

test('MemoryStore.recall takes (query, scope, options?) — explicit scope', () => {
  expectTypeOf<MemoryStore['recall']>().parameters.toEqualTypeOf<
    [string, Scope, RecallOptions?]
  >();
  expectTypeOf<MemoryStore['recall']>().returns.resolves.toEqualTypeOf<readonly MemoryItemWithScore[]>();
});

test('MemoryConfig requires embedder + llm + vectorStore (T2.5 EC-1 absorption)', () => {
  expectTypeOf<MemoryConfig['embedder']>().toEqualTypeOf<Embedder>();
  expectTypeOf<MemoryConfig['llm']>().toEqualTypeOf<LLM>();
  expectTypeOf<MemoryConfig['vectorStore']>().toEqualTypeOf<VectorStore>();
});

test('MemoryConfig optional fields: historyManager, reflectionPolicy, entityBoost, customInstructions', () => {
  expectTypeOf<MemoryConfig['historyManager']>().toEqualTypeOf<HistoryManager | undefined>();
  expectTypeOf<MemoryConfig['reflectionPolicy']>().toEqualTypeOf<ReflectionPolicy | undefined>();
  expectTypeOf<MemoryConfig['entityBoost']>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<MemoryConfig['customInstructions']>().toEqualTypeOf<string | undefined>();
});

test('CloudMemoryConfig extends MemoryConfig + adds optional apiKey + baseUrl (D9 + EC-1)', () => {
  expectTypeOf<CloudMemoryConfig>().toMatchTypeOf<MemoryConfig>();
  expectTypeOf<CloudMemoryConfig['apiKey']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<CloudMemoryConfig['baseUrl']>().toEqualTypeOf<string | undefined>();
});

test('CloudMemoryConfig with no apiKey compiles (falls back to THEOKIT_API_KEY env var per ADR-0009)', () => {
  interface MinimalCloud {
    readonly embedder: Embedder;
    readonly llm: LLM;
    readonly vectorStore: VectorStore;
  }
  // The 3 required-deps shape is assignable to CloudMemoryConfig — apiKey is optional
  expectTypeOf<MinimalCloud>().toMatchTypeOf<CloudMemoryConfig>();
});
