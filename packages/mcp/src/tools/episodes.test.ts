/**
 * `episodes` dispatch handler tests (G3-MCP).
 *
 * The episodes tool delegates to the SHIPPED `ScopedMemory.episodes()` via the
 * same scope binding as recall. Tests cover: option passthrough (empty / limit /
 * order / queryText / asOf-ISO→Date / after-cursor), the EC-1 nextCursor emission
 * (pagination), EC-2 absent-option omission, EC-3 session-scope union serialization,
 * and the error paths (missing scope, after+before mutual exclusion).
 *
 * @see ADR D6 — Protocol (thrown McpError) vs Execution (returned isError) errors
 */
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import type { Memory, MemoryItem, ScopedMemory } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';


import { dispatch } from './dispatch.js';
import { OUTPUT_SCHEMA } from './episodes-schema.js';

const FIXED_DATE = new Date('2026-05-24T12:00:00.000Z');
const ALICE_CTX = { session: { userId: 'alice' } } as const;

function mockMemory(scoped: ScopedMemory): Memory {
  const memory = mock<Memory>();
  vi.mocked(memory.user).mockReturnValue(scoped);
  return memory;
}

function userItem(id: string): MemoryItem {
  return {
    id,
    text: `event ${id}`,
    hash: 'h',
    scope: { kind: 'user', userId: 'alice' },
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    metadata: {},
    tValid: FIXED_DATE,
    tInvalid: null,
  };
}

describe('episodes dispatch handler (G3-MCP)', () => {
  it('dispatches with no options → scoped.episodes() with no args, returns items', async () => {
    const scoped = mock<ScopedMemory>();
    vi.mocked(scoped.episodes).mockResolvedValue({ items: [userItem('e1')] });
    const result = await withScope(ALICE_CTX, () =>
      dispatch('episodes', {}, { memoryFactory: () => mockMemory(scoped) }),
    );
    expect(vi.mocked(scoped.episodes)).toHaveBeenCalledWith();
    expect(result.isError ?? false).toBe(false);
    const sc = result.structuredContent as { items: { id: string }[] };
    expect(sc.items.map((i) => i.id)).toEqual(['e1']);
  });

  it('EC-1: emits page.nextCursor into structuredContent.nextCursor (pagination)', async () => {
    const scoped = mock<ScopedMemory>();
    vi.mocked(scoped.episodes).mockResolvedValue({ items: [userItem('e1')], nextCursor: 'abc' });
    const result = await withScope(ALICE_CTX, () =>
      dispatch('episodes', {}, { memoryFactory: () => mockMemory(scoped) }),
    );
    expect((result.structuredContent as { nextCursor?: string }).nextCursor).toBe('abc');
  });

  it('EC-1: omits nextCursor when the page has none', async () => {
    const scoped = mock<ScopedMemory>();
    vi.mocked(scoped.episodes).mockResolvedValue({ items: [] });
    const result = await withScope(ALICE_CTX, () =>
      dispatch('episodes', {}, { memoryFactory: () => mockMemory(scoped) }),
    );
    expect(result.structuredContent as object).not.toHaveProperty('nextCursor');
  });

  it('EC-2: omits absent options — episodes called with only present keys', async () => {
    const scoped = mock<ScopedMemory>();
    vi.mocked(scoped.episodes).mockResolvedValue({ items: [] });
    await withScope(ALICE_CTX, () =>
      dispatch('episodes', { limit: 25, order: 'asc' }, { memoryFactory: () => mockMemory(scoped) }),
    );
    expect(vi.mocked(scoped.episodes)).toHaveBeenCalledWith({ limit: 25, order: 'asc' });
  });

  it('forwards queryText + after-cursor verbatim', async () => {
    const scoped = mock<ScopedMemory>();
    vi.mocked(scoped.episodes).mockResolvedValue({ items: [] });
    await withScope(ALICE_CTX, () =>
      dispatch(
        'episodes',
        { queryText: 'deploy', after: 'cursor-xyz' },
        { memoryFactory: () => mockMemory(scoped) },
      ),
    );
    expect(vi.mocked(scoped.episodes)).toHaveBeenCalledWith({ queryText: 'deploy', after: 'cursor-xyz' });
  });

  it('D4: parses asOf ISO string into a Date for scoped.episodes', async () => {
    const scoped = mock<ScopedMemory>();
    vi.mocked(scoped.episodes).mockResolvedValue({ items: [] });
    await withScope(ALICE_CTX, () =>
      dispatch(
        'episodes',
        { asOf: '2026-05-24T12:00:00.000Z' },
        { memoryFactory: () => mockMemory(scoped) },
      ),
    );
    const arg = vi.mocked(scoped.episodes).mock.calls[0]?.[0];
    expect(arg?.asOf).toBeInstanceOf(Date);
    expect(arg?.asOf?.toISOString()).toBe('2026-05-24T12:00:00.000Z');
  });

  it('EC-3: serializes a session-scope item (kind+sessionId+userId) through OUTPUT_SCHEMA', async () => {
    const scoped = mock<ScopedMemory>();
    const sessionItem: MemoryItem = {
      id: 's1',
      text: 'session event',
      hash: 'h',
      scope: { kind: 'session', sessionId: 'sess-1', userId: 'alice' },
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
      metadata: { turn: 1 },
      tValid: FIXED_DATE,
      tInvalid: null,
    };
    vi.mocked(scoped.episodes).mockResolvedValue({ items: [sessionItem] });
    const result = await withScope(ALICE_CTX, () =>
      dispatch('episodes', {}, { memoryFactory: () => mockMemory(scoped) }),
    );
    // The wired structuredContent must satisfy the published OUTPUT_SCHEMA.
    const parsed = OUTPUT_SCHEMA.safeParse(result.structuredContent);
    expect(parsed.success).toBe(true);
    const item = (result.structuredContent as { items: { scope: { kind: string }; createdAt: string }[] }).items[0];
    expect(item?.scope.kind).toBe('session');
    expect(typeof item?.createdAt).toBe('string');
  });

  it('episodes outside withScope returns a Tool Execution Error (missing scope)', async () => {
    const scoped = mock<ScopedMemory>();
    const result = await dispatch('episodes', {}, { memoryFactory: () => mockMemory(scoped) });
    expect(result.isError).toBe(true);
    expect(vi.mocked(scoped.episodes)).not.toHaveBeenCalled();
  });

  it('D4: after+before both set → McpError -32602 (mutual exclusion, Protocol Error)', async () => {
    const scoped = mock<ScopedMemory>();
    await expect(
      withScope(ALICE_CTX, () =>
        dispatch(
          'episodes',
          { after: 'a', before: 'b' },
          { memoryFactory: () => mockMemory(scoped) },
        ),
      ),
    ).rejects.toBeInstanceOf(McpError);
    expect(vi.mocked(scoped.episodes)).not.toHaveBeenCalled();
  });
});
