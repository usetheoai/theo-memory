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

import type { MemoryItem, MemoryItemWithScore } from '@usetheo/memory/contract';
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

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
    listSkillsBySubject: vi.fn().mockResolvedValue({ skills: [], total: 0 }),  };
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

  test('T2.1 — response envelope includes a UUID recallId passed through to recall()', async () => {
    const scoped = stubScopedMemory();
    const memory = stubMemory(scoped);
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', query: 'q' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; recallId?: string };
    expect(body.recallId).toMatch(/^[0-9a-f-]{36}$/);
    // the same id the handler returns is the one it drove the trace with (S2 D2)
    expect(scoped.recall).toHaveBeenCalledWith(
      'q',
      expect.objectContaining({ recallId: body.recallId }),
    );
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
    const body = (await res.json()) as { results: MemoryItemWithScore[]; recallId?: string };
    expect(body.results).toEqual([]);
    // S2 D2 — the recallId is returned even on the empty-results path (/review F-xval-4).
    expect(body.recallId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('T4.1 — a recall-trace store error surfaces as 500, NOT a masked 404', async () => {
    const store = {
      record: async () => {},
      getByRecallId: async () => {
        throw new Error('db down');
      },
    };
    const app = createServer({ memory: stubMemory(stubScopedMemory()), recallTraceStore: store });
    const res = await app.fetch(new Request('http://localhost/v1/recall-traces/some-id'));
    expect(res.status).toBe(500);
  });

  // rest-graph-aware-recall T1.2 — graphExpand opt-in mapping.
  test('graphExpand is passed through to scoped.recall (REST → SDK mapping)', async () => {
    const scoped = stubScopedMemory();
    const memory = stubMemory(scoped);
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', query: 'q', graphExpand: { hops: 2, limit: 5 } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(scoped.recall).toHaveBeenCalledWith(
      'q',
      expect.objectContaining({ graphExpand: { hops: 2, limit: 5 } }),
    );
  });

  test('default (no graphExpand) ⇒ option passed as undefined (byte-unchanged)', async () => {
    const scoped = stubScopedMemory();
    const memory = stubMemory(scoped);
    const app = createServer({ memory });
    await app.fetch(
      new Request('http://localhost/v1/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', query: 'q' }),
      }),
    );
    expect(scoped.recall).toHaveBeenCalledWith('q', expect.objectContaining({ graphExpand: undefined }));
  });

  test('invalid graphExpand (hops out of range) ⇒ 422, never 500', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', query: 'q', graphExpand: { hops: 3 } }),
      }),
    );
    expect(res.status).toBe(422);
  });

  test('unknown graphExpand inner key ⇒ 422 (strict inner)', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', query: 'q', graphExpand: { bogus: 1 } }),
      }),
    );
    expect(res.status).toBe(422);
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

describe('T3.5 absorption — health endpoints are auth-exempt', () => {
  test('11a. GET /v1/health returns 200 WITHOUT bearer token even when THEMEMORY_API_KEY set', async () => {
    process.env['THEMEMORY_API_KEY'] = 'sk-secret';
    try {
      const memory = stubMemory(stubScopedMemory());
      const app = createServer({ memory });
      const res = await app.fetch(new Request('http://localhost/v1/health'));
      expect(res.status).toBe(200);
    } finally {
      delete process.env['THEMEMORY_API_KEY'];
    }
  });

  test('11b. GET /v1/health/db returns 503 (no probe) without bearer even when THEMEMORY_API_KEY set', async () => {
    // The point: NOT 401. 503 is the honest no-probe-configured response;
    // 401 would mean the bearer middleware ate the request before the
    // health handler ran — the bug T3.5 absorption fixes.
    process.env['THEMEMORY_API_KEY'] = 'sk-secret';
    try {
      const memory = stubMemory(stubScopedMemory());
      const app = createServer({ memory });
      const res = await app.fetch(new Request('http://localhost/v1/health/db'));
      expect(res.status).toBe(503);
      expect(res.status).not.toBe(401);
    } finally {
      delete process.env['THEMEMORY_API_KEY'];
    }
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

describe('T1.1 fixes-cycle-1 — F-rev-1 absorption (skillRepoId removed from REST scope keys)', () => {
  test('FC1-T1.1-RED-1. POST /v1/remember with skillRepoId in body returns 422 + code NOT INTERNAL_ERROR', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', skillRepoId: 'repo-x', text: 'x' }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    // EC-2 absorption: zod .strict() rejects unknown skillRepoId BEFORE superRefine
    // runs, so the code may be VALIDATION_ERROR / INVALID_BODY rather than
    // INVALID_SCOPE. Pin "NOT INTERNAL_ERROR" to assert the body-validation path.
    expect(body.code).not.toBe('INTERNAL_ERROR');
  });

  test('FC1-T1.1-RED-2. POST /v1/remember with ONLY skillRepoId returns 422 (no remaining tier)', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillRepoId: 'repo-x', text: 'x' }),
      }),
    );
    expect(res.status).toBe(422);
  });

  test('FC1-T1.1-RED-3. POST /v1/reflect with skillRepoId returns 422 (same code path)', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillRepoId: 'repo-x' }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe('T2.1 fixes-cycle-1 — F-rev-4 absorption (hono/body-limit 1MB cap + EC-1 envelope)', () => {
  test('FC1-T2.1-RED-1. POST /v1/remember with 2MB body returns 413 with structured envelope', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const oversized = 'a'.repeat(2_000_000);
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', text: oversized }),
      }),
    );
    expect(res.status).toBe(413);
    // EC-1 absorption: the 413 envelope shape MUST match T1.6's
    // structured {code, message} contract via hono/body-limit onError
    // calling mapDomainErrorToResponse(new ContentTooLargeError(...)).
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('CONTENT_TOO_LARGE');
    expect(typeof body.message).toBe('string');
  });

  test('FC1-T2.1-RED-2. EC-7 middleware order: 2MB body + no Authorization + key set → 413 (not 401)', async () => {
    // Order MUST be OTel → bodyLimit → bearer so the DOS guard rejects
    // BEFORE auth status is consulted. Pins the load-bearing ordering
    // from ADR D3.
    process.env['THEMEMORY_API_KEY'] = 'sk-secret';
    try {
      const memory = stubMemory(stubScopedMemory());
      const app = createServer({ memory });
      const oversized = 'a'.repeat(2_000_000);
      const res = await app.fetch(
        new Request('http://localhost/v1/remember', {
          method: 'POST',
          // NO Authorization header on purpose.
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'alice', text: oversized }),
        }),
      );
      expect(res.status).toBe(413);
      expect(res.status).not.toBe(401);
    } finally {
      delete process.env['THEMEMORY_API_KEY'];
    }
  });

  test('FC1-T2.1-RED-3. small body (4KB) is unaffected — passes through to handler', async () => {
    const memory = stubMemory(stubScopedMemory());
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', text: 'a'.repeat(4_000) }),
      }),
    );
    expect(res.status).toBe(201);
  });
});
