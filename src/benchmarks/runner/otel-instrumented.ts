/**
 * OTel span instrumentation helpers for the v0.8 benchmark runner.
 *
 * Per ADR D8 the runner wraps each adapter.add() and adapter.search()
 * call in an OTel span tagged with `benchmark.adapter` + `benchmark.method`
 * (+ `benchmark.question_id` for search). P95 latency is computed from
 * span end-start by the aggregator (NOT from an OTel histogram metric).
 *
 * Precedent: v0.4a OTel ManualReflectionPolicy instrumentation +
 * BatchSpanProcessor + InMemorySpanExporter in tests.
 *
 * @see plan v1.2 § T4.1 + ADR D8
 */

import type { Span, Tracer } from '@opentelemetry/api';

export interface InstrumentationAttributes {
  readonly adapter: string;
  readonly method: 'add' | 'search';
  readonly questionId?: string;
}

export async function withSpan<T>(
  tracer: Tracer,
  attrs: InstrumentationAttributes,
  fn: () => Promise<T>,
): Promise<T> {
  const spanName = `benchmark.${attrs.method}`;
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    span.setAttribute('benchmark.adapter', attrs.adapter);
    span.setAttribute('benchmark.method', attrs.method);
    if (attrs.questionId !== undefined) {
      span.setAttribute('benchmark.question_id', attrs.questionId);
    }
    try {
      const result = await fn();
      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}
