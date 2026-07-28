/**
 * OpenMemory compat tools — contract tests (Roadmap Item 26, plan T0.1).
 *
 * Asserts the alias set: exactly the 4 OpenMemory wire-names with descriptions +
 * inputSchemas; each handler delegates to the correct Memory operation; the
 * delete tool maps to forget-per-id; return shapes are OpenMemory-parity
 * JSON-string text content.
 */

import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import type { MemoryItem, MemoryItemWithScore } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import {
  ADD_MEMORIES,
  SEARCH_MEMORY,
  LIST_MEMORIES,
  DELETE_MEMORIES,
  buildOpenMemoryToolsList,
  openMemoryDispatch,
} from './tools.js';

const FIXED = new Date('2026-06-18T12:00:00.000Z');
const ALICE = { session: { userId: 'alice' } } as const;

function scopedMock(): ScopedMemory {
  return mock<ScopedMemory>();
}
function memoryMock(scoped: ScopedMemory): Memory {
  const memory = mock<Memory>();
  vi.mocked(memory.user).mockReturnValue(scoped);
  return memory;
}
const text = (r: { content: unknown }): string =>
  (r.content as { text: string }[])[0]?.text ?? '';

describe('buildOpenMemoryToolsList', () => {
  it('returns exactly the 4 OpenMemory wire-names', () => {
    const names = buildOpenMemoryToolsList().tools.map((t) => t.name);
    expect(names).toEqual([ADD_MEMORIES, SEARCH_MEMORY, LIST_MEMORIES, DELETE_MEMORIES]);
  });

  it('every tool has a non-empty description and an inputSchema', () => {
    for (const t of buildOpenMemoryToolsList().tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(0);
      expect(t.inputSchema).toBeDefined();
    }
  });

  it('add_memories input schema declares text (required) + infer (optional)', () => {
    const add = buildOpenMemoryToolsList().tools.find((t) => t.name === ADD_MEMORIES);
    const schema = add?.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    expect(Object.keys(schema.properties ?? {})).toEqual(expect.arrayContaining(['text', 'infer']));
    expect(schema.required).toEqual(['text']);
  });

  it('delete_memories input schema requires memory_ids: string[]', () => {
    const del = buildOpenMemoryToolsList().tools.find((t) => t.name === DELETE_MEMORIES);
    const schema = del?.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] };
    expect(schema.required).toEqual(['memory_ids']);
    expect(schema.properties?.['memory_ids']?.type).toBe('array');
  });
});

describe('openMemoryDispatch — handler mapping', () => {
  it('add_memories delegates to scoped.remember and returns a JSON string', async () => {
    const scoped = scopedMock();
    const item: MemoryItem = {
      id: 'm1', text: 'likes coffee', hash: 'h', scope: { kind: 'user', userId: 'alice' },
      createdAt: FIXED, updatedAt: FIXED, metadata: {}, tValid: FIXED, tInvalid: null,
    };
    vi.mocked(scoped.remember).mockResolvedValue([item]);
    const memory = memoryMock(scoped);

    const r = await withScope(ALICE, () =>
      openMemoryDispatch(ADD_MEMORIES, { text: 'likes coffee', infer: false }, { memoryFactory: () => memory }),
    );

    expect(vi.mocked(scoped.remember)).toHaveBeenCalledWith('likes coffee', { infer: false });
    expect(r.isError ?? false).toBe(false);
    expect(JSON.parse(text(r))).toEqual({ added: 1, ids: ['m1'] });
  });

  it('search_memory delegates to scoped.recall and returns JSON results', async () => {
    const scoped = scopedMock();
    const hit: MemoryItemWithScore = {
      id: 'm1', text: 'likes coffee', hash: 'h', scope: { kind: 'user', userId: 'alice' },
      createdAt: FIXED, updatedAt: FIXED, metadata: {}, tValid: FIXED, tInvalid: null, score: 0.9,
    };
    vi.mocked(scoped.recall).mockResolvedValue([hit]);
    const memory = memoryMock(scoped);

    const r = await withScope(ALICE, () =>
      openMemoryDispatch(SEARCH_MEMORY, { query: 'coffee' }, { memoryFactory: () => memory }),
    );

    expect(vi.mocked(scoped.recall)).toHaveBeenCalledWith('coffee');
    expect(JSON.parse(text(r))).toEqual([
      { id: 'm1', memory: 'likes coffee', score: 0.9, created_at: FIXED.toISOString() },
    ]);
  });

  it('list_memories delegates to scoped.getAll', async () => {
    const scoped = scopedMock();
    const item: MemoryItem = {
      id: 'm1', text: 'likes coffee', hash: 'h', scope: { kind: 'user', userId: 'alice' },
      createdAt: FIXED, updatedAt: FIXED, metadata: {}, tValid: FIXED, tInvalid: null,
    };
    vi.mocked(scoped.getAll).mockResolvedValue([item]);
    const memory = memoryMock(scoped);

    const r = await withScope(ALICE, () =>
      openMemoryDispatch(LIST_MEMORIES, {}, { memoryFactory: () => memory }),
    );

    expect(vi.mocked(scoped.getAll)).toHaveBeenCalledOnce();
    expect(JSON.parse(text(r))).toEqual([{ id: 'm1', memory: 'likes coffee', created_at: FIXED.toISOString() }]);
  });

  // Helper: a user-scoped MemoryItem owned by `userId`.
  const ownedBy = (id: string, userId: string): MemoryItem => ({
    id, text: 't', hash: 'h', scope: { kind: 'user', userId },
    createdAt: FIXED, updatedAt: FIXED, metadata: {}, tValid: FIXED, tInvalid: null,
  });

  it('delete_memories forgets only ids the requesting user owns', async () => {
    const scoped = scopedMock();
    const memory = memoryMock(scoped);
    // Both ids exist and belong to alice (the requesting user).
    vi.mocked(memory.get).mockImplementation((id: string) => Promise.resolve(ownedBy(id, 'alice')));
    vi.mocked(memory.forget).mockResolvedValue(undefined);

    const r = await withScope(ALICE, () =>
      openMemoryDispatch(DELETE_MEMORIES, { memory_ids: ['a', 'b'] }, { memoryFactory: () => memory }),
    );

    expect(vi.mocked(memory.forget).mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(JSON.parse(text(r))).toEqual({ deleted: ['a', 'b'] });
  });

  it('delete_memories REFUSES to forget another user\'s memory (cross-user IDOR guard)', async () => {
    const scoped = scopedMock();
    const memory = memoryMock(scoped);
    // The id exists but belongs to bob; alice must NOT be able to delete it.
    vi.mocked(memory.get).mockResolvedValue(ownedBy('bob-secret', 'bob'));
    vi.mocked(memory.forget).mockResolvedValue(undefined);

    const r = await withScope(ALICE, () =>
      openMemoryDispatch(DELETE_MEMORIES, { memory_ids: ['bob-secret'] }, { memoryFactory: () => memory }),
    );

    expect(vi.mocked(memory.forget)).not.toHaveBeenCalled();
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/No accessible memories/);
  });

  it('delete_memories returns an Error string when ids are unknown', async () => {
    const scoped = scopedMock();
    const memory = memoryMock(scoped);
    vi.mocked(memory.get).mockResolvedValue(null);

    const r = await withScope(ALICE, () =>
      openMemoryDispatch(DELETE_MEMORIES, { memory_ids: ['x'] }, { memoryFactory: () => memory }),
    );

    expect(vi.mocked(memory.forget)).not.toHaveBeenCalled();
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^Error: /);
  });

  it('unknown tool returns an Error string (OpenMemory parity, not a protocol throw)', async () => {
    const scoped = scopedMock();
    const r = await withScope(ALICE, () =>
      openMemoryDispatch('nope', {}, { memoryFactory: () => memoryMock(scoped) }),
    );
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^Error: Unknown tool/);
  });
});
