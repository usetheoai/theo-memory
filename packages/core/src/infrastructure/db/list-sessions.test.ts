/**
 * Session enumeration unit tests (session-separation fix 2026-07-23):
 * `InMemoryVectorStore.listSessions` aggregates distinct session_id under the
 * `(workspace, user)` anchor — live counts + newest-activity ordering — and
 * global rows (session_id NULL) never appear.
 */
import { describe, expect, test } from 'vitest';

import { InMemoryVectorStore } from './in-memory-store.js';

const vec = [0.1, 0.2, 0.3];

async function seed(
  store: InMemoryVectorStore,
  id: string,
  payload: Record<string, string | number | boolean | null>,
): Promise<void> {
  await store.insert([vec], [id], [payload]);
}

describe('InMemoryVectorStore.listSessions', () => {
  test('aggregates per session, excludes global rows, orders by newest activity', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, 'g1', { text: 'global', user_id: 'alice', workspace_id: 'ws1' });
    await seed(store, 'a1', { text: 's-a #1', user_id: 'alice', session_id: 's-a', workspace_id: 'ws1' });
    await seed(store, 'a2', { text: 's-a #2', user_id: 'alice', session_id: 's-a', workspace_id: 'ws1' });
    await seed(store, 'b1', { text: 's-b #1', user_id: 'alice', session_id: 's-b', workspace_id: 'ws1' });

    const sessions = await store.listSessions({ workspace_id: 'ws1', user_id: 'alice' });

    expect(sessions.map((s) => s.sessionId).sort()).toEqual(['s-a', 's-b']);
    expect(sessions.find((s) => s.sessionId === 's-a')?.memoryCount).toBe(2);
    expect(sessions.find((s) => s.sessionId === 's-b')?.memoryCount).toBe(1);
  });

  test('cross-user and cross-workspace sessions are invisible', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, 'x1', { text: 'other user', user_id: 'bob', session_id: 's-bob', workspace_id: 'ws1' });
    await seed(store, 'x2', { text: 'other ws', user_id: 'alice', session_id: 's-ws2', workspace_id: 'ws2' });

    const sessions = await store.listSessions({ workspace_id: 'ws1', user_id: 'alice' });

    expect(sessions).toHaveLength(0);
  });
});
