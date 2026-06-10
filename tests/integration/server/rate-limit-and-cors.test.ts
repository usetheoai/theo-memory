/**
 * T2.1 + T2.2 of red-team-full-system-fixes-cycle-1 — rate-limit + CORS.
 *
 * @see .claude/knowledge-base/plans/red-team-full-system-fixes-cycle-1-plan.md § T2.1 + T2.2
 */
import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';

import type { Embedder } from '../../../src/core/dip/embedder.js';
import { DeterministicStubLLM } from '../../../src/llms/stub.js';
import { createLocalMemory } from '../../../src/local/index.js';
import { InMemoryVectorStore } from '../../../src/local/in-memory-store.js';
import { createServer } from '../../../src/server/index.js';
import { SlidingWindowRateLimiter, normalizeIp, parseEnvLimit } from '../../../src/server/middleware/rate-limit.js';

const Constant384Embedder: Embedder = {
  embed: async () => { const v = new Array<number>(384).fill(0); v[0] = 1; return v; },
  embedBatch: async (texts) => texts.map(() => { const v = new Array<number>(384).fill(0); v[0] = 1; return v; }),
};

describe('T2.1 — SlidingWindowRateLimiter unit tests', () => {
  test('allows requests within limit', () => {
    const limiter = new SlidingWindowRateLimiter(3, 60000);
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);
  });

  test('rejects after exceeding limit', () => {
    const limiter = new SlidingWindowRateLimiter(2, 60000);
    limiter.check('k');
    limiter.check('k');
    const result = limiter.check('k');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  test('resets window after time elapses', () => {
    vi.useFakeTimers();
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    limiter.check('k');
    expect(limiter.check('k').allowed).toBe(false);
    vi.advanceTimersByTime(1100);
    expect(limiter.check('k').allowed).toBe(true);
    vi.useRealTimers();
  });

  test('EC-1: IPv6 ::ffff:127.0.0.1 normalizes to 127.0.0.1', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('::1')).toBe('::1');
  });

  test('EC-3: per-token isolation — token A limit does not block token B', () => {
    const limiter = new SlidingWindowRateLimiter(1, 60000);
    limiter.check('bearer:tokenA');
    expect(limiter.check('bearer:tokenA').allowed).toBe(false);
    expect(limiter.check('bearer:tokenB').allowed).toBe(true);
  });

  test('EC-4: parseEnvLimit clamps 0/negative/non-numeric to default', () => {
    vi.stubEnv('THEMORY_RATE_LIMIT_WRITES', '0');
    expect(parseEnvLimit('THEMORY_RATE_LIMIT_WRITES', 30)).toBe(30);
    vi.stubEnv('THEMORY_RATE_LIMIT_WRITES', '-5');
    expect(parseEnvLimit('THEMORY_RATE_LIMIT_WRITES', 30)).toBe(30);
    vi.stubEnv('THEMORY_RATE_LIMIT_WRITES', 'abc');
    expect(parseEnvLimit('THEMORY_RATE_LIMIT_WRITES', 30)).toBe(30);
    vi.unstubAllEnvs();
  });
});

describe('T2.1 + T2.2 — integration: rate-limit + CORS on Hono app', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    vi.stubEnv('THEMORY_RATE_LIMIT_WRITES', '3');
    vi.stubEnv('THEMORY_RATE_LIMIT_READS', '5');
    const store = new InMemoryVectorStore();
    const memory = await createLocalMemory({
      vectorStore: store,
      embedder: Constant384Embedder,
      llm: new DeterministicStubLLM(),
      embeddingDim: 384,
    });
    app = createServer({ memory });
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  test('T2.2: OPTIONS preflight returns CORS headers', async () => {
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', { method: 'OPTIONS' }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  test('T2.2 EC-5: preflight includes Access-Control-Max-Age', async () => {
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', { method: 'OPTIONS' }),
    );
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  test('T2.1: health endpoint NOT rate-limited', async () => {
    // Health is mounted BEFORE rate-limit middleware
    for (let i = 0; i < 10; i++) {
      const res = await app.fetch(new Request('http://localhost/v1/health'));
      expect(res.status).toBe(200);
    }
  });
});
