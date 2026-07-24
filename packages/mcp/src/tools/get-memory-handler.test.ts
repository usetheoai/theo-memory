/**
 * `get_memory` handler tests (M14 T2.1) — reuse of Memory.get through the Principal scope.
 *
 * @see ADR-M14-1 — the arg carries only `id`; isolation is by construction (scope = Principal)
 */
import { describe, expect, test, vi } from 'vitest';

import { withScope } from '@usetheo/memory-agent-core';

import { getMemoryHandler } from './get-memory-handler.js';

const VALID_ID = '00000000-0000-4000-8000-000000000001';

/** Extract the first text block from a CallToolResult (narrowing the content union). */
function textOf(res: { content: readonly unknown[] }): string {
  const first = res.content[0] as { type?: string; text?: string } | undefined;
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '';
}

function memoryFactoryReturning(item: unknown) {
  const get = vi.fn(async () => item);
  // workspaceScopedMemory wraps this Memory; get is the only method exercised here.
  const memory = { get } as unknown as Parameters<typeof getMemoryHandler>[1]['memoryFactory'] extends () => infer M ? M : never;
  return { factory: () => memory as never, get };
}

describe('getMemoryHandler (T2.1)', () => {
  test('test_get_memory_returns_item — id válido retorna o MemoryItem', async () => {
    const { factory, get } = memoryFactoryReturning({ id: VALID_ID, text: 'fato' });
    const res = await withScope({ session: { userId: 'alice' } }, () =>
      getMemoryHandler({ id: VALID_ID }, { memoryFactory: factory }),
    );
    expect(get).toHaveBeenCalledWith(VALID_ID);
    expect(res.isError).toBe(false);
    expect(textOf(res)).toContain(VALID_ID);
  });

  test('test_get_memory_not_found_returns_null_result — id inexistente → resultado vazio, não erro', async () => {
    const { factory } = memoryFactoryReturning(null);
    const res = await withScope({ session: { userId: 'alice' } }, () =>
      getMemoryHandler({ id: VALID_ID }, { memoryFactory: factory }),
    );
    expect(res.isError).toBe(false);
    expect(textOf(res)).toMatch(/No memory found/);
  });

  test('test_get_memory_ignores_user_id_arg — arg extra (user_id) é rejeitado pelo schema strict (ADR-M14-1)', async () => {
    const { factory } = memoryFactoryReturning({ id: VALID_ID, text: 'fato' });
    await expect(
      withScope({ session: { userId: 'alice' } }, () =>
        getMemoryHandler({ id: VALID_ID, user_id: 'bob' } as unknown, { memoryFactory: factory }),
      ),
    ).rejects.toThrow(); // strict schema → user_id não é aceito; o scope vem do Principal, não do arg
  });
});
