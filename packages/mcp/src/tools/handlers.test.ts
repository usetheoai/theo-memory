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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { MemoryNotFound, MemoryStoreError, MissingScopeError } from '@usetheo/memory/contract';
import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import type { MemoryItem, MemoryItemWithScore } from '@usetheo/memory/contract';
import { withScope } from '../scope.js';
import { dispatch } from './dispatch.js';

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

  it('forget handler with id calls top-level Memory.forget (not ScopedMemory — SEPA gotcha)', async () => {
    const scoped = mockScopedMemory();
    const memory = mockMemory(scoped);
    vi.mocked(memory.forget).mockResolvedValue(undefined);

    const id = '550e8400-e29b-41d4-a716-446655440000';
    const result = await withScope(ALICE_CTX, () =>
      dispatch('forget', { id }, { memoryFactory: () => memory }),
    );

    // forget is on TOP-LEVEL Memory; ScopedMemory does NOT expose forget
    expect(vi.mocked(memory.forget)).toHaveBeenCalledWith(id);
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
    vi.mocked(memory.forget).mockRejectedValue(
      new MemoryNotFound('memoryId xxx not found (EC-12: divergence from the upstream)'),
    );

    const result = await withScope(ALICE_CTX, () =>
      dispatch('forget', { id: '550e8400-e29b-41d4-a716-446655440000' }, { memoryFactory: () => memory }),
    );

    // EC-14 contract: forget unknown-id is idempotent at the agent-tools boundary
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
