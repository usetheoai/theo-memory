/**
 * T1.2 RED tests — REST handlers for 4 verbs + createServer factory.
 *
 * Absorbs:
 * - EC-6 malformed JSON ⇒ 400
 * - EC-7 empty body ⇒ 422
 * - EC-9 / ADR D12 single-scope-tier enforcement via zod superRefine
 *   counting present tier keys; 0 or ≥2 ⇒ 422 `INVALID_SCOPE`
 * - EC-10 unmapped Memory errors ⇒ 500 sanitized envelope (app.onError)
 * - EC-11 empty recall results ⇒ 200 `{ results: [] }`, NOT 404
 * - EC-12 `infer: false` propagation
 *
 * @see Plan theo-memory-standalone-p0 § T1.2 + ADR D11 + D12
 * @see SEPA pre-RED iter 3 — superRefine over flat schema; StubMemory inline
 *      with `as unknown as Memory` cast; 4-branch scope dispatch.
 */
import { describe, expect, test, vi } from 'vitest';

import type { MemoryItem, MemoryItemWithScore } from '../../core/memory-item.js';
import type { Memory } from '../../core/memory-store.js';
import { createServer } from '../index.js';

const MEMORY_ITEM: MemoryItem = {
  id: '00000000-0000-4000-a000-000000000001',
  text: 'Alice likes coffee',
  hash: 'h-1',
  scope: { user_id: 'alice' },
  payload: {},
  createdAt: new Date('2026-06-03T00:00:00Z'),
  updatedAt: new Date('2026-06-03T00:00:00Z'),
} as unknown as MemoryItem;

interface StubScopedMemory {
  remember: ReturnType<typeof vi.fn>;
  recall: ReturnType<typeof vi.fn>;
  reflect: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
}

function stubScopedMemory(): StubScopedMemory {
  return {
    remember: vi.fn().mockResolvedValue([MEMORY_ITEM]),
    recall: vi.fn().mockResolvedValue([]),
    reflect: vi.fn().mockResolvedValue({ jobId: 'job-1', derivedCount: 0 }),
    getAll: vi.fn().mockResolvedValue([]),
  };
}

function stubMemory(scoped: StubScopedMemory): Memory {
  const stub = {
    user: vi.fn().mockReturnValue(scoped),
    session: vi.fn().mockReturnValue(scoped),
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn().mockReturnValue(scoped),
    forget: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    history: vi.fn().mockResolvedValue([]),
    reset: vi.fn().mockResolvedValue(undefined),
    flushReflections: vi.fn().mockResolvedValue(undefined),
  };
  return stub;
}

describe('T1.2 — POST /v1/remember', () => {
  test('1. returns 201 with memoryId on success', async () => {
    const scoped = stubScopedMemory();
    const memory = stubMemory(scoped);
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', text: 'I like coffee' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { items: MemoryItem[] };
    expect(body.items[0]?.id).toBe(MEMORY_ITEM.id);
    expect(scoped.remember).toHaveBeenCalledWith('I like coffee', expect.any(Object));
  });

  test('6. malformed JSON body returns 400 (EC-6)', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-valid-json',
      }),
    );
    expect(res.status).toBe(400);
  });

  test('7. empty body returns 422 (EC-7)', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      }),
    );
    expect(res.status).toBe(422);
  });

  test('8. zero scope tiers returns 422 INVALID_SCOPE (EC-9/D12)', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'orphan fact' }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_SCOPE');
  });

  test('9. userId AND sessionId returns 422 INVALID_SCOPE (EC-9/D12)', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', sessionId: 's1', text: 'multi-tier' }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_SCOPE');
  });

  test('10. infer:false propagates through to scoped.remember options (EC-12)', async () => {
    const scoped = stubScopedMemory();
    const memory = stubMemory(scoped);
    const app = createServer({ memory });
    await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'alice',
          text: 'verbatim fact',
          infer: false,
          attributedTo: 'bob',
        }),
      }),
    );
    expect(scoped.remember).toHaveBeenCalledWith(
      'verbatim fact',
      expect.objectContaining({ infer: false, attributedTo: 'bob' }),
    );
  });
});

describe('T1.2 — POST /v1/recall', () => {
  test('2. returns { results: [...] } shape', async () => {
    const scoped = stubScopedMemory();
    const scored = { ...MEMORY_ITEM, score: 0.95 } as unknown as MemoryItemWithScore;
    scoped.recall.mockResolvedValue([scored]);
    const memory = stubMemory(scoped);
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', query: 'beverages' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: MemoryItemWithScore[] };
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(1);
  });

  test('3. empty results return 200 with { results: [] }, NOT 404 (EC-11)', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', query: 'no-match' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: MemoryItemWithScore[] };
    expect(body.results).toEqual([]);
  });
});

describe('T1.2 — POST /v1/forget', () => {
  test('4. returns 204; memory.forget invoked with memoryId', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/forget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoryId: '00000000-0000-4000-a000-000000000001' }),
      }),
    );
    expect(res.status).toBe(204);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest/vitest mock-call assertion idiom; no `this`-binding hazard.
    const forgetMock = memory.forget;
    expect(forgetMock).toHaveBeenCalledWith(
      '00000000-0000-4000-a000-000000000001',
      undefined,
    );
  });
});

describe('T1.2 — POST /v1/reflect', () => {
  test('5. returns 202 with reflection-job id', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice' }),
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string };
    expect(typeof body.jobId).toBe('string');
  });
});

describe('T1.2 — createServer wires middleware + handles unknown errors', () => {
  test('11. wires bearer middleware when authVerifier provided', async () => {
    const memory = stubMemory(stubScopedMemory());
    const verifier = { verify: vi.fn().mockResolvedValue(true) };
    const app = createServer({ memory, authVerifier: verifier });
    process.env['THEMEMORY_API_KEY'] = 'sk-test';
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' },
        body: JSON.stringify({ userId: 'alice', text: 'authed' }),
      }),
    );
    delete process.env['THEMEMORY_API_KEY'];
    expect(verifier.verify).toHaveBeenCalledWith('sk-test');
    expect(res.status).toBe(201);
  });

  test('12. unknown error from Memory returns 500 sanitized envelope (EC-10)', async () => {
    const scoped = stubScopedMemory();
    scoped.remember.mockRejectedValue(new Error('Internal database explosion'));
    const memory = stubMemory(scoped);
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', text: 'will throw' }),
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('Internal server error');
    // Sanitized: NO raw error message leaked.
    expect(body.message).not.toContain('Internal database explosion');
  });
});
