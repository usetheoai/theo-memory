/**
 * `delete_entities` handler tests (M14 T2.4b) — scoped forget + fail-closed guard (#252).
 *
 * The two load-bearing invariants:
 *  - identity comes from the Principal (`getScope()`), NEVER from a tool argument (ADR-M14-1);
 *  - without an acting user the call ABORTS at the surface (MissingScopeError) and NEVER reaches
 *    the store — the theo-cloud#252 cascade-delete lesson (an under-constrained scope never wipes).
 *
 * @see ADR-M14-1 — identidade do Principal server-side
 * @see theo-cloud#252 — fail-closed antes de qualquer deleção
 */
import { MissingScopeError } from '@usetheo/memory/contract';
import type { Memory, MemoryEntityStore } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';


import { deleteEntitiesHandler } from './delete-entities-handler.js';

function textOf(res: { content: readonly unknown[] }): string {
  const first = res.content[0] as { type?: string; text?: string } | undefined;
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '';
}

function deps() {
  const memoryEntityStore = mock<MemoryEntityStore>();
  vi.mocked(memoryEntityStore.forgetEntity).mockResolvedValue({
    entitiesRemoved: 1,
    linksRemoved: 3,
    edgesRemoved: 2,
  });
  return { memoryFactory: () => mock<Memory>(), memoryEntityStore };
}

describe('deleteEntitiesHandler (T2.4b)', () => {
  test('test_delete_scopes_from_principal_never_arg — filtro (workspace,user) vem do getScope, não do argumento', async () => {
    const d = deps();
    await withScope({ workspaceId: 'ws-A', session: { userId: 'alice' } }, () =>
      deleteEntitiesHandler({ name: 'Codex' }, d),
    );
    expect(d.memoryEntityStore.forgetEntity).toHaveBeenCalledWith({
      name: 'Codex',
      workspaceId: 'ws-A',
      filters: { workspace_id: 'ws-A', user_id: 'alice' },
    });
  });

  test('test_delete_aborts_without_user_scope — sem user no Principal → MissingScopeError, store NUNCA tocado (fail-closed #252)', async () => {
    const d = deps();
    await expect(
      withScope({ workspaceId: 'ws-A' }, () => deleteEntitiesHandler({ name: 'Codex' }, d)),
    ).rejects.toBeInstanceOf(MissingScopeError);
    expect(d.memoryEntityStore.forgetEntity).not.toHaveBeenCalled();
  });

  test('test_delete_ignores_cross_user_arg — arg user_id extra é rejeitado pelo schema strict', async () => {
    const d = deps();
    await expect(
      withScope({ workspaceId: 'ws-A', session: { userId: 'alice' } }, () =>
        deleteEntitiesHandler({ name: 'Codex', user_id: 'bob' }, d),
      ),
    ).rejects.toThrow();
    expect(d.memoryEntityStore.forgetEntity).not.toHaveBeenCalled();
  });

  test('test_delete_returns_counts — o retorno expõe as contagens removidas', async () => {
    const d = deps();
    const res = await withScope({ workspaceId: 'ws-A', session: { userId: 'alice' } }, () =>
      deleteEntitiesHandler({ name: 'Codex' }, d),
    );
    expect(res.isError).toBe(false);
    const payload = JSON.parse(textOf(res)) as { entities_removed: number };
    expect(payload.entities_removed).toBe(1);
  });

  test('test_delete_unavailable_without_store — sem entity store configurado → erro amigável, não crash', async () => {
    const res = await withScope({ workspaceId: 'ws-A', session: { userId: 'alice' } }, () =>
      deleteEntitiesHandler({ name: 'Codex' }, { memoryFactory: () => mock<Memory>() }),
    );
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not available/i);
  });
});
