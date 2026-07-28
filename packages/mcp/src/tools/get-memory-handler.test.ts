/**
 * `get_memory` handler tests (M14 T2.1) — reuse of Memory.get through the Principal scope.
 *
 * @see ADR-M14-1 — the arg carries only `id`; isolation is by construction (scope = Principal)
 */
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, test, vi } from 'vitest';


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

/** Invoke the handler with a canned `get` result under a given scope (DRY across cases). */
function callGet(item: unknown, ctx: Parameters<typeof withScope>[0], args: unknown = { id: VALID_ID }) {
  const { factory, get } = memoryFactoryReturning(item);
  const run = withScope(ctx, () => getMemoryHandler(args, { memoryFactory: factory }));
  return { run, get };
}

const AS_ALICE = { session: { userId: 'alice' } } as const;

/** Assert a resolved handler result is the non-error "No memory found" response. */
async function expectNotFound(run: ReturnType<typeof getMemoryHandler>) {
  const res = await run;
  expect(res.isError).toBe(false);
  expect(textOf(res)).toMatch(/No memory found/);
}

describe('getMemoryHandler (T2.1)', () => {
  test('test_get_memory_returns_item — id válido do PRÓPRIO user retorna o MemoryItem', async () => {
    const { run, get } = callGet({ id: VALID_ID, text: 'fato', metadata: { user_id: 'alice' } }, AS_ALICE);
    const res = await run;
    expect(get).toHaveBeenCalledWith(VALID_ID);
    expect(res.isError).toBe(false);
    expect(textOf(res)).toContain(VALID_ID);
  });

  test('test_get_memory_cross_user_hidden — item de OUTRO user no mesmo workspace → No memory found (M14 Phase 5 gate)', async () => {
    // The core already blocks cross-tenant; the handler blocks cross-USER (DoD bullet 6).
    const { run } = callGet({ id: VALID_ID, text: 'segredo de bob', metadata: { user_id: 'bob' } }, AS_ALICE);
    await expectNotFound(run);
  });

  test('test_get_memory_requires_user_scope — sem user no Principal → MissingScopeError', async () => {
    const { run } = callGet({ id: VALID_ID, text: 'x', metadata: { user_id: 'alice' } }, { workspaceId: 'tn-A' });
    await expect(run).rejects.toThrow();
  });

  test('test_get_memory_not_found_returns_null_result — id inexistente → resultado vazio, não erro', async () => {
    const { run } = callGet(null, AS_ALICE);
    await expectNotFound(run);
  });

  test('test_get_memory_ignores_user_id_arg — arg extra (user_id) é rejeitado pelo schema strict (ADR-M14-1)', async () => {
    const { run } = callGet({ id: VALID_ID, text: 'fato', metadata: { user_id: 'alice' } }, AS_ALICE, {
      id: VALID_ID,
      user_id: 'bob',
    });
    await expect(run).rejects.toThrow(); // strict schema → user_id não é aceito; o scope vem do Principal, não do arg
  });
});
