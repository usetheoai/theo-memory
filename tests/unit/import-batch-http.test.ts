/**
 * Unit tests for the importBatch HTTP transport of the Claude-Code-memory
 * migrator (M6/M12): fail-loud on HTTP failure, gateway path-prefix composition
 * (theo-lib parity — issue #109 live E2E), and byte-aware chunking against the
 * server's 1 MB bodyLimit (#109). Split from migrate-claude-code-memory.test.ts
 * per the 300-line budget; that file keeps the PURE parse/scrub/map/plan surface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MigrationHttpError, importBatch } from '../../scripts/migrate-claude-code-memory.mjs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('importBatch — fail-loud on HTTP failure (error-handling.md)', () => {
  it('throws MigrationHttpError with the status on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 401, statusText: 'Unauthorized' }),
    );
    await expect(importBatch([{ userId: 'p', text: 't', infer: false }], { endpoint: 'http://x' })).rejects.toThrow(
      MigrationHttpError,
    );
    await expect(importBatch([{ userId: 'p', text: 't', infer: false }], { endpoint: 'http://x' })).rejects.toThrow(
      /401/,
    );
  });

  it('throws MigrationHttpError (unreachable) when fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      importBatch([{ userId: 'p', text: 't', infer: false }], { endpoint: 'http://dead.invalid' }),
    ).rejects.toThrow(/unreachable/);
  });
});

describe('importBatch — gateway path prefix (issue #109 live E2E: capability-namespace rewrite)', () => {
  it('composes prefix + verb-path-without-/v1 like theo-lib (never /v1/memory/v1/...)', async () => {
    // The Theo gateway rewrites /v1/memory/X → /v1/X (Traefik memory-rewrite). Appending the
    // native /v1/remember/batch to a prefixed base produced /v1/memory/v1/remember/batch →
    // rewritten /v1/v1/remember/batch → 404 against the live edge.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ imported: 1, deduped: 0, failed: 0 }), { status: 200 }),
    );
    await importBatch([{ userId: 'p', text: 't', infer: false }], {
      endpoint: 'https://edge.example',
      pathPrefix: '/v1/memory',
    });
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://edge.example/v1/memory/remember/batch');
  });

  it('keeps the native /v1/remember/batch path when no prefix is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ imported: 1, deduped: 0, failed: 0 }), { status: 200 }),
    );
    await importBatch([{ userId: 'p', text: 't', infer: false }], { endpoint: 'http://127.0.0.1:8080' });
    expect(fetchSpy.mock.calls[0]![0]).toBe('http://127.0.0.1:8080/v1/remember/batch');
  });
});

describe('importBatch — byte-aware chunking (issue #109 regression: 413 on real-size dataset)', () => {
  it('default CHUNK_SIZE stays at 75 — bounds per-request server work under the fetch timeout', async () => {
    // 183 items took 275s live (~1.5s/item embedding) grazing Node fetch's non-extendable ~300s
    // headers timeout. 75 caps a request at ~2 min. Raising this requires re-measuring live.
    const { CHUNK_SIZE } = await import('../../scripts/migrate-claude-code-memory.mjs');
    expect(CHUNK_SIZE).toBe(75);
  });

  it('splits into multiple requests when the serialized payload would exceed the byte budget', async () => {
    // 40 items × ~50 KB each ≈ 2 MB total — under the 500-count cap (the bug: ONE request → 413
    // against the server's 1 MB bodyLimit). Byte-aware chunking must keep EVERY request body
    // under the budget and still send every item exactly once.
    const items = Array.from({ length: 40 }, (_, i) => ({
      userId: 'p',
      text: `note ${i} ` + 'lorem ipsum dolor sit amet '.repeat(2000),
      infer: false,
    }));
    const bodies: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const body = (init as { body: string }).body;
      bodies.push(body);
      const n = (JSON.parse(body) as { items: unknown[] }).items.length;
      return Promise.resolve(
        new Response(JSON.stringify({ imported: n, deduped: 0, failed: 0 }), { status: 200 }),
      );
    });

    const out = await importBatch(items, { endpoint: 'http://x' });

    expect(bodies.length).toBeGreaterThan(1); // count cap alone would have sent ONE request
    for (const b of bodies) expect(b.length).toBeLessThanOrEqual(512 * 1024); // every body under budget
    expect(bodies.reduce((n, b) => n + (JSON.parse(b) as { items: unknown[] }).items.length, 0)).toBe(40);
    expect(out.imported).toBe(40);
    expect(out.requests).toBe(bodies.length);
  });

  it('throws a typed error when a SINGLE item alone exceeds the byte budget (fail-fast, no silent skip)', async () => {
    const giant = { userId: 'p', text: 'x'.repeat(600 * 1024), infer: false };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(importBatch([giant], { endpoint: 'http://x' })).rejects.toThrow(/byte budget/);
    expect(fetchSpy).not.toHaveBeenCalled(); // rejected BEFORE dialing — the server would 413 anyway
  });
});

