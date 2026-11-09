import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { rememberHandler } from './remember-handler.js';

function memoryRecordingRemember() {
  const scoped = mock<ScopedMemory>();
  vi.mocked(scoped.remember).mockResolvedValue([{ id: 'm1' }] as never);
  const memory = mock<Memory>();
  vi.mocked(memory.user).mockReturnValue(scoped);
  (memory as { withWorkspace?: unknown }).withWorkspace = undefined;
  return { factory: () => memory, remember: scoped.remember };
}

describe('remember tool observedAt', () => {
  test('passes the observation time to the SDK as a Date', async () => {
    const { factory, remember } = memoryRecordingRemember();
    await withScope({ session: { userId: 'alice' } }, () =>
      rememberHandler({ content: 'I moved to Lisbon last month', observedAt: '2023-05-08T13:56:00Z' }, { memoryFactory: factory }),
    );
    expect(vi.mocked(remember).mock.calls[0]?.[1]).toMatchObject({ observedAt: new Date('2023-05-08T13:56:00Z') });
  });

  test('rejects an observation time that is not an ISO-8601 date-time', async () => {
    const { factory } = memoryRecordingRemember();
    await expect(withScope({ session: { userId: 'alice' } }, () =>
      rememberHandler({ content: 'x', observedAt: 'last week' }, { memoryFactory: factory }),
    )).rejects.toThrow();
  });
});
