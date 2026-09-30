/**
 * The server's boot path, over the pool the server actually hands the stores.
 *
 * `run-server.ts` wraps its pool in `tenantScopedPool` and then warms the Memory
 * factory with `wireMemoryFromPool(pool)` — at boot, where no request exists and
 * therefore no workspace scope does either. The scoped pool refuses any
 * connection outside a scope (by design: a statement with no tenant context is a
 * wiring bug, not a fallback). So anything on the warm path that touches the
 * pool kills the boot: #225 measured exactly that on a live deployment, and the
 * process exited 1 into CrashLoopBackOff.
 *
 * Nothing caught it because every existing test of this path replaced the part
 * that fails: `run-server.test.ts` mocks `tenantScopedPool` as the identity and
 * the whole `@usetheo/memory` barrel, `agent-tools-memory.test.ts` mocks
 * `createLocalMemory` and `PgvectorStore`, and the subprocess e2e boots `mcp`,
 * which uses a raw pool. This file keeps the REAL `tenantScopedPool`,
 * `createLocalMemory` and `PgvectorStore`, and mocks only the network-bound
 * providers.
 *
 * The raw pool is a fake on purpose: the assertion is that the boot never asks
 * the scoped pool for a connection at all, so no database is needed to prove it
 * — and a real one would only add a second way for the test to pass or fail.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Pool } from 'pg';
import { requireStrictWorkspaceWrites, tenantScopedPool } from '@usetheo/memory';

import { wireMemoryFromPool } from '../agent-tools-memory.js';

vi.mock('@usetheo/memory/embedders/openai', () => ({
  OpenAIEmbedder: class {
    embed(): Promise<number[]> {
      return Promise.resolve(Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)));
    }
    embedBatch(texts: readonly string[]): Promise<number[][]> {
      return Promise.all(texts.map(() => this.embed()));
    }
  },
}));

vi.mock('@usetheo/memory/llms/openai', () => ({
  OpenAILLM: class {},
}));

/** A raw pool that records every connection it is asked for. */
function recordingRawPool(): { pool: Pool; connects: () => number } {
  let count = 0;
  const client = {
    query: vi.fn(async () => ({ rows: [{ reg: 'recall_traces' }] })),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => {
      count += 1;
      return client;
    }),
    query: vi.fn(async () => ({ rows: [] })),
    end: vi.fn(async () => undefined),
  } as unknown as Pool;
  return { pool, connects: () => count };
}

const ENV_KEYS = ['THEOMEM_EMBEDDER', 'THEOMEM_RECALL_TRACE', 'THEOMEM_SKILL_EXECUTION'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) saved[key] = value;
    delete process.env[key];
  }
  process.env['THEOMEM_EMBEDDER'] = 'openai';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
    const value = saved[key];
    if (value !== undefined) process.env[key] = value;
    delete saved[key];
  }
});

describe('server boot over the tenant-scoped pool, outside any workspace scope', () => {
  test('the Memory factory warms without asking the scoped pool for a connection', async () => {
    const raw = recordingRawPool();

    const memory = await wireMemoryFromPool(tenantScopedPool(raw.pool));

    expect(memory).toBeDefined();
    expect(raw.connects()).toBe(0);
    expect(() => requireStrictWorkspaceWrites()).not.toThrow();
  });

  test('the Memory factory warms with recall tracing enabled', async () => {
    process.env['THEOMEM_RECALL_TRACE'] = 'true';
    const raw = recordingRawPool();

    const memory = await wireMemoryFromPool(tenantScopedPool(raw.pool));

    expect(memory).toBeDefined();
    expect(raw.connects()).toBe(0);
  });
});
