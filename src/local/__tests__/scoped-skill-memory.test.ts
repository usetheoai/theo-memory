/**
 * T4.1 RED tests for `LocalScopedSkillMemory` + `LocalMemory.skills(repoId)`.
 *
 * Covers the 4 verbs (add/recall/consolidate/forget) + scope isolation
 * between distinct `repoId` values + empty-repoId rejection per plan TDD.
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T4.1
 */
import { describe, expect, test } from 'vitest';

import { InvalidScope, InvalidSkillError } from '../../core/errors.js';
import { createLocalMemory, StubEmbedder, StubLLM } from '../index.js';
import { InMemoryVectorStore } from '../in-memory-store.js';

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
  test('persists a kind=\'skill\' row and returns a Skill with valid id', async () => {
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
});
