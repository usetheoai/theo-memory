/**
 * T1.3 RED — /v1/health + /v1/health/db handlers.
 *
 * - EC-16 (document): no caching; query each time.
 * - EC-17: /v1/health/db wraps `dbProbe` in 2s timeout via Promise.race.
 *
 * `dbProbe?: () => Promise<void>` injected via CreateServerOptions per ADR
 * D11 / SEPA pre-RED iter 4 CRITICAL — keeps src/server/ pg-free.
 *
 * @see Plan theo-memory-standalone-p0 § T1.3
 */
import { describe, expect, test, vi } from 'vitest';

import type { Memory } from '@usetheo/memory/contract';
import { createServer } from '../index.js';

function noopMemory(): Memory {
  return {
    user: vi.fn(),
    session: vi.fn(),
    agent: vi.fn(),
    skills: vi.fn(),
    forget: vi.fn(),
    get: vi.fn(),
    history: vi.fn(),
    reset: vi.fn(),
    flushReflections: vi.fn(),
  };
}

describe('T1.3 — GET /v1/health', () => {
  test('1. returns 200 with { status: "ok" }', async () => {
    const app = createServer({ memory: noopMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});

describe('T1.3 — GET /v1/health/db', () => {
  test('2. returns 200 when dbProbe resolves', async () => {
    const dbProbe = vi.fn().mockResolvedValue(undefined);
    const app = createServer({ memory: noopMemory(), dbProbe });
    const res = await app.fetch(new Request('http://localhost/v1/health/db'));
    expect(res.status).toBe(200);
    expect(dbProbe).toHaveBeenCalledTimes(1);
  });

  test('3. returns 503 when dbProbe throws', async () => {
    const dbProbe = vi.fn().mockRejectedValue(new Error('connection refused'));
    const app = createServer({ memory: noopMemory(), dbProbe });
    const res = await app.fetch(new Request('http://localhost/v1/health/db'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('unavailable');
  });

  test('4. returns 503 within 2s when dbProbe hangs (EC-17 timeout)', async () => {
    const dbProbe = vi.fn().mockImplementation(
      () => new Promise(() => { /* never resolves */ }),
    );
    const app = createServer({ memory: noopMemory(), dbProbe });
    const t0 = Date.now();
    const res = await app.fetch(new Request('http://localhost/v1/health/db'));
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(503);
    // EC-17 ceiling: 2s + small overhead. CI matrix tolerance ≤3000ms.
    expect(elapsed).toBeLessThan(3000);
    expect(elapsed).toBeGreaterThanOrEqual(2000);
  }, 5_000);

  test('5. returns 503 when dbProbe NOT provided (no consumer wiring)', async () => {
    const app = createServer({ memory: noopMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/health/db'));
    expect(res.status).toBe(503);
  });
});
