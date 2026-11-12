import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

const SOURCE = { id: 's1', role: 'user', content: 'I took my sister to the pottery class', observedAt: new Date('2023-07-23T18:46:00Z'), loggedAt: new Date('2026-11-07T10:00:00Z') };

function recordingMemory(): { memory: Memory; recall: ReturnType<typeof vi.fn> } {
  const recall = vi.fn(async () => [{ id: 'm1', text: 'fact', score: 0.9, sources: [SOURCE] }]);
  const scoped = { recall };
  const memory = {
    withWorkspace: vi.fn(() => ({ user: vi.fn(() => scoped) }) as unknown as Memory),
    user: vi.fn(() => scoped),
    session: vi.fn(),
    agent: vi.fn(),
  } as unknown as Memory;
  return { memory, recall };
}

async function post(app: ReturnType<typeof createServer>, body: unknown): Promise<Response> {
  return app.fetch(new Request('http://localhost/v1/recall', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

describe('POST /v1/recall includeSources', () => {
  test('asks the SDK for sources and returns them with each result', async () => {
    const { memory, recall } = recordingMemory();
    const res = await post(createServer({ memory }), { userId: 'u', query: 'pottery', includeSources: true });
    expect(res.status).toBe(200);
    expect(recall.mock.calls[0]?.[1]).toMatchObject({ includeSources: true });
    const body = (await res.json()) as { results: { sources: { content: string; observedAt: string }[] }[] };
    expect(body.results[0]?.sources[0]).toMatchObject({ content: SOURCE.content, observedAt: '2023-07-23T18:46:00.000Z' });
  });

  test('does not ask for sources when the field is omitted', async () => {
    const { memory, recall } = recordingMemory();
    await post(createServer({ memory }), { userId: 'u', query: 'pottery' });
    const options = recall.mock.calls[0]?.[1] as { includeSources?: boolean } | undefined;
    expect(options?.includeSources).toBeUndefined();
  });

  test('rejects a non-boolean includeSources', async () => {
    const { memory } = recordingMemory();
    const res = await post(createServer({ memory }), { userId: 'u', query: 'pottery', includeSources: 'yes' });
    expect(res.status).toBe(422);
  });
});
