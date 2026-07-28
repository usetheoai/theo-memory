/**
 * M0 T2.2 — the MCP `recall` tool must expose `graphExpand` + `asOf` (parity with
 * REST `POST /v1/recall`) and pass them into the core `scoped.recall`, so MCP
 * callers get graph-aware recall AND the temporal-correctness fix (t_invalid never
 * resurfaced; asOf point-in-time). Before this task the MCP recall schema dropped
 * both keys silently.
 *
 */
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { Memory, ScopedMemory, MemoryItemWithScore } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';

import { dispatch } from './dispatch.js';

const ALICE_CTX = { session: { userId: 'alice' } } as const;

function mockMemory(scoped: ScopedMemory): Memory {
  const memory = mock<Memory>();
  vi.mocked(memory.user).mockReturnValue(scoped);
  return memory;
}

describe('MCP recall — graphExpand + asOf parity (M0 T2.2)', () => {
  it('passes graphExpand and asOf (ISO→Date) through to scoped.recall', async () => {
    const scoped = mock<ScopedMemory>();
    const hit: MemoryItemWithScore = {
      id: 'uuid-1',
      text: 'beta doc',
      hash: 'h',
      score: 0.9,
      scope: { kind: 'user', userId: 'alice' },
      createdAt: new Date('2026-05-24T12:00:00.000Z'),
      updatedAt: new Date('2026-05-24T12:00:00.000Z'),
      metadata: {},
      tValid: new Date('2026-05-24T12:00:00.000Z'),
      tInvalid: null,
    };
    vi.mocked(scoped.recall).mockResolvedValue([hit]);
    const memory = mockMemory(scoped);

    await withScope(ALICE_CTX, () =>
      dispatch(
        'recall',
        { query: 'alpha', graphExpand: { hops: 2 }, asOf: '2026-02-01T00:00:00.000Z' },
        { memoryFactory: () => memory },
      ),
    );

    expect(vi.mocked(scoped.recall)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(scoped.recall).mock.calls[0];
    expect(call).toBeDefined();
    const [query, options] = call!;
    expect(query).toBe('alpha');
    expect(options).toBeDefined();
    expect(options!).toMatchObject({
      graphExpand: { hops: 2 },
      asOf: new Date('2026-02-01T00:00:00.000Z'),
    });
  });

  it('omits graphExpand and asOf when not supplied (default OFF, byte-unchanged)', async () => {
    const scoped = mock<ScopedMemory>();
    vi.mocked(scoped.recall).mockResolvedValue([]);
    const memory = mockMemory(scoped);

    await withScope(ALICE_CTX, () =>
      dispatch('recall', { query: 'alpha' }, { memoryFactory: () => memory }),
    );

    const opts = (vi.mocked(scoped.recall).mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(opts['graphExpand']).toBeUndefined();
    expect(opts['asOf']).toBeUndefined();
  });
});
