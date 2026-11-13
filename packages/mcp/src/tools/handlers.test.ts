/**
 * Tool dispatch handlers tests — T5.1.
 *
 * Wires T2.1 schemas + T2.2 tools/list + T3.1 scope + T4.1 classifier with
 * v0.1 Memory contract. Tests cover happy paths + scope rejection + invalid args
 * + unknown tool + memory error propagation + EC-6 empty-recall shape + EC-14
 * forget unknown-id idempotency + SEPA-flagged ScopedMemory forget gotcha +
 * recall createdAt Date → ISO string wire mapping.
 *
 * @see ADR D2 — 4 separate tools (no action collapsing)
 * @see ADR D3 — scope binding via AsyncLocalStorage
 * @see ADR D4 — reuse memoryFromCtx
 * @see ADR D6 — TWO error mechanisms (Protocol vs Execution)
 * @see EC-6 — empty-recall content shape lock
 * @see EC-14 (SHOULD TEST inline) — forget unknown-id idempotent at agent boundary
 */
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { MemoryNotFound, MemoryStoreError, MissingScopeError } from '@usetheo/memory/contract';
import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import type { MemoryItem, MemoryItemWithScore } from '@usetheo/memory/contract';
import { withScope, getScope } from '@usetheo/memory-agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { dispatch } from './dispatch.js';
import { OUTPUT_SCHEMA } from './recall-schema.js';

const FIXED_DATE = new Date('2026-05-24T12:00:00.000Z');
const ALICE_CTX = { session: { userId: 'alice' } } as const;

function mockScopedMemory(): ScopedMemory {
  return mock<ScopedMemory>();
}

function mockMemory(scoped: ScopedMemory): Memory {
  const memory = mock<Memory>();
  vi.mocked(memory.user).mockReturnValue(scoped);
  return memory;
}

describe('dispatch handlers — happy paths (T5.1)', () => {
  it('remember handler persists content under scoped memory', async () => {
    const scoped = mockScopedMemory();
    const persisted: MemoryItem = {
      id: 'uuid-1', text: 'Paulo likes coffee', hash: 'h', scope: { kind: 'user', userId: 'alice' },
      createdAt: FIXED_DATE, updatedAt: FIXED_DATE, metadata: {}, tValid: FIXED_DATE, tInvalid: null,
    };
    vi.mocked(scoped.remember).mockResolvedValue([persisted]);
    const memory = mockMemory(scoped);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('remember', { content: 'Paulo likes coffee' }, { memoryFactory: () => memory }),
    );

    expect(vi.mocked(scoped.remember)).toHaveBeenCalledWith('Paulo likes coffee', undefined);
    expect(result.isError ?? false).toBe(false);
    // Honest disclosure: text MUST reflect actual count + ids (NOT silent "Memory persisted.")
    expect((result.content as { text: string }[])[0]?.text).toMatch(/uuid-1/);
    expect((result.content as { text: string }[])[0]?.text).toMatch(/1/);
  });

  it('remember handler returns isError:true when zero facts extracted (data-loss honesty — #1)', async () => {
    // Reproduces the bug from /tmp/themory-issue.md: LLM fails OR drafts=[] → scoped.remember()
    // returns []. Previous handler silently returned "Memory persisted." with isError:false,
    // making data-loss invisible to MCP callers.
    const scoped = mockScopedMemory();
    vi.mocked(scoped.remember).mockResolvedValue([]);
    const memory = mockMemory(scoped);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('remember', { content: 'Paulo likes coffee' }, { memoryFactory: () => memory }),
    );

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toMatch(/no.*fact|not persisted|not stored/i);
  });

  it('remember handler passes infer:false through to scoped.remember (#2 MCP/REST parity)', async () => {
    // Reproduces issue #2: MCP schema lacked `infer` flag, blocking literal-write use case.
    // With infer:false the LLM extraction pipeline is bypassed; content is stored verbatim.
    const scoped = mockScopedMemory();
    const persisted: MemoryItem = {
      id: 'uuid-literal', text: 'verbatim marker', hash: 'h', scope: { kind: 'user', userId: 'alice' },
      createdAt: FIXED_DATE, updatedAt: FIXED_DATE, metadata: {}, tValid: FIXED_DATE, tInvalid: null,
    };
    vi.mocked(scoped.remember).mockResolvedValue([persisted]);
    const memory = mockMemory(scoped);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('remember', { content: 'verbatim marker', infer: false }, { memoryFactory: () => memory }),
    );

    expect(vi.mocked(scoped.remember)).toHaveBeenCalledWith('verbatim marker', { infer: false });
    expect(result.isError ?? false).toBe(false);
  });

  it('recall handler returns structuredContent with results array', async () => {
    const scoped = mockScopedMemory();
    const hit: MemoryItemWithScore = {
      id: 'uuid-1', text: 'coffee', hash: 'h', scope: { kind: 'user', userId: 'alice' },
      createdAt: FIXED_DATE, updatedAt: FIXED_DATE, metadata: {}, tValid: FIXED_DATE, tInvalid: null, score: 0.87,
    };
    vi.mocked(scoped.recall).mockResolvedValue([hit]);
    const memory = mockMemory(scoped);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('recall', { query: 'coffee' }, { memoryFactory: () => memory }),
    );

    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent).toBeDefined();
    const structured = result.structuredContent as { results: unknown[] };
    expect(structured.results).toHaveLength(1);
  });

  it('recall handler returns when each fact was said, the date of its event and its durability', async () => {
    const scoped = mockScopedMemory();
    const saidAt = new Date('2023-11-01T00:00:00.000Z');
    vi.mocked(scoped.recall).mockResolvedValue([{
      id: 'uuid-1', text: 'user has a dentist appointment (2023-11-06)', hash: 'h', scope: { kind: 'user', userId: 'alice' },
      createdAt: FIXED_DATE, updatedAt: FIXED_DATE, metadata: {}, tValid: saidAt, tInvalid: null, score: 0.5,
      eventTime: { start: '2023-11-06', end: '2023-11-06', granularity: 'day', expression: 'in 5 days' }, durability: 'temporary',
    }]);
    const memory = mockMemory(scoped);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('recall', { query: 'dentist' }, { memoryFactory: () => memory }),
    );

    const [hit] = (result.structuredContent as { results: Record<string, unknown>[] }).results;
    expect(hit).toMatchObject({
      tValid: '2023-11-01T00:00:00.000Z',
      eventTime: { start: '2023-11-06', end: '2023-11-06', granularity: 'day', expression: 'in 5 days' },
      durability: 'temporary',
    });
    expect(OUTPUT_SCHEMA.safeParse(result.structuredContent).success).toBe(true);
  });

  it('recall handler leaves the time fields out of a memory that has none', async () => {
    const scoped = mockScopedMemory();
    vi.mocked(scoped.recall).mockResolvedValue([{
      id: 'uuid-1', text: 't', hash: 'h', scope: { kind: 'user', userId: 'alice' },
      createdAt: FIXED_DATE, updatedAt: FIXED_DATE, metadata: {}, tValid: null, tInvalid: null, score: 0.5,
    }]);
    const memory = mockMemory(scoped);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('recall', { query: 'x' }, { memoryFactory: () => memory }),
    );

    const [hit] = (result.structuredContent as { results: Record<string, unknown>[] }).results;
    expect(Object.keys(hit ?? {}).sort()).toEqual(['createdAt', 'id', 'metadata', 'scope', 'score', 'tValid', 'text']);
    expect(hit?.['tValid']).toBeNull();
  });

  it('recall handler maps createdAt Date to ISO string at wire boundary', async () => {
    const scoped = mockScopedMemory();
    vi.mocked(scoped.recall).mockResolvedValue([{
      id: 'uuid-1', text: 't', hash: 'h', scope: { kind: 'user', userId: 'alice' },
      createdAt: FIXED_DATE, updatedAt: FIXED_DATE, metadata: {}, tValid: FIXED_DATE, tInvalid: null, score: 1,
    }]);
    const memory = mockMemory(scoped);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('recall', { query: 'x' }, { memoryFactory: () => memory }),
    );
    const r = (result.structuredContent as { results: { createdAt: unknown }[] }).results[0];
    expect(typeof r?.createdAt).toBe('string');
    expect(r?.createdAt).toBe('2026-05-24T12:00:00.000Z');
  });

  it('recall handler returns EC-6 empty-recall shape when zero matches', async () => {
    const scoped = mockScopedMemory();
    vi.mocked(scoped.recall).mockResolvedValue([]);
    const memory = mockMemory(scoped);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('recall', { query: 'nothing' }, { memoryFactory: () => memory }),
    );

    expect(result.isError ?? false).toBe(false);
    expect((result.content as { text: string }[])[0]?.text).toBe('No memories matched the query.');
    expect((result.structuredContent as { results: unknown[] }).results).toEqual([]);
  });

  it('forget handler with id calls the SUBJECT-SCOPED ScopedMemory.forget (M14 cross-user IDOR fix)', async () => {
    // The M14 review found the workspace-only Memory.forget was a cross-user delete IDOR;
    // forget now routes through routeScopedMemory → (workspace, user) ScopedMemory.forget so
    // a foreign id is not in scope. The top-level Memory.forget is NO LONGER called.
    const scoped = mockScopedMemory();
    const memory = mockMemory(scoped);
    vi.mocked(scoped.forget).mockResolvedValue(undefined);

    const id = '550e8400-e29b-41d4-a716-446655440000';
    const result = await withScope(ALICE_CTX, () =>
      dispatch('forget', { id }, { memoryFactory: () => memory }),
    );

    expect(vi.mocked(scoped.forget)).toHaveBeenCalledWith(id);
    expect(vi.mocked(memory.forget)).not.toHaveBeenCalled();
    expect(result.isError ?? false).toBe(false);
  });

  it('forget handler with all:true returns "bulk delete deferred to v0.4" Tool Execution Error', async () => {
    const scoped = mockScopedMemory();
    const memory = mockMemory(scoped);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('forget', { all: true }, { memoryFactory: () => memory }),
    );

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toMatch(/v0\.4|bulk delete/i);
    // CRITICAL: Memory.forget MUST NOT be called for all:true (no bulk wipe at v0.3)
    expect(vi.mocked(memory.forget)).not.toHaveBeenCalled();
  });

  it('forget handler with unknown id returns idempotent success (EC-14 absorption)', async () => {
    const scoped = mockScopedMemory();
    const memory = mockMemory(scoped);
    vi.mocked(scoped.forget).mockRejectedValue(
      new MemoryNotFound('memoryId xxx not found in this scope (EC-14)'),
    );

    const result = await withScope(ALICE_CTX, () =>
      dispatch('forget', { id: '550e8400-e29b-41d4-a716-446655440000' }, { memoryFactory: () => memory }),
    );

    // EC-14 contract: forget unknown-id (or foreign-scope id) is idempotent at the boundary
    expect(result.isError ?? false).toBe(false);
    expect((result.content as { text: string }[])[0]?.text).toMatch(/No memory found|already/i);
  });

  it('reflect handler invokes ScopedMemory.reflect', async () => {
    const scoped = mockScopedMemory();
    vi.mocked(scoped.reflect).mockResolvedValue({
      higherOrderMemories: [],
      sourceIds: [],
      derivedMemoriesCreated: 0,
    });
    const memory = mockMemory(scoped);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('reflect', {}, { memoryFactory: () => memory }),
    );

    expect(vi.mocked(scoped.reflect)).toHaveBeenCalled();
    expect(result.isError ?? false).toBe(false);
  });
});

describe('dispatch — error paths (ADR D6)', () => {
  it('dispatch outside withScope returns Tool Execution Error (MissingScopeError → execution)', async () => {
    const scoped = mockScopedMemory();
    const memory = mockMemory(scoped);
    // NOTE: no withScope wrapper — getScope() inside dispatch throws MissingScopeError
    const result = await dispatch('remember', { content: 'foo' }, { memoryFactory: () => memory });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toMatch(/Scope/i);
  });

  it('dispatch with invalid args throws McpError(-32602 Invalid params) via classifier', async () => {
    const scoped = mockScopedMemory();
    const memory = mockMemory(scoped);
    await expect(
      withScope(ALICE_CTX, () =>
        dispatch('remember', {}, { memoryFactory: () => memory }),
      ),
    ).rejects.toBeInstanceOf(McpError);
  });

  it('dispatch with unknown tool name throws McpError(-32601 Method not found)', async () => {
    const scoped = mockScopedMemory();
    const memory = mockMemory(scoped);
    await expect(
      withScope(ALICE_CTX, () =>
        dispatch('xxx_unknown', {}, { memoryFactory: () => memory }),
      ),
    ).rejects.toBeInstanceOf(McpError);
  });

  it('MemoryStoreError thrown by Memory propagates as Tool Execution Error (retry text)', async () => {
    const scoped = mockScopedMemory();
    vi.mocked(scoped.remember).mockRejectedValue(new MemoryStoreError('pg conn down'));
    const memory = mockMemory(scoped);
    const result = await withScope(ALICE_CTX, () =>
      dispatch('remember', { content: 'foo' }, { memoryFactory: () => memory }),
    );
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toMatch(/Retry/i);
  });
});

// #82: the skill tools are now workspace-scoped — they bind the workspace from the
// active scope via workspaceScopedMemory before resolving memory.skills(repoId).
// Each dispatch runs inside withScope (ALICE_CTX has no workspaceId → single-tenant
// passthrough; the cross-tenant binding is asserted in the 12-verb isolation block).
describe('dispatch — skills write surface (skills-write-surface T2.3)', () => {
  it('add_skill stores via memory.skills(repoId).add and reports the id', async () => {
    const skillScoped = { add: vi.fn(), recall: vi.fn(), getAll: vi.fn(), consolidate: vi.fn(), forget: vi.fn() };
    skillScoped.add.mockResolvedValue({ id: 'sk-1', hash: 'h-1' });
    const memory = mock<Memory>();
    vi.mocked(memory.skills).mockReturnValue(skillScoped as never);

    const result = await withScope(ALICE_CTX, () =>
      dispatch(
        'add_skill',
        { repoId: 'acme', code: 'export const x=1;', description: 'a skill', codeLanguage: 'typescript' },
        { memoryFactory: () => memory },
      ),
    );

    // #114: repoId namespaced with the auth subject (BFF D3 parity) — dashboard visibility.
    expect(vi.mocked(memory.skills)).toHaveBeenCalledWith('alice:acme');
    expect(skillScoped.add).toHaveBeenCalledWith({ code: 'export const x=1;', description: 'a skill', codeLanguage: 'typescript' });
    expect(result.isError ?? false).toBe(false);
    expect(JSON.stringify(result.content)).toContain('sk-1');
  });

  it('add_skill returns a Tool Execution Error on SkillAlreadyExists', async () => {
    const { SkillAlreadyExists } = await import('@usetheo/memory/contract');
    const skillScoped = { add: vi.fn(), recall: vi.fn(), getAll: vi.fn(), consolidate: vi.fn(), forget: vi.fn() };
    skillScoped.add.mockRejectedValue(new SkillAlreadyExists('h-1', 'acme'));
    const memory = mock<Memory>();
    vi.mocked(memory.skills).mockReturnValue(skillScoped as never);

    const result = await withScope(ALICE_CTX, () =>
      dispatch(
        'add_skill',
        { repoId: 'acme', code: 'x', description: 'dupe', codeLanguage: 'typescript' },
        { memoryFactory: () => memory },
      ),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('already exists');
  });

  it('forget_skill deletes via memory.skills(repoId).forget', async () => {
    const skillScoped = { add: vi.fn(), recall: vi.fn(), getAll: vi.fn(), consolidate: vi.fn(), forget: vi.fn() };
    skillScoped.forget.mockResolvedValue(undefined);
    const memory = mock<Memory>();
    vi.mocked(memory.skills).mockReturnValue(skillScoped as never);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('forget_skill', { repoId: 'acme', skillId: 'sk-1' }, { memoryFactory: () => memory }),
    );
    expect(skillScoped.forget).toHaveBeenCalledWith('sk-1');
    expect(result.isError ?? false).toBe(false);
  });

  it('forget_skill is idempotent on MemoryNotFound (cross-repo/non-existent)', async () => {
    const skillScoped = { add: vi.fn(), recall: vi.fn(), getAll: vi.fn(), consolidate: vi.fn(), forget: vi.fn() };
    skillScoped.forget.mockRejectedValue(new MemoryNotFound('sk-x'));
    const memory = mock<Memory>();
    vi.mocked(memory.skills).mockReturnValue(skillScoped as never);

    const result = await withScope(ALICE_CTX, () =>
      dispatch('forget_skill', { repoId: 'acme', skillId: 'sk-x' }, { memoryFactory: () => memory }),
    );
    expect(result.isError ?? false).toBe(false);
  });

  // #114 backward-compat: a no-auth transport (stdio local dev — scope without a
  // session userId) keeps the BARE repoId, matching pre-fix single-user behavior.
  it('add_skill keeps the bare repoId when the scope carries no auth userId', async () => {
    const skillScoped = { add: vi.fn(), recall: vi.fn(), getAll: vi.fn(), consolidate: vi.fn(), forget: vi.fn() };
    skillScoped.add.mockResolvedValue({ id: 'sk-2', hash: 'h-2' });
    const memory = mock<Memory>();
    vi.mocked(memory.skills).mockReturnValue(skillScoped as never);

    const result = await withScope({ session: null }, () =>
      dispatch(
        'add_skill',
        { repoId: 'acme', code: 'x', description: 'local skill', codeLanguage: 'typescript' },
        { memoryFactory: () => memory },
      ),
    );
    expect(vi.mocked(memory.skills)).toHaveBeenCalledWith('acme');
    expect(result.isError ?? false).toBe(false);
  });
});

describe('execute_skill dispatch — T2.4', () => {
  function skillScopedWith(execute: ReturnType<typeof vi.fn>): {
    add: ReturnType<typeof vi.fn>;
    recall: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    consolidate: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  } {
    return {
      add: vi.fn(),
      recall: vi.fn(),
      getAll: vi.fn(),
      consolidate: vi.fn(),
      forget: vi.fn(),
      execute,
    };
  }

  it('execute_skill runs via memory.skills(repoId).execute and returns the output', async () => {
    const execute = vi.fn().mockResolvedValue({ output: 5, truncated: false, elapsedMs: 2 });
    const skillScoped = skillScopedWith(execute);
    const memory = mock<Memory>();
    vi.mocked(memory.skills).mockReturnValue(skillScoped as never);

    const result = await withScope(ALICE_CTX, () =>
      dispatch(
        'execute_skill',
        { repoId: 'acme', skillId: 'sk-1', args: { x: 2, y: 3 } },
        { memoryFactory: () => memory },
      ),
    );

    // #114: repoId namespaced with the auth subject (BFF D3 parity) — dashboard visibility.
    expect(vi.mocked(memory.skills)).toHaveBeenCalledWith('alice:acme');
    expect(execute).toHaveBeenCalledWith('sk-1', { x: 2, y: 3 }, undefined);
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result.content)).toContain('5');
  });

  it('execute_skill returns a Tool Execution Error with the reason on a guard denial', async () => {
    const { ToolInvocationDeniedError } = await import('@usetheo/memory/contract');
    const execute = vi.fn().mockRejectedValue(new ToolInvocationDeniedError('timeout', 'exceeded'));
    const memory = mock<Memory>();
    vi.mocked(memory.skills).mockReturnValue(skillScopedWith(execute) as never);

    const result = await withScope(ALICE_CTX, () =>
      dispatch(
        'execute_skill',
        { repoId: 'acme', skillId: 'sk-1' },
        { memoryFactory: () => memory },
      ),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('timeout');
  });

  it('execute_skill returns a Tool Execution Error when no executor is wired', async () => {
    const { SkillExecutionNotConfiguredError } = await import('@usetheo/memory/contract');
    const execute = vi.fn().mockRejectedValue(new SkillExecutionNotConfiguredError('no executor'));
    const memory = mock<Memory>();
    vi.mocked(memory.skills).mockReturnValue(skillScopedWith(execute) as never);

    const result = await withScope(ALICE_CTX, () =>
      dispatch(
        'execute_skill',
        { repoId: 'acme', skillId: 'sk-1' },
        { memoryFactory: () => memory },
      ),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content).toLowerCase()).toContain('not configured');
  });
});

// T3.1 (#82) — every tool verb binds the active scope's workspace BEFORE touching
// the store. With a workspace in scope, the memory the handler operates on is the
// one returned by withWorkspace('tn-A'); a tn-A request never touches tn-B's store.
describe('workspace isolation across all tool verbs (T3.1, #82)', () => {
  const WS_A_CTX = { workspaceId: 'tn-A', session: { userId: 'alice' } } as const;

  function memoryBoundTo(): { root: Memory; bound: Memory; boundScoped: ScopedMemory } {
    const boundScoped = mock<ScopedMemory>();
    const bound = mock<Memory>();
    vi.mocked(bound.user).mockReturnValue(boundScoped);
    const skillScoped = { add: vi.fn(), recall: vi.fn(), getAll: vi.fn(), consolidate: vi.fn(), forget: vi.fn(), execute: vi.fn() };
    vi.mocked(bound.skills).mockReturnValue(skillScoped);
    const root = mock<Memory>();
    // workspaceScopedMemory calls root.withWorkspace('tn-A') → bound
    vi.mocked(root.withWorkspace!).mockReturnValue(bound);
    return { root, bound, boundScoped };
  }

  it('recall binds withWorkspace(tn-A) before resolving the user-tier memory', async () => {
    const { root, bound, boundScoped } = memoryBoundTo();
    vi.mocked(boundScoped.recall).mockResolvedValue([]);

    await withScope(WS_A_CTX, () => dispatch('recall', { query: 'x' }, { memoryFactory: () => root }));

    expect(vi.mocked(root.withWorkspace!)).toHaveBeenCalledWith('tn-A');
    expect(vi.mocked(bound.user)).toHaveBeenCalledWith('alice'); // user tier resolved on the WS-bound memory
  });

  it('forget binds withWorkspace(tn-A) THEN the subject (workspace,user) scope before forgetting', async () => {
    const { root, bound, boundScoped } = memoryBoundTo();
    vi.mocked(boundScoped.forget).mockResolvedValue(undefined);

    await withScope(WS_A_CTX, () =>
      dispatch('forget', { id: '550e8400-e29b-41d4-a716-446655440000' }, { memoryFactory: () => root }),
    );

    // workspace bound first (tn-A), then the (workspace, user) subject scope; forget runs there —
    // NOT on the workspace-only bound memory (the M14 cross-user IDOR fix).
    expect(vi.mocked(root.withWorkspace!)).toHaveBeenCalledWith('tn-A');
    expect(vi.mocked(bound.user)).toHaveBeenCalledWith('alice');
    expect(vi.mocked(boundScoped.forget)).toHaveBeenCalled();
    expect(vi.mocked(bound.forget)).not.toHaveBeenCalled();
  });

  it('add_skill binds withWorkspace(tn-A) before resolving memory.skills(repoId)', async () => {
    const { root, bound } = memoryBoundTo();
    const skillScoped = vi.mocked(bound.skills)('acme') as unknown as { add: ReturnType<typeof vi.fn> };
    skillScoped.add.mockResolvedValue({ id: 'sk-1', hash: 'h' });

    await withScope(WS_A_CTX, () =>
      dispatch(
        'add_skill',
        { repoId: 'acme', code: 'x', description: 'd', codeLanguage: 'typescript' },
        { memoryFactory: () => root },
      ),
    );

    expect(vi.mocked(root.withWorkspace!)).toHaveBeenCalledWith('tn-A');
    expect(vi.mocked(bound.skills)).toHaveBeenCalledWith('alice:acme'); // WS-bound + #114 subject-namespaced
  });

  // F-xval-1 (HIGH) — the plan-mandated ALS concurrency test. Two recall dispatches
  // interleave inside distinct withScope(tn-A)/(tn-B) blocks; the happens-before
  // observation is that AFTER the awaited dispatch each async context still observes
  // its OWN workspace (AsyncLocalStorage.run isolates per-context — no bleed), and
  // root.withWorkspace was bound once per tenant with the correct id.
  it('ALS isolation — concurrent test: interleaved tn-A/tn-B dispatches never bleed workspace', async () => {
    const boundWorkspaces: string[] = [];
    const root = mock<Memory>();
    vi.mocked(root.withWorkspace!).mockImplementation((ws: string) => {
      boundWorkspaces.push(ws);
      const scoped = mock<ScopedMemory>();
      vi.mocked(scoped.recall).mockResolvedValue([]);
      const m = mock<Memory>();
      vi.mocked(m.user).mockReturnValue(scoped);
      return m;
    });

    const observedAfterAwait: Record<string, string | undefined> = {};
    const probe = (ws: string): Promise<void> =>
      withScope({ workspaceId: ws, session: { userId: 'u' } }, async () => {
        await dispatch('recall', { query: 'x' }, { memoryFactory: () => root });
        // happens-before: after the interleaved await, my ambient scope is STILL mine.
        observedAfterAwait[ws] = getScope().workspaceId;
      });

    await Promise.all([probe('tn-A'), probe('tn-B')]);

    expect(observedAfterAwait).toEqual({ 'tn-A': 'tn-A', 'tn-B': 'tn-B' });
    expect([...boundWorkspaces].sort()).toEqual(['tn-A', 'tn-B']);
  });

  // F-xval-3 (MEDIUM) — a fail-closed workspace-bind throw (workspace set but the Memory
  // has no withWorkspace, ADR D3/EC-1) MUST be handled gracefully by the dispatch, NOT
  // left as an unhandled rejection that wedges the singleton transport. Per the error
  // classifier (ADR D6), an unexpected throw surfaces as a thrown `McpError` (-32603
  // Internal error) which the SDK serializes to a clean JSON-RPC error{} — a handled
  // error response, never a transport wedge. (No `isError:true` here because the throw is
  // a generic Error, not a typed domain/execution error.)
  it('dispatch handles the fail-closed workspace-bind throw gracefully (McpError, not a wedge)', async () => {
    const { McpError } = await import('@modelcontextprotocol/sdk/types.js');
    const memory = { user: vi.fn(), forget: vi.fn() } as unknown as Memory; // no withWorkspace
    await expect(
      withScope({ workspaceId: 'tn-A', session: { userId: 'u' } }, () =>
        dispatch('recall', { query: 'x' }, { memoryFactory: () => memory }),
      ),
    ).rejects.toBeInstanceOf(McpError);
  });
});
