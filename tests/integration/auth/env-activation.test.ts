/**
 * T1.1 of red-team-full-system-fixes-cycle-1 — integration test verifying that
 * THEMEMORY_API_KEY env activation enforces bearer auth on verb routes while
 * keeping health endpoints exempt.
 *
 * F1 root cause: `readApiKey()` returns undefined when env is unset → middleware
 * passes through (alpha mode). This test pins the enforcement contract by
 * setting the env to a known value and asserting 401/200 behavior.
 *
 * @see src/server/auth/middleware.ts:32-36 (alpha mode passthrough)
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import type { Embedder } from '@usetheo/memory';
import { DeterministicStubLLM } from '@usetheo/memory/llms/stub';
import { createLocalMemory } from '@usetheo/memory';
import { InMemoryVectorStore } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';

const TEST_API_KEY = 'test-secret-key-for-auth-activation';

const StubEmbedder: Embedder = {
  embed: async () => {
    const v = new Array<number>(1536).fill(0);
    v[0] = 1;
    return v;
  },
  embedBatch: async (texts) => texts.map(() => {
    const v = new Array<number>(1536).fill(0);
    v[0] = 1;
    return v;
  }),
};

describe('T1.1 — THEMEMORY_API_KEY env activation enforces bearer auth', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    // Set the env var BEFORE creating the server — readApiKey() reads at
    // middleware invocation time, so the env must be present when requests arrive.
    vi.stubEnv('THEMEMORY_API_KEY', TEST_API_KEY);

    const store = new InMemoryVectorStore();
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: StubEmbedder,
      llm: new DeterministicStubLLM(),
    });
    app = createServer({ memory });
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  test('POST /v1/remember without Bearer returns 401 when THEMEMORY_API_KEY is set', async () => {
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', text: 'test', infer: false }),
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHORIZED');
  });

  test('POST /v1/remember with correct Bearer returns non-401 when THEMEMORY_API_KEY is set', async () => {
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({ userId: 'alice', text: 'auth test', infer: false }),
      }),
    );
    // Should be 201 (created) or at worst 422/400 — but NOT 401
    expect(res.status).not.toBe(401);
  });

  test('POST /v1/remember with WRONG Bearer returns 401', async () => {
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer wrong-token-xyz',
        },
        body: JSON.stringify({ userId: 'alice', text: 'test', infer: false }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test('GET /v1/health returns 200 regardless of auth (health is exempt)', async () => {
    // Without any auth header
    const res = await app.fetch(new Request('http://localhost/v1/health'));
    expect(res.status).toBe(200);
  });

  test('GET /v1/health/db returns non-401 regardless of auth (health/db is exempt)', async () => {
    const res = await app.fetch(new Request('http://localhost/v1/health/db'));
    // 503 (no probe) or 200 — but NOT 401
    expect(res.status).not.toBe(401);
  });
});
