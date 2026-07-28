/**
 * `list_entities` handler tests (M14 T2.2) — scope from the Principal, never the arg.
 *
 * @see ADR-M14-1 — o filtro (workspace,user) vem do getScope(), não do argumento
 */
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, test, vi } from 'vitest';


import { listEntitiesHandler } from './list-entities-handler.js';

function textOf(res: { content: readonly unknown[] }): string {
  const first = res.content[0] as { type?: string; text?: string } | undefined;
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '';
}

function storeReturning(rows: { name: string; memoryCount: number; lastSeenAt: string }[]) {
  const list = vi.fn(async () => rows);
  return { store: { list } as never, list };
}

const memoryFactory = () => ({}) as never;

describe('listEntitiesHandler (T2.2)', () => {
  test('test_list_entities_scoped_to_principal — filtra por (workspace,user) do getScope, não do arg', async () => {
    const { store, list } = storeReturning([{ name: 'Codex', memoryCount: 3, lastSeenAt: '2026-07-24' }]);
    const res = await withScope({ workspaceId: 'ws-A', session: { userId: 'alice' } }, () =>
      listEntitiesHandler({}, { memoryFactory, memoryEntityStore: store }),
    );
    // O store foi chamado com o workspace + user do scope (não de nenhum arg).
    expect(list).toHaveBeenCalledWith({
      workspaceId: 'ws-A',
      filters: { workspace_id: 'ws-A', user_id: 'alice' },
    });
    expect(res.isError).toBe(false);
    expect(textOf(res)).toContain('Codex');
  });

  test('test_list_entities_ignores_scope_arg_from_other_user — arg extra é rejeitado (strict) e o scope manda', async () => {
    const { store } = storeReturning([]);
    await expect(
      withScope({ workspaceId: 'ws-A', session: { userId: 'alice' } }, () =>
        listEntitiesHandler({ user_id: 'bob' }, { memoryFactory, memoryEntityStore: store }),
      ),
    ).rejects.toThrow(); // strict schema → user_id não aceito; o scope vem do Principal
  });

  test('test_list_entities_requires_user_scope — sem user no scope → MissingScopeError (não vaza)', async () => {
    const { store } = storeReturning([]);
    await expect(
      withScope({ workspaceId: 'ws-A', session: {} }, () =>
        listEntitiesHandler({}, { memoryFactory, memoryEntityStore: store }),
      ),
    ).rejects.toThrow(/scope/i);
  });

  test('test_list_entities_respects_limit — limit corta a lista', async () => {
    const rows = [1, 2, 3].map((n) => ({ name: `E${n}`, memoryCount: n, lastSeenAt: 'x' }));
    const { store } = storeReturning(rows);
    const res = await withScope({ workspaceId: 'ws-A', session: { userId: 'alice' } }, () =>
      listEntitiesHandler({ limit: 2 }, { memoryFactory, memoryEntityStore: store }),
    );
    const parsed = JSON.parse(textOf(res)) as { entities: readonly unknown[] };
    expect(parsed.entities).toHaveLength(2);
  });
});
