import { describe, expect, it, vi } from 'vitest';

import type { Memory, MemoryItem, RememberOptions } from '@usetheo/memory/contract';

import { createAmlAdapter } from './aml-adapter.js';

const API_KEY = '0123456789abcdef0123456789abcdef';
const auth = { authorization: `Bearer ${API_KEY}` };

function setup() {
  const remember = vi.fn(async (_text: string, _options?: RememberOptions): Promise<readonly MemoryItem[]> => []);
  const recall = vi.fn(async () => [{
    id: 'memory-1',
    text: 'remembered fact',
    score: 0.87,
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
  }]);
  const user = vi.fn(() => ({ remember, recall }));
  const withWorkspace = vi.fn(() => ({ user }));
  const memory = { withWorkspace } as unknown as Memory;
  return { app: createAmlAdapter({ memory, workspaceId: 'aml-eval', apiKey: API_KEY }), remember, recall, user, withWorkspace };
}

describe('Agent Memory Leaderboard Add/Search adapter', () => {
  it('requires the dedicated memory-system key on both routes', async () => {
    const { app } = setup();
    const response = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'x', user_id: 'a', top_k: 10 }),
    });
    expect(response.status).toBe(401);
  });

  it('accepts the official Token authorization scheme', async () => {
    const { app } = setup();
    const response = await app.request('/search', {
      method: 'POST',
      headers: { authorization: `Token ${API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'x', user_id: 'a', top_k: 10 }),
    });
    expect(response.status).toBe(200);
  });

  it('writes ordered messages synchronously in a fixed workspace and echoes AML identifiers', async () => {
    const { app, remember, user, withWorkspace } = setup();
    const response = await app.request('/add', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'req-1',
        user_id: 'sample-A',
        session_id: 'session-1',
        messages: [
          { role: 'user', timestamp: 1_767_310_245_000, content: 'I prefer tea.' },
          { role: 'assistant', content: 'I will remember that.' },
        ],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, request_id: 'req-1', user_id: 'sample-A', session_id: 'session-1' });
    expect(withWorkspace).toHaveBeenCalledWith('aml-eval');
    expect(user).toHaveBeenCalledWith('sample-A');
    expect(remember).toHaveBeenCalledTimes(2);
    expect(remember.mock.calls[0]?.[0]).toBe('I prefer tea.');
    expect(remember.mock.calls[0]?.[1]).toMatchObject({
      infer: true,
      strictExtraction: true,
      attributedTo: 'user',
      metadata: { aml_session_id: 'session-1', aml_message_index: 0, source_timestamp_ms: 1_767_310_245_000 },
    });
    expect(remember.mock.calls[0]?.[1]?.idempotencyKey).not.toBe(remember.mock.calls[1]?.[1]?.idempotencyKey);
  });

  it('returns relevance-ordered memory records and never generates an answer', async () => {
    const { app, recall, user } = setup();
    const response = await app.request('/search', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'What tea?', options: ['A. green', 'B. black'], user_id: 'sample-A', top_k: 100 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{
      id: 'memory-1', content: 'remembered fact', score: 0.87, created_at: '2026-01-02T03:04:05.000Z',
    }] });
    expect(user).toHaveBeenCalledWith('sample-A');
    expect(recall).toHaveBeenCalledWith('What tea?\nOptions:\nA. green\nB. black', { topK: 100 });
  });

  it('never returns more results than the requested top_k', async () => {
    const { app, recall } = setup();
    recall.mockResolvedValueOnce(Array.from({ length: 3 }, (_, index) => ({
      id: `memory-${String(index)}`,
      text: `fact-${String(index)}`,
      score: 1 - index / 10,
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    })));
    const response = await app.request('/search', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'x', user_id: 'sample-A', top_k: 1 }),
    });
    expect(response.status).toBe(200);
    expect((await response.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  it('rejects malformed payloads and excessive top_k', async () => {
    const { app, remember } = setup();
    const response = await app.request('/search', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'x', user_id: 'sample-A', top_k: 101 }),
    });
    expect(response.status).toBe(422);
    expect(remember).not.toHaveBeenCalled();
  });

  it('rejects Add chunks larger than the official 20-message limit', async () => {
    const { app, remember } = setup();
    const response = await app.request('/add', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'req-too-many', user_id: 'sample-A', session_id: 'session-1',
        messages: Array.from({ length: 21 }, () => ({ role: 'user', content: 'fact' })),
      }),
    });
    expect(response.status).toBe(422);
    expect(remember).not.toHaveBeenCalled();
  });

  it('does not return success after an incomplete Add', async () => {
    const { app, remember } = setup();
    remember.mockRejectedValueOnce(new Error('sensitive provider error'));
    const response = await app.request('/add', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'req-fail', user_id: 'sample-A', session_id: 'session-1',
        messages: [{ role: 'user', content: 'private content' }],
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ detail: { reason: 'add_failed' } });
  });

  it('logs why an Add failed on the server, without the message text (#231)', async () => {
    const { app, remember } = setup();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dbError = Object.assign(new Error('Key (workspace_id)=(secret-ws) is not present'), {
      code: '23503', constraint: 'memory_write_receipts_workspace_id_fkey',
    });
    remember.mockRejectedValueOnce(new Error('Memory persistence was incomplete', { cause: dbError }));
    const response = await app.request('/add', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'req-log', user_id: 'sample-A', session_id: 'session-1',
        messages: [{ role: 'user', content: 'private content' }],
      }),
    });
    expect(response.status).toBe(503);
    const logged = log.mock.calls.map((call) => call.join(' ')).join('\n');
    log.mockRestore();
    expect(logged).toContain('23503');
    expect(logged).toContain('memory_write_receipts_workspace_id_fkey');
    expect(logged).not.toContain('secret-ws');
    expect(logged).not.toContain('private content');
  });

  it('rejects Memory implementations without explicit workspace binding', () => {
    expect(() => createAmlAdapter({ memory: {} as Memory, workspaceId: 'aml-eval', apiKey: API_KEY }))
      .toThrow('workspace-capable');
  });
});
