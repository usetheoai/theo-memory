/**
 * T4.1 RED tests for `LocalScopedSkillMemory` + `LocalMemory.skills(repoId)`.
 *
 * Covers the 4 verbs (add/recall/consolidate/forget) + scope isolation
 * between distinct `repoId` values + empty-repoId rejection per plan TDD.
 *
 */
import { describe, expect, test } from 'vitest';

import { hashFact } from '../../domain/dedup.js';
import type { HistoryBatchRecord, HistoryManager } from '../../domain/dip/history-manager.js';
import type { Message } from '../../domain/dip/llm.js';
import type { SkillExecutor, SkillExecutionResult } from '../../domain/dip/skill-executor.js';
import {
  InvalidScope,
  InvalidSkillError,
  MemoryNotFound,
  SkillAlreadyExists,
  SkillExecutionNotConfiguredError,
} from '../../domain/errors.js';
import type { HistoryEntry } from '../../domain/history-entry.js';
import type { Skill } from '../../domain/skill.js';

import { InMemoryVectorStore } from './in-memory-store.js';
import { LocalScopedSkillMemory, type LocalScopedSkillMemoryDeps } from './scoped-skill-memory.js';

import { createLocalMemory, StubEmbedder, StubLLM } from './index.js';


class InMemoryHistoryManager implements HistoryManager {
  private readonly entries = new Map<string, HistoryEntry[]>();

  async addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: 'remember' | 'forget' | 'reflect' | 'supersede',
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

describe('LocalScopedSkillMemory.getAll — dashboard-phase2b-skills-browse T1.1', () => {
  test('returns the repo head-of-chain skills (add round-trips with hash+description+code)', async () => {
    const { memory } = await buildMemory();
    const scoped = memory.skills('repo-alpha');
    const a = await scoped.add({
      code: 'kubectl rollout restart',
      description: 'restart a deployment',
      codeLanguage: 'typescript',
    });
    const b = await scoped.add({
      code: 'terraform apply -auto-approve',
      description: 'apply infra changes',
      codeLanguage: 'typescript',
    });

    const all = await scoped.getAll();

    const ids = all.map((s) => s.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    const restart = all.find((s) => s.id === a.id);
    expect(restart?.hash).toBe(a.hash);
    expect(restart?.description).toBe('restart a deployment');
    expect(restart?.code).toBe('kubectl rollout restart');
    expect(restart?.codeLanguage).toBe('typescript');
    expect(restart?.kind).toBe('skill');
  });

  test('returns [] for a repo with no skills (never null/throw)', async () => {
    const { memory } = await buildMemory();
    const all = await memory.skills('empty-repo').getAll();
    expect(all).toEqual([]);
  });

  test('excludes superseded skills by default; includeSuperseded:true includes them', async () => {
    const { memory, store } = await buildMemory();
    const scoped = memory.skills('repo-alpha');
    const head = await scoped.add({
      code: 'new',
      description: 'deploy strategy head',
      codeLanguage: 'typescript',
    });
    const old = await scoped.add({
      code: 'old',
      description: 'deploy strategy old',
      codeLanguage: 'typescript',
    });
    // Mark `old` as superseded by `head` (parity with consolidate()).
    await store.markSuperseded([old.id], head.id);

    const headOnly = await scoped.getAll();
    expect(headOnly.map((s) => s.id)).toContain(head.id);
    expect(headOnly.map((s) => s.id)).not.toContain(old.id);

    const withSuperseded = await scoped.getAll({ includeSuperseded: true });
    expect(withSuperseded.map((s) => s.id)).toContain(old.id);
  });

  test('is scope-isolated — repoA.getAll() never returns a repoB skill', async () => {
    const { memory } = await buildMemory();
    const alpha = memory.skills('repo-alpha');
    const beta = memory.skills('repo-beta');
    const alphaSkill = await alpha.add({
      code: 'a',
      description: 'alpha-only skill',
      codeLanguage: 'typescript',
    });
    await beta.add({ code: 'b', description: 'beta-only skill', codeLanguage: 'typescript' });

    const fromAlpha = await alpha.getAll();
    expect(fromAlpha.map((s) => s.id)).toEqual([alphaSkill.id]);
  });
});

describe('LocalScopedSkillMemory.add — collision mapping (skills-write-surface T1.1)', () => {
  // Build a LocalScopedSkillMemory directly with a stub store whose insertSkill
  // throws, to exercise the D1 / EC-W1 catch (the in-memory store does not
  // enforce UNIQUE(hash); the real collision is proven in integration T2.4).
  function buildScopedSkill(insertSkill: () => Promise<string>) {
    return new LocalScopedSkillMemory('repo-alpha', {
      vectorStore: {
        insertSkill,
        // unused by add(); present for the deps type
      } as unknown as LocalScopedSkillMemoryDeps['vectorStore'],
      embedder: new FixedEmbedder(),
      llm: new StubLLM(),
      forgetDelegate: async () => undefined,
      getDelegate: async () => null,
    });
  }

  test('maps a Postgres unique-violation (code 23505) on the hash index to SkillAlreadyExists', async () => {
    const scoped = buildScopedSkill(async () => {
      await Promise.resolve();
      throw Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'memories_hash_scope_unique_idx',
      });
    });
    await expect(
      scoped.add({ code: 'x', description: 'collides', codeLanguage: 'typescript' }),
    ).rejects.toBeInstanceOf(SkillAlreadyExists);
  });

  test('re-throws a non-unique-violation store error unchanged (no masking)', async () => {
    const boom = Object.assign(new Error('connection reset'), { code: '08006' });
    const scoped = buildScopedSkill(async () => {
      await Promise.resolve();
      throw boom;
    });
    await expect(
      scoped.add({ code: 'x', description: 'whatever', codeLanguage: 'typescript' }),
    ).rejects.toBe(boom);
  });
})

describe('LocalScopedSkillMemory.forget — cross-workspace guard (skills-write-surface /review HIGH)', () => {
  function buildForgetScoped(deps: {
    workspaceId?: string;
    row: { metadata: Record<string, unknown> } | null;
  }) {
    let forgetCalled = false;
    const scoped = new LocalScopedSkillMemory('repo-alpha', {
      vectorStore: {} as unknown as LocalScopedSkillMemoryDeps['vectorStore'],
      embedder: new FixedEmbedder(),
      llm: new StubLLM(),
      ...(deps.workspaceId !== undefined ? { workspaceId: deps.workspaceId } : {}),
      forgetDelegate: async () => {
        forgetCalled = true;
        await Promise.resolve();
      },
      getDelegate: async () => {
        await Promise.resolve();
        return deps.row as never;
      },
    });
    return { scoped, didForget: () => forgetCalled };
  }

  test('rejects a skill in ANOTHER workspace with MemoryNotFound (no forgetDelegate call)', async () => {
    const { scoped, didForget } = buildForgetScoped({
      workspaceId: 'ws-B',
      row: { metadata: { kind: 'skill', agent_id: 'repo-alpha', workspace_id: 'ws-A' } },
    });
    await expect(scoped.forget('sk-1')).rejects.toBeInstanceOf(MemoryNotFound);
    expect(didForget()).toBe(false);
  });

  test('allows forget when workspace + agent_id + kind all match', async () => {
    const { scoped, didForget } = buildForgetScoped({
      workspaceId: 'ws-A',
      row: { metadata: { kind: 'skill', agent_id: 'repo-alpha', workspace_id: 'ws-A' } },
    });
    await scoped.forget('sk-1');
    expect(didForget()).toBe(true);
  });

  test('default workspace: a row with no workspace_id matches the default-bound scope', async () => {
    const { scoped, didForget } = buildForgetScoped({
      row: { metadata: { kind: 'skill', agent_id: 'repo-alpha' } }, // no workspace_id => 'default'
    });
    await scoped.forget('sk-1');
    expect(didForget()).toBe(true);
  });
});

describe('LocalScopedSkillMemory.execute — T2.1 (opt-in/gated wiring)', () => {
  function recordingExecutor(): { executor: SkillExecutor; received(): { skill: Skill; args: unknown } | null } {
    let captured: { skill: Skill; args: unknown } | null = null;
    return {
      executor: {
        async execute(skill, args): Promise<SkillExecutionResult> {
          await Promise.resolve();
          captured = { skill, args };
          return { output: 42, truncated: false, elapsedMs: 1 };
        },
      },
      received: () => captured,
    };
  }

  test('test_execute_throws_not_configured_when_none (STORE-only default)', async () => {
    const scoped = new LocalScopedSkillMemory('repo-alpha', {
      vectorStore: new InMemoryVectorStore(),
      embedder: new FixedEmbedder(),
      llm: new StubLLM(),
      forgetDelegate: async () => undefined,
      getDelegate: async () => null,
    });
    await expect(scoped.execute('any-id', {})).rejects.toBeInstanceOf(SkillExecutionNotConfiguredError);
  });

  test('test_execute_delegates_to_injected_executor (skill carries code)', async () => {
    const rec = recordingExecutor();
    const scoped = new LocalScopedSkillMemory('repo-alpha', {
      vectorStore: new InMemoryVectorStore(),
      embedder: new FixedEmbedder(),
      llm: new StubLLM(),
      forgetDelegate: async () => undefined,
      getDelegate: async () => null,
      skillExecutor: rec.executor,
    });
    const added = await scoped.add({
      code: 'export function f(x) { return x; }',
      description: 'identity skill',
      codeLanguage: 'javascript',
    });
    const result = await scoped.execute(added.id, { x: 7 });
    expect(result.output).toBe(42);
    const got = rec.received();
    expect(got?.skill.id).toBe(added.id);
    expect(got?.skill.code).toBe('export function f(x) { return x; }');
    expect(got?.args).toEqual({ x: 7 });
  });

  test('test_execute_throws_memory_not_found_on_foreign_id (404, no existence leak)', async () => {
    const rec = recordingExecutor();
    const scoped = new LocalScopedSkillMemory('repo-alpha', {
      vectorStore: new InMemoryVectorStore(),
      embedder: new FixedEmbedder(),
      llm: new StubLLM(),
      forgetDelegate: async () => undefined,
      getDelegate: async () => null,
      skillExecutor: rec.executor,
    });
    await expect(scoped.execute('nonexistent-id', {})).rejects.toBeInstanceOf(MemoryNotFound);
    expect(rec.received()).toBeNull();
  });
});

describe('LocalScopedSkillMemory.execute — cross-scope isolation (T2.1 IDOR)', () => {
  test('test_execute_cross_repo_id_throws_memory_not_found', async () => {
    // A skill added under repo-alpha must NOT be executable from repo-beta — the
    // agent_id (RepoScope) filter inherited via getAll/this.filters yields
    // MemoryNotFound (404, no existence leak); the executor is never reached.
    // Cross-WORKSPACE isolation for skills is verified at T3.1 against real
    // pgvector: the in-memory adapter's insertSkill does not persist workspace_id
    // (followup themory-inmemory-skill-workspace-parity).
    const store = new InMemoryVectorStore();
    let called = false;
    const executor: SkillExecutor = {
      async execute(): Promise<SkillExecutionResult> {
        await Promise.resolve();
        called = true;
        return { output: 1, truncated: false, elapsedMs: 1 };
      },
    };
    const mkScoped = (repoId: string): LocalScopedSkillMemory =>
      new LocalScopedSkillMemory(repoId, {
        vectorStore: store,
        embedder: new FixedEmbedder(),
        llm: new StubLLM(),
        forgetDelegate: async () => undefined,
        getDelegate: async () => null,
        skillExecutor: executor,
      });
    const alpha = mkScoped('repo-alpha');
    const beta = mkScoped('repo-beta');
    const added = await alpha.add({
      code: 'export function f() { return 1; }',
      description: 'alpha private skill',
      codeLanguage: 'javascript',
    });
    await expect(beta.execute(added.id, {})).rejects.toBeInstanceOf(MemoryNotFound);
    expect(called).toBe(false);
    // sanity: repo-alpha CAN execute its own skill
    const ok = await alpha.execute(added.id, {});
    expect(ok.output).toBe(1);
  });
});

describe('createLocalMemory({ skillExecutor }) — T2.2 factory gated wiring', () => {
  test('test_factory_optin_skill_executor_reaches_execute', async () => {
    let seen: { code: string | null } | null = null;
    const executor: SkillExecutor = {
      async execute(skill): Promise<SkillExecutionResult> {
        await Promise.resolve();
        seen = { code: skill.code };
        return { output: 99, truncated: false, elapsedMs: 1 };
      },
    };
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: new FixedEmbedder(),
      llm: new StubLLM(),
      skillExecutor: executor,
    });
    const scoped = memory.skills('repo-alpha');
    const added = await scoped.add({
      code: 'export function g() { return 99; }',
      description: 'factory-wired skill',
      codeLanguage: 'javascript',
    });
    const result = await scoped.execute(added.id, {});
    expect(result.output).toBe(99);
    expect(seen).toEqual({ code: 'export function g() { return 99; }' });
  });

  test('test_factory_default_off_execute_throws_not_configured', async () => {
    const { memory } = await buildMemory(); // no skillExecutor wired
    const scoped = memory.skills('repo-alpha');
    await expect(scoped.execute('any-id', {})).rejects.toBeInstanceOf(SkillExecutionNotConfiguredError);
  });
});

describe('LocalMemory.listSkillsBySubject — cross-repo flat list (skills-cross-repo-flat-list)', () => {
  async function seedThreeRepos(): Promise<Awaited<ReturnType<typeof buildMemory>>['memory']> {
    const { memory } = await buildMemory();
    // Gateway namespaces repo as `{subject}:{repoId}` → agent_id.
    await memory.skills('alice:repo-a').add({ code: 'a1', description: 'alpha one parser', codeLanguage: 'typescript' });
    await memory.skills('alice:repo-a').add({ code: 'a2', description: 'alpha two writer', codeLanguage: 'typescript' });
    await memory.skills('alice:repo-b').add({ code: 'b1', description: 'beta csv loader', codeLanguage: 'typescript' });
    await memory.skills('bob:repo-c').add({ code: 'c1', description: 'gamma retry helper', codeLanguage: 'typescript' });
    return memory;
  }

  test('lists exactly the subject skills across repos with correct repoId, isolating other tenants', async () => {
    const memory = await seedThreeRepos();
    const page = await memory.listSkillsBySubject('alice');
    expect(page.total).toBe(3);
    expect(page.skills.length).toBe(3);
    const repoIds = new Set(page.skills.map((s) => s.repoId));
    expect(repoIds).toEqual(new Set(['repo-a', 'repo-b']));
    // none of bob's skills leak (descriptions / repoIds)
    expect(page.skills.some((s) => s.description.includes('gamma'))).toBe(false);
    // every result is a head-of-chain skill with the kind discriminator
    expect(page.skills.every((s) => s.kind === 'skill')).toBe(true);
  });

  test('a strict-prefix subject does not leak (the ":" delimiter prevents overlap)', async () => {
    const memory = await seedThreeRepos();
    await memory.skills('al:repo-x').add({ code: 'x', description: 'short prefix skill', codeLanguage: 'typescript' });
    const page = await memory.listSkillsBySubject('al');
    expect(page.total).toBe(1);
    expect(page.skills[0]?.repoId).toBe('repo-x');
    // alice's skills (alice:...) must NOT appear under subject 'al'
    expect(page.skills.some((s) => s.description.includes('alpha'))).toBe(false);
  });

  test('q filter narrows by description; offset/limit paginate', async () => {
    const memory = await seedThreeRepos();
    const filtered = await memory.listSkillsBySubject('alice', { q: 'csv' });
    expect(filtered.total).toBe(1);
    expect(filtered.skills[0]?.repoId).toBe('repo-b');
    const firstPage = await memory.listSkillsBySubject('alice', { limit: 2, offset: 0 });
    expect(firstPage.skills.length).toBe(2);
    expect(firstPage.total).toBe(3);
    const secondPage = await memory.listSkillsBySubject('alice', { limit: 2, offset: 2 });
    expect(secondPage.skills.length).toBe(1);
    expect(secondPage.total).toBe(3);
  });

  test('empty subject scope returns [] with total 0', async () => {
    const memory = await seedThreeRepos();
    const page = await memory.listSkillsBySubject('nobody');
    expect(page).toEqual({ skills: [], total: 0 });
  });

  test('rejects a subject containing ":" or empty with InvalidScope', async () => {
    const { memory } = await buildMemory();
    await expect(memory.listSkillsBySubject('a:b')).rejects.toBeInstanceOf(InvalidScope);
    await expect(memory.listSkillsBySubject('')).rejects.toBeInstanceOf(InvalidScope);
  });
});
