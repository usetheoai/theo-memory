/**
 * adapters-openrouter-local-embedder T2.2 — unit tests for the
 * `/api/info` route extension (returns `adapterSource` + `embedderDim`
 * per Goal metric).
 *
 * Tests load the route's GET handler in isolation (Next.js runtime not
 * required; the handler is a plain async function that returns
 * NextResponse.json). Singleton state is reset between tests via
 * globalThis cleanup (same pattern as policy-factory test).
 *
 * Path placement: tests/unit/examples/ per EC-13 reachability invariant
 * (matches `tests/unit/**\/*.test.ts` vitest contract glob).
 *
 * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T2.2
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

interface InfoResponse {
  backend: 'pgvector' | 'in-memory';
  reflectionThreshold: number;
  adapterSource: 'stub' | 'openai' | 'local-openrouter';
  embedderDim: number;
}

describe('/api/info — adapterSource + embedderDim shape (T2.2)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)['_themory_demo_singleton'];
    delete process.env['THEOMEM_PG_URI'];
    delete process.env['THEOMEM_EVICTION_DEMO'];
    delete process.env['THEOMEM_DEMO_BACKEND'];
    delete process.env['THEOMEM_USE_STUB_ADAPTERS'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete (globalThis as Record<string, unknown>)['_themory_demo_singleton'];
  });

  test('returns adapterSource="stub" + embedderDim=1536 in stub mode', async () => {
    process.env['THEOMEM_DEMO_BACKEND'] = 'stub';
    const { GET } = await import('../../../examples/chat-with-memory/app/api/info/route.js');
    const res = await GET();
    const json = (await res.json()) as InfoResponse;
    expect(json.adapterSource).toBe('stub');
    expect(json.embedderDim).toBe(1536);
  });

  test('returns adapterSource="stub" + embedderDim=1536 with legacy THEOMEM_USE_STUB_ADAPTERS=1', async () => {
    process.env['THEOMEM_USE_STUB_ADAPTERS'] = '1';
    const { GET } = await import('../../../examples/chat-with-memory/app/api/info/route.js');
    const res = await GET();
    const json = (await res.json()) as InfoResponse;
    expect(json.adapterSource).toBe('stub');
    expect(json.embedderDim).toBe(1536);
  });

  test('preserves existing fields: backend + reflectionThreshold', async () => {
    process.env['THEOMEM_DEMO_BACKEND'] = 'stub';
    process.env['THEOMEM_REFLECTION_THRESHOLD'] = '25';
    const { GET } = await import('../../../examples/chat-with-memory/app/api/info/route.js');
    const res = await GET();
    const json = (await res.json()) as InfoResponse;
    expect(json.backend).toBe('in-memory');
    expect(json.reflectionThreshold).toBe(25);
  });

  test('returns JSON with HTTP 200 + Content-Type application/json', async () => {
    process.env['THEOMEM_DEMO_BACKEND'] = 'stub';
    const { GET } = await import('../../../examples/chat-with-memory/app/api/info/route.js');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});
