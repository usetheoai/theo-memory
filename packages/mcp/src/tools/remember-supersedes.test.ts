import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { rememberHandler } from './remember-handler.js';

function memoryReturning(items: unknown[]) {
  const scoped = mock<ScopedMemory>();
  vi.mocked(scoped.remember).mockResolvedValue(items as never);
  const memory = mock<Memory>();
  vi.mocked(memory.user).mockReturnValue(scoped);
  (memory as { withWorkspace?: unknown }).withWorkspace = undefined;
  return () => memory;
}

const text = (result: { content: unknown }): string => (result.content as { text: string }[])[0]?.text ?? '';

describe('remember tool supersession report', () => {
  test('names the earlier memories the write replaced', async () => {
    const result = await withScope({ session: { userId: 'alice' } }, () =>
      rememberHandler({ content: 'I moved to Lisbon' }, { memoryFactory: memoryReturning([{ id: 'm2', supersedes: ['m1'] }]) }));
    expect(text(result)).toContain('Persisted 1 memory item: m2');
    expect(text(result)).toContain('Replaced 1 earlier memory: m1');
  });

  test('says nothing about replacement when nothing was replaced', async () => {
    const result = await withScope({ session: { userId: 'alice' } }, () =>
      rememberHandler({ content: 'I like tea' }, { memoryFactory: memoryReturning([{ id: 'm1' }]) }));
    expect(text(result)).toBe('Persisted 1 memory item: m1');
  });
});
