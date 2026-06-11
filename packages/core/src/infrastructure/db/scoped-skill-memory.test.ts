/**
 * T4.1 RED tests for `LocalScopedSkillMemory` + `LocalMemory.skills(repoId)`.
 *
 * Covers the 4 verbs (add/recall/consolidate/forget) + scope isolation
 * between distinct `repoId` values + empty-repoId rejection per plan TDD.
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T4.1
 */
import { describe, expect, test } from 'vitest';

import { hashFact } from '../../domain/dedup.js';
import type { HistoryBatchRecord, HistoryManager } from '../../domain/dip/history-manager.js';
import type { HistoryEntry } from '../../domain/history-entry.js';
import type { Message } from '../../domain/dip/llm.js';
import { InvalidScope, InvalidSkillError, MemoryNotFound } from '../../domain/errors.js';
import { createLocalMemory, StubEmbedder, StubLLM } from './index.js';
import { InMemoryVectorStore } from './in-memory-store.js';

class InMemoryHistoryManager implements HistoryManager {
  private readonly entries = new Map<string, HistoryEntry[]>();

  async addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: 'remember' | 'forget' | 'reflect',
    createdAt?: Date,
  ): Promise<void> {
    await Promise.resolve();
    const bucket = this.entries.get(memoryId) ?? [];
    bucket.push({
      action,
      at: createdAt ?? new Date(),
      previousValue,
      newValue,
    });
    this.entries.set(memoryId, bucket);
  }

  async getHistory(memoryId: string): Promise<readonly HistoryEntry[]> {
    await Promise.resolve();
    const bucket: readonly HistoryEntry[] = this.entries.get(memoryId) ?? [];
    return bucket;
  }

  async reset(): Promise<void> {
    await Promise.resolve();
    this.entries.clear();
  }

  close(): void {
    // no-op
  }

  async saveMessages(_messages: readonly Message[], _sessionScope: string): Promise<void> {
    await Promise.resolve();
  }

  async getLastMessages(): Promise<readonly (Message & { readonly createdAt: Date })[]> {
    await Promise.resolve();
    return [];
  }

  async batchAddHistory(_records: readonly HistoryBatchRecord[]): Promise<void> {
    await Promise.resolve();
  }
}

const DIM = 1536;
const SCOPED_VECTOR = (() => {
  const v = new Array<number>(DIM).fill(0);
  v[0] = 1;
  return v;
})();

class FixedEmbedder extends StubEmbedder {
  override async embed(text: string): Promise<readonly number[]> {
    // Deterministic non-zero embedding so recall + dedup hash work.
    await Promise.resolve();
    const hash = (text.length + text.charCodeAt(0)) % DIM;
    const v = new Array<number>(DIM).fill(0);
    v[hash] = 1;
    return v;
  }
  override async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

async function buildMemory(): Promise<{
  memory: Awaited<ReturnType<typeof createLocalMemory>>;
  store: InMemoryVectorStore;
}> {
  const store = new InMemoryVectorStore();
  const memory = await createLocalMemory({
    vectorStore: store,
    embedder: new FixedEmbedder(),
    llm: new StubLLM(),
  });
  return { memory, store };
}

describe('LocalMemory.skills(repoId) — T4.1', () => {
  test('returns a ScopedSkillMemory bound to the repoId', async () => {
    const { memory } = await buildMemory();
    const scoped = memory.skills('repo-alpha');
    expect(typeof scoped.add).toBe('function');
    expect(typeof scoped.recall).toBe('function');
    expect(typeof scoped.consolidate).toBe('function');
    expect(typeof scoped.forget).toBe('function');
  });

  test('rejects empty repoId with InvalidScope error', async () => {
    const { memory } = await buildMemory();
    expect(() => memory.skills('')).toThrow(InvalidScope);
  });
});

describe('LocalScopedSkillMemory.add — T4.1', () => {
  test('persists a kind=\'skill\' row returning a Skill with valid id', async () => {
    const { memory } = await buildMemory();
    const scoped = memory.skills('repo-alpha');
    const skill = await scoped.add({
      code: 'export const retry = async () => {};',
      description: 'retry helper with backoff',
      codeLanguage: 'typescript',
    });
    expect(typeof skill.id).toBe('string');
    expect(skill.id.length).toBeGreaterThan(0);
    expect(skill.kind).toBe('skill');
    expect(skill.code).toContain('retry');
    expect(skill.description).toContain('backoff');
    expect(skill.codeLanguage).toBe('typescript');
    expect(skill.derivedFrom).toEqual([]);
    expect(skill.supersededBy).toBeNull();
  });

  test('empty description rejects with InvalidSkillError (reason="empty-description"), NOT EmptyScopeError — F2 absorption', async () => {
    const { memory } = await buildMemory();
    const scoped = memory.skills('repo-alpha');
    await expect(
      scoped.add({
        code: 'x',
        description: '   ',
        codeLanguage: 'typescript',
      }),
    ).rejects.toBeInstanceOf(InvalidSkillError);
    try {
      await scoped.add({ code: 'x', description: '', codeLanguage: 'typescript' });
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSkillError);
      expect((err as InvalidSkillError).reason).toBe('empty-description');
    }
  });

  test('hash is hashFact(description) — content-derived per architecture.md § 4 (T1.2 / F7)', async () => {
    const { memory } = await buildMemory();
    const scoped = memory.skills('repo-alpha');
    const added = await scoped.add({
      code: 'export const x = 1;',
      description: 'feature flag toggle',
      codeLanguage: 'typescript',
    });
    expect(added.hash).toBe(hashFact('feature flag toggle'));
  });
});

describe('LocalScopedSkillMemory.recall — T4.1', () => {
  test('returns the most-similar skill scoped to the given repoId', async () => {
    const { memory } = await buildMemory();
    const scoped = memory.skills('repo-alpha');
    const added = await scoped.add({
      code: 'code-alpha',
      description: 'payment retry strategy',
      codeLanguage: 'typescript',
    });
    const results = await scoped.recall('payment retry strategy');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe(added.id);
    expect(results[0]?.kind).toBe('skill');
  });

  test('isolates skills across distinct repoId values', async () => {
    const { memory } = await buildMemory();
    const alpha = memory.skills('repo-alpha');
    const beta = memory.skills('repo-beta');
    await alpha.add({
      code: 'code-alpha',
      description: 'payment retry strategy',
      codeLanguage: 'typescript',
    });
    const fromBeta = await beta.recall('payment retry strategy');
    expect(fromBeta).toEqual([]);
  });
});

describe('LocalScopedSkillMemory.forget — T4.1', () => {
  test('removes the skill so subsequent recall does not return it', async () => {
    const { memory } = await buildMemory();
    const scoped = memory.skills('repo-alpha');
    const added = await scoped.add({
      code: 'code-x',
      description: 'feature flag toggle helper',
      codeLanguage: 'typescript',
    });
    await scoped.forget(added.id);
    const after = await scoped.recall('feature flag toggle helper');
    expect(after.map((s) => s.id)).not.toContain(added.id);
  });

  test('appends a forget history event when historyManager is wired (F10)', async () => {
    const store = new InMemoryVectorStore();
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: new FixedEmbedder(),
      llm: new StubLLM(),
      historyManager: new InMemoryHistoryManager(),
    });
    const scoped = memory.skills('repo-alpha');
    const added = await scoped.add({
      code: 'export const x = 1;',
      description: 'feature flag toggle helper for forget history',
      codeLanguage: 'typescript',
    });

    await scoped.forget(added.id);

    const trail = await memory.history(added.id);
    expect(trail.some((e) => e.action === 'forget')).toBe(true);
  });

  test('rejects cross-scope forget with MemoryNotFound; victim row stays recallable (v1.1 EC-2)', async () => {
    const { memory } = await buildMemory();
    const repoA = memory.skills('repo-alpha');
    const repoB = memory.skills('repo-beta');
    const skillA = await repoA.add({
      code: 'code-alpha',
      description: 'alpha-only payment retry strategy',
      codeLanguage: 'typescript',
    });

    await expect(repoB.forget(skillA.id)).rejects.toBeInstanceOf(MemoryNotFound);

    const stillThere = await repoA.recall('alpha-only payment retry strategy');
    expect(stillThere.map((s) => s.id)).toContain(skillA.id);
  });

  test('rejects forget on a non-skill memory id with MemoryNotFound (v1.1 EC-2 kind mismatch)', async () => {
    const { memory } = await buildMemory();
    const userMems = await memory
      .user('alice')
      .remember('plain user fact about coffee preference', { infer: false });
    const userMemId = userMems[0]?.id;
    expect(typeof userMemId).toBe('string');

    await expect(
      memory.skills('repo-alpha').forget(userMemId as string),
    ).rejects.toBeInstanceOf(MemoryNotFound);
  });
});
