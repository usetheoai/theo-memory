/**
 * THE GOAL TEST — OpenMemory MCP-shape compatibility (Roadmap Item 26, plan T3.1).
 *
 * Drives a REAL `@modelcontextprotocol/sdk` MCP client over the SSE endpoint
 * against real pgvector, proving the drop-in works end-to-end:
 *   - `tools/list` returns exactly the 4 OpenMemory names;
 *   - `add_memories` → `search_memory` round-trips the stored memory;
 *   - `delete_memories` removes it;
 *   - a second `user_id` cannot see the first user's memory (per-user isolation).
 *
 * `infer: false` stores verbatim (no LLM) so the assertion is deterministic with
 * the stub embedder (identical text → cosine 1.0).
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

import { createLocalMemory, PgvectorStore } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';
import type { LLM, LLMResponse, Memory, Message } from '@usetheo/memory';
import { McpServer, connectSse, type SseHandle } from '@usetheo/memory-mcp';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const emptyJsonLlm: LLM = {
  generateResponse: () => Promise.resolve('[]'),
  generateChat: (_m: readonly Message[]): Promise<LLMResponse> =>
    Promise.resolve({ content: '[]', role: 'assistant' }),
};

/** Raw text content an OpenMemory tool returns (used for `"Error: …"` results). */
function parseToolTextRaw(result: { content?: unknown }): string {
  const content = result.content as { type: string; text?: string }[] | undefined;
  return content?.[0]?.text ?? '';
}

/** Parse the JSON-string text content an OpenMemory tool returns. */
function parseToolText(result: { content?: unknown }): unknown {
  return JSON.parse(parseToolTextRaw(result));
}

async function connectClient(baseUrl: string, clientName: string, userId: string): Promise<Client> {
  const transport = new SSEClientTransport(new URL(`${baseUrl}/${clientName}/sse/${userId}`));
  const client = new Client({ name: `test-${clientName}`, version: '0.0.0' });
  await client.connect(transport);
  return client;
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('OpenMemory MCP compat GOAL TEST (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('THE GOAL TEST — OpenMemory MCP compat over SSE (real client + pgvector)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let memory: Memory;
    let sse: SseHandle;
    let baseUrl: string;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.poolPinnedTo('default');
      dropDb = iso.dropDb;
      memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: emptyJsonLlm,
      });
      sse = await connectSse({
        host: '127.0.0.1',
        port: 0,
        serverFactory: () => new McpServer({ memoryFactory: () => memory, toolset: 'openmemory' }),
      });
      baseUrl = `http://127.0.0.1:${String(sse.port)}`;
    }, 30_000);

    afterAll(async () => {
      await sse.close();
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query('DELETE FROM memories');
    });

    test('tools/list returns exactly the 4 OpenMemory tool names', async () => {
      const client = await connectClient(baseUrl, 'cursor', `u-${randomUUID()}`);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual(
          ['add_memories', 'delete_memories', 'list_memories', 'search_memory'],
        );
      } finally {
        await client.close();
      }
    });

    test('add_memories → search_memory round-trips, then delete_memories removes it', async () => {
      const user = `alice-${randomUUID()}`;
      const client = await connectClient(baseUrl, 'cursor', user);
      try {
        const secret = 'the launch code is hunter2';
        const added = parseToolText(
          await client.callTool({ name: 'add_memories', arguments: { text: secret, infer: false } }),
        ) as { added: number; ids: string[] };
        expect(added.added).toBe(1);
        expect(added.ids).toHaveLength(1);

        const found = parseToolText(
          await client.callTool({ name: 'search_memory', arguments: { query: secret } }),
        ) as { id: string; memory: string }[];
        expect(found.length).toBeGreaterThanOrEqual(1);
        expect(found.some((m) => m.memory === secret)).toBe(true);

        const del = parseToolText(
          await client.callTool({ name: 'delete_memories', arguments: { memory_ids: [added.ids[0]] } }),
        ) as { deleted: string[] };
        expect(del.deleted).toEqual([added.ids[0]]);

        const afterDelete = parseToolText(
          await client.callTool({ name: 'search_memory', arguments: { query: secret } }),
        ) as unknown[];
        expect(afterDelete).toHaveLength(0);

        // list_memories must ALSO exclude the deleted memory (getAll/list parity
        // with recall — a forgotten memory must not reappear in any listing).
        const listAfterDelete = parseToolText(
          await client.callTool({ name: 'list_memories', arguments: {} }),
        ) as unknown[];
        expect(listAfterDelete).toHaveLength(0);
      } finally {
        await client.close();
      }
    });

    test('per-user isolation: user B cannot see user A memory (parallel clients)', async () => {
      const userA = `alice-${randomUUID()}`;
      const userB = `bob-${randomUUID()}`;
      const [a, b] = await Promise.all([
        connectClient(baseUrl, 'cursor', userA),
        connectClient(baseUrl, 'claude', userB),
      ]);
      try {
        const secret = 'alice private note about billing';
        await a.callTool({ name: 'add_memories', arguments: { text: secret, infer: false } });

        const aFound = parseToolText(
          await a.callTool({ name: 'search_memory', arguments: { query: secret } }),
        ) as unknown[];
        expect(aFound.length).toBeGreaterThanOrEqual(1);

        const bFound = parseToolText(
          await b.callTool({ name: 'search_memory', arguments: { query: secret } }),
        ) as unknown[];
        expect(bFound).toHaveLength(0);
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    });

    test('per-user isolation: user B cannot DELETE user A memory by id (IDOR guard)', async () => {
      const userA = `alice-${randomUUID()}`;
      const userB = `bob-${randomUUID()}`;
      const [a, b] = await Promise.all([
        connectClient(baseUrl, 'cursor', userA),
        connectClient(baseUrl, 'claude', userB),
      ]);
      try {
        const secret = 'alice private note that bob must not delete';
        const added = parseToolText(
          await a.callTool({ name: 'add_memories', arguments: { text: secret, infer: false } }),
        ) as { ids: string[] };
        const aliceId = added.ids[0];

        // Bob attempts to delete Alice's memory by its id — must be refused.
        const bobDelete = await b.callTool({
          name: 'delete_memories',
          arguments: { memory_ids: [aliceId] },
        });
        expect(bobDelete.isError).toBe(true);
        expect(parseToolTextRaw(bobDelete)).toMatch(/No accessible memories/);

        // Alice's memory survives Bob's attempt.
        const aStillFound = parseToolText(
          await a.callTool({ name: 'search_memory', arguments: { query: secret } }),
        ) as unknown[];
        expect(aStillFound.length).toBeGreaterThanOrEqual(1);
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    });
  });
}
