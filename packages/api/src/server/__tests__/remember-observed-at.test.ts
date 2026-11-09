import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

function recordingMemory(): { memory: Memory; remember: ReturnType<typeof vi.fn> } {
  const remember = vi.fn(async () => [{ id: 'm1', rejectedAsDuplicate: false }]);
  const scoped = { remember };
  const memory = {
    withWorkspace: vi.fn(() => ({ user: vi.fn(() => scoped) }) as unknown as Memory),
    user: vi.fn(() => scoped),
    session: vi.fn(),
    agent: vi.fn(),
  } as unknown as Memory;
  return { memory, remember };
}

async function post(app: ReturnType<typeof createServer>, path: string, body: unknown): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('POST /v1/remember observedAt', () => {
  test('passes the observation time to the SDK as a Date', async () => {
    const { memory, remember } = recordingMemory();
    const res = await post(createServer({ memory }), '/v1/remember', {
      userId: 'u', text: 'I moved last month', observedAt: '2023-05-08T13:56:00Z',
    });
    expect(res.status).toBe(201);
    expect(remember.mock.calls[0]?.[1]).toMatchObject({ observedAt: new Date('2023-05-08T13:56:00Z') });
  });

  test('rejects an observation time that is not an ISO-8601 date-time', async () => {
    const { memory } = recordingMemory();
    const res = await post(createServer({ memory }), '/v1/remember', { userId: 'u', text: 'x', observedAt: 'last week' });
    expect(res.status).toBe(422);
  });

  test('batch items carry their own observation time', async () => {
    const { memory, remember } = recordingMemory();
    const res = await post(createServer({ memory }), '/v1/remember/batch', {
      items: [{ userId: 'u', text: 'a', infer: false, observedAt: '2023-05-08T13:56:00Z' }],
    });
    expect(res.status).toBe(201);
    expect(remember.mock.calls[0]?.[1]).toMatchObject({ observedAt: new Date('2023-05-08T13:56:00Z') });
  });
});
