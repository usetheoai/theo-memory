import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, test, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { recallHandler } from './recall-handler.js';
import { OUTPUT_SCHEMA } from './recall-schema.js';

const HIT = {
  id: 'm1', text: 'fact', score: 0.9, scope: { kind: 'user', userId: 'alice' }, createdAt: new Date('2026-11-07T10:00:00Z'), metadata: {},
  sources: [{ id: 's1', role: 'user', content: 'I took my sister to the pottery class', observedAt: new Date('2023-07-23T18:46:00Z'), loggedAt: new Date('2026-11-07T10:00:00Z') }],
};

function memoryRecordingRecall() {
  const scoped = mock<ScopedMemory>();
  vi.mocked(scoped.recall).mockResolvedValue([HIT] as never);
  const memory = mock<Memory>();
  vi.mocked(memory.user).mockReturnValue(scoped);
  (memory as { withWorkspace?: unknown }).withWorkspace = undefined;
  return { factory: () => memory, recall: scoped.recall };
}

describe('recall tool includeSources', () => {
  test('asks for sources and returns the source messages with each result', async () => {
    const { factory, recall } = memoryRecordingRecall();
    const out = await withScope({ session: { userId: 'alice' } }, () =>
      recallHandler({ query: 'pottery', includeSources: true }, { memoryFactory: factory }));
    expect(vi.mocked(recall).mock.calls[0]?.[1]).toMatchObject({ includeSources: true });
    const parsed = OUTPUT_SCHEMA.parse(out.structuredContent);
    expect(parsed.results[0]?.sources).toEqual([
      { role: 'user', content: 'I took my sister to the pottery class', observedAt: '2023-07-23T18:46:00.000Z' },
    ]);
  });

  test('leaves sources out when not asked', async () => {
    const { factory, recall } = memoryRecordingRecall();
    vi.mocked(recall).mockResolvedValue([{ ...HIT, sources: undefined }] as never);
    const out = await withScope({ session: { userId: 'alice' } }, () =>
      recallHandler({ query: 'pottery' }, { memoryFactory: factory }));
    expect(vi.mocked(recall).mock.calls[0]?.[1]).not.toHaveProperty('includeSources');
    expect(OUTPUT_SCHEMA.parse(out.structuredContent).results[0]).not.toHaveProperty('sources');
  });
});
