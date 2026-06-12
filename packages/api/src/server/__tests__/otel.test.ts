/**
 * T1.5 RED — OTel span middleware for REST handlers.
 *
 * Per plan theo-memory-standalone-p0 § T1.5 + ADR D11 (DI composition):
 * - Tracer injected via `CreateServerOptions.tracer` (DIP — matches
 *   `createLocalMemory({ tracer })` precedent at src/local/index.ts).
 * - Span names follow `rest.v1.<verb>` convention (EC-21).
 * - Each request observed: `rest.v1.remember | recall | forget | reflect |
 *   health | scopes.list`. Span carries `http.status_code` attribute.
 * - 4xx → span.status OK; 5xx OR caught exception → span.status ERROR
 *   (`span.recordException(err)` for thrown errors, then re-throw so Hono's
 *   `onError` returns the sanitized 500 envelope per EC-10).
 * - EC-22 absorption: exporter failures (`exporter.export()` throws sync)
 *   MUST NOT break the handler response — observability is fail-quiet.
 *
 * @see Plan § T1.5 + ADR D11 + EC-21 + EC-22
 */
import type { trace } from '@opentelemetry/api';
import type { ExportResult } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

function stubMemory(): Memory {
  const scoped = {
    remember: vi.fn().mockResolvedValue({ items: [] }),
    recall: vi.fn().mockResolvedValue([]),
    reflect: vi.fn().mockResolvedValue({ jobId: 'j-1' }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  const stub = {
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
  return stub;
}

function setupTracer(): { tracer: ReturnType<typeof trace.getTracer>; exporter: InMemorySpanExporter; provider: BasicTracerProvider } {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('rest-api-test'), exporter, provider };
}

describe('T1.5 — OTel span middleware', () => {
  test('15. POST /v1/remember emits span named rest.v1.remember', async () => {
    const { tracer, exporter, provider } = setupTracer();
    const app = createServer({ memory: stubMemory(), tracer });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', text: 'fact' }),
      }),
    );
    expect(res.status).toBe(201);
    const spans = exporter.getFinishedSpans();
    const names = spans.map((s) => s.name);
    expect(names).toContain('rest.v1.remember');
    await provider.shutdown();
  });

  test('16. span carries http.status_code attribute', async () => {
    const { tracer, exporter, provider } = setupTracer();
    const app = createServer({ memory: stubMemory(), tracer });
    await app.fetch(new Request('http://localhost/v1/health'));
    const span = exporter.getFinishedSpans().find((s) => s.name === 'rest.v1.health');
    expect(span).toBeDefined();
    expect(span?.attributes['http.status_code']).toBe(200);
    await provider.shutdown();
  });

  test('17. 5xx handler exception marks span status ERROR', async () => {
    const { tracer, exporter, provider } = setupTracer();
    const memory = stubMemory();
    // Force user-scoped remember to throw → reaches onError, returns 500
    (memory.user as ReturnType<typeof vi.fn>).mockReturnValue({
      remember: vi.fn().mockRejectedValue(new Error('boom')),
      recall: vi.fn(),
      reflect: vi.fn(),
      getAll: vi.fn(),
    });
    const app = createServer({ memory, tracer });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', text: 'fact' }),
      }),
    );
    expect(res.status).toBe(500);
    const span = exporter.getFinishedSpans().find((s) => s.name === 'rest.v1.remember');
    expect(span).toBeDefined();
    // OTel SpanStatusCode.ERROR === 2
    expect(span?.status.code).toBe(2);
    await provider.shutdown();
  });

  test('18. handler returns 201 even when OTel exporter throws (EC-22 fail-quiet)', async () => {
    class FailingExporter implements SpanExporter {
      export(_spans: readonly ReadableSpan[], _cb: (_r: ExportResult) => void): void {
        throw new Error('xport down');
      }
      shutdown(): Promise<void> {
        return Promise.resolve();
      }
    }
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(new FailingExporter())] });
    const tracer = provider.getTracer('rest-api-failing');
    const app = createServer({ memory: stubMemory(), tracer });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', text: 'fact' }),
      }),
    );
    // Despite exporter sync throw, handler responds cleanly.
    expect(res.status).toBe(201);
    await provider.shutdown();
  });
});
