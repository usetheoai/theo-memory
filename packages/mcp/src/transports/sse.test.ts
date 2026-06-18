/**
 * SSE transport unit tests — OpenMemory compat (plan T1.1).
 *
 * Covers the localhost-without-TLS guard + route handling (unknown path → 404,
 * unknown SSE session → 404) without needing pgvector or a real Memory.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { McpServer } from '../server.js';
import { connectSse, type SseHandle } from './sse.js';

const serverFactory = (): McpServer => new McpServer({ toolset: 'openmemory' });

let handle: SseHandle | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe('connectSse — transport hygiene + routing (T1.1)', () => {
  it('refuses a non-localhost host without TLS (ADR-0015 guard)', async () => {
    await expect(connectSse({ host: '0.0.0.0', port: 0, serverFactory })).rejects.toThrow(/non-localhost/i);
  });

  it('accepts localhost and returns a resolved port', async () => {
    handle = await connectSse({ host: '127.0.0.1', port: 0, serverFactory });
    expect(handle.port).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown path', async () => {
    handle = await connectSse({ host: '127.0.0.1', port: 0, serverFactory });
    const res = await fetch(`http://127.0.0.1:${String(handle.port)}/nope`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a POST to an unknown SSE session', async () => {
    handle = await connectSse({ host: '127.0.0.1', port: 0, serverFactory });
    const res = await fetch(
      `http://127.0.0.1:${String(handle.port)}/cursor/sse/alice/messages/?sessionId=does-not-exist`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    expect(res.status).toBe(404);
  });
});
