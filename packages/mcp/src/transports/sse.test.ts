/**
 * SSE transport unit tests — OpenMemory compat (plan T1.1).
 *
 * Covers the localhost-without-TLS guard + route handling (unknown path → 404,
 * unknown SSE session → 404) without needing pgvector or a real Memory.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Memory, MemoryItem, ScopedMemory } from '@usetheo/memory/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

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

describe('connectSse — scope binding + POST routing (T1.1, real MCP client, no pg)', () => {
  const FIXED = new Date('2026-06-18T12:00:00.000Z');

  /** A Memory whose `.user(id)` records the id and returns a stub ScopedMemory. */
  function trackedMemory(): { memory: Memory; lastUserId: () => string | undefined } {
    let lastUserId: string | undefined;
    const scoped = mock<ScopedMemory>();
    const item: MemoryItem = {
      id: 'm1', text: 't', hash: 'h', scope: { kind: 'user', userId: 'x' },
      createdAt: FIXED, updatedAt: FIXED, metadata: {}, tValid: FIXED, tInvalid: null,
    };
    vi.mocked(scoped.remember).mockResolvedValue([item]);
    const memory = mock<Memory>();
    vi.mocked(memory.user).mockImplementation((id: string) => {
      lastUserId = id;
      return scoped;
    });
    return { memory, lastUserId: () => lastUserId };
  }

  async function connect(port: number, client: string, user: string): Promise<Client> {
    const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${String(port)}/${client}/sse/${user}`));
    const c = new Client({ name: `test-${client}`, version: '0.0.0' });
    await c.connect(transport);
    return c;
  }

  it('binds the path user id so a tool call resolves memory.user(<user>) over the SSE POST route', async () => {
    const { memory, lastUserId } = trackedMemory();
    handle = await connectSse({
      host: '127.0.0.1',
      port: 0,
      serverFactory: () => new McpServer({ memoryFactory: () => memory, toolset: 'openmemory' }),
    });
    const client = await connect(handle.port, 'cursor', 'alice-42');
    try {
      // tools/list proves the GET stream + POST message route round-trip.
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(
        ['add_memories', 'delete_memories', 'list_memories', 'search_memory'],
      );

      // A tools/call proves the path user id reaches memory.user via withScope.
      await client.callTool({ name: 'add_memories', arguments: { text: 'hi', infer: false } });
      expect(lastUserId()).toBe('alice-42');
    } finally {
      await client.close();
    }
  });
});
