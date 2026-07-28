/**
 * `update_memory` handler tests (M14 T2.3) — remember-THEN-forget (edge EC-1).
 *
 * @see ADR-0003 — ADD-only; edge EC-1 — order matters (remember first, never data loss)
 */
import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';


import { updateMemoryHandler } from './update-memory-handler.js';

const OLD_ID = '00000000-0000-4000-8000-000000000001';

function textOf(res: { content: readonly unknown[] }): string {
  const first = res.content[0] as { type?: string; text?: string } | undefined;
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '';
}

/**
 * Builds a Memory mock where `routeScopedMemory` resolves to `.user(id)` (the SUBJECT scope):
 * both `remember` and the SUBJECT-SCOPED `forget` live on that scoped memory. `order` records
 * remember/forget invocation order (edge EC-1). The subject-scoped forget is the cross-user
 * IDOR fix — the handler no longer calls the workspace-only top-level `memory.forget`.
 */
function mockMemory(rememberResult: { id: string }[]) {
  const order: string[] = [];
  const scoped = mock<ScopedMemory>();
  vi.mocked(scoped.remember).mockImplementation(async () => {
    order.push('remember');
    return rememberResult as never;
  });
  vi.mocked(scoped.forget).mockImplementation(async () => {
    order.push('forget');
  });
  const memory = mock<Memory>();
  vi.mocked(memory.user).mockReturnValue(scoped);
  vi.mocked(memory.session).mockReturnValue(scoped);
  // withWorkspace undefined → workspaceScopedMemory passes memory through; memoryFromCtx then
  // resolves memory.user(authUserId) as the subject scope where both remember + forget land.
  (memory as { withWorkspace?: unknown }).withWorkspace = undefined;
  return { factory: () => memory, order, remember: scoped.remember, forget: scoped.forget };
}

describe('updateMemoryHandler (T2.3)', () => {
  test('test_update_remembers_before_forgets — a ordem é remember ENTÃO forget (EC-1)', async () => {
    const { factory, order, remember, forget } = mockMemory([{ id: 'new-id' }]);
    await withScope({ session: { userId: 'alice' } }, () =>
      updateMemoryHandler({ id: OLD_ID, content: 'novo texto suficientemente longo' }, { memoryFactory: factory }),
    );
    expect(remember).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledWith(OLD_ID);
    expect(order).toEqual(['remember', 'forget']);
  });

  test('test_update_keeps_old_when_remember_fails — remember vazio → forget NÃO executa (EC-1, sem perda)', async () => {
    const { factory, order, forget } = mockMemory([]);
    const res = await withScope({ session: { userId: 'alice' } }, () =>
      updateMemoryHandler({ id: OLD_ID, content: 'texto que nao extrai nada' }, { memoryFactory: factory }),
    );
    expect(forget).not.toHaveBeenCalled();
    expect(order).toEqual(['remember']);
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/left intact/);
  });

  test('test_update_returns_new_id_not_old — o retorno expõe o id NOVO (contrato ADD-only)', async () => {
    const { factory } = mockMemory([{ id: 'new-id-123' }]);
    const res = await withScope({ session: { userId: 'alice' } }, () =>
      updateMemoryHandler({ id: OLD_ID, content: 'novo texto suficientemente longo' }, { memoryFactory: factory }),
    );
    expect(textOf(res)).toContain('new-id-123');
    expect(res.isError).toBe(false);
  });

  test('test_update_ignores_cross_user_id — arg extra é rejeitado pelo schema strict', async () => {
    const { factory } = mockMemory([{ id: 'new-id' }]);
    await expect(
      withScope({ session: { userId: 'alice' } }, () =>
        updateMemoryHandler({ id: OLD_ID, content: 'x'.repeat(10), user_id: 'bob' }, { memoryFactory: factory }),
      ),
    ).rejects.toThrow();
  });
});
