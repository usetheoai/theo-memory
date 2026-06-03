/**
 * T1.5 pillar (c) — integration locus: exercises the OTel middleware
 * end-to-end across all 6 verbs (remember/recall/forget/reflect/health/scopes)
 * to prove the runtime metric (`rest.v1.*` spans) fires at least once per
 * verb when the REST server is composed with a real Tracer + real exporter.
 *
 * The contract suite at `src/server/__tests__/otel.test.ts` already validates
 * per-handler emission with the same OTel SDK; this integration locus is the
 * cross-verb sweep mandated by the wiring triad (pillar c).
 *
 * @see Plan theo-memory-standalone-p0 § T1.5 wiring + cycle-implement § Wiring triad
 */
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Memory } from '../../src/core/memory-store.js';
import { createServer } from '../../src/server/index.js';

let activeProvider: BasicTracerProvider | undefined;

afterEach(async () => {
  if (activeProvider !== undefined) {
    await activeProvider.shutdown();
    activeProvider = undefined;
  }
});

function setupTracer(): { tracer: ReturnType<BasicTracerProvider['getTracer']>; exporter: InMemorySpanExporter } {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  activeProvider = provider;
  return { tracer: provider.getTracer('rest-api-integration'), exporter };
}

function stubMemory(): Memory {
  const scoped = {
    remember: vi.fn().mockResolvedValue({ items: [] }),
    recall: vi.fn().mockResolvedValue([]),
    reflect: vi.fn().mockResolvedValue({ jobId: 'j-int' }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  return {
    user: vi.fn().mockReturnValue(scoped),
    session: vi.fn().mockReturnValue(scoped),
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn().mockReturnValue(scoped),
    forget: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    history: vi.fn(),
    reset: vi.fn(),
    flushReflections: vi.fn(),
  };
}

describe('T1.5 wiring — OTel spans observed across the 6 REST verbs', () => {
  test('spans rest.v1.{remember,recall,forget,reflect,health,scopes.list} all fire at least once', async () => {
    const { tracer, exporter } = setupTracer();
    const app = createServer({ memory: stubMemory(), tracer });

    await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', text: 'fact' }),
      }),
    );
    await app.fetch(
      new Request('http://localhost/v1/recall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', query: 'q' }),
      }),
    );
    await app.fetch(
      new Request('http://localhost/v1/forget', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memoryId: '11111111-1111-1111-1111-111111111111' }),
      }),
    );
    await app.fetch(
      new Request('http://localhost/v1/reflect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'alice' }),
      }),
    );
    await app.fetch(new Request('http://localhost/v1/health'));
    await app.fetch(new Request('http://localhost/v1/scopes/user/alice/memories'));

    const names = new Set(exporter.getFinishedSpans().map((s) => s.name));
    expect(names).toContain('rest.v1.remember');
    expect(names).toContain('rest.v1.recall');
    expect(names).toContain('rest.v1.forget');
    expect(names).toContain('rest.v1.reflect');
    expect(names).toContain('rest.v1.health');
    expect(names).toContain('rest.v1.scopes.list');
  });
});
