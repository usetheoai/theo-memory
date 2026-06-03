/**
 * OTel span instrumentation helpers for the v0.8 benchmark runner.
 *
 * Per ADR D8 the runner wraps each adapter.add() and adapter.search()
 * call in an OTel span tagged with `benchmark.adapter` + `benchmark.method`
 * (+ `benchmark.question_id` for search).
 *
 * Per v0-8-fixes-cycle-1 T2.2 + ADR D5, per-question search spans ALSO
 * carry `benchmark.latency_ms` + `benchmark.model_used` derived from the
 * adapter's SearchResult. P95 latency is computed from per-query
 * SearchResult.latencyMs by the aggregator (NOT from OTel span duration);
 * span attributes preserve the data so downstream consumers (Grafana,
 * Honeycomb, etc.) can reconstruct the same P95 if they prefer.
 *
 * EC-8 absorption: when SearchResult.latencyMs / modelUsed are undefined
 * (the typed contract permits it), `withSpan`'s post-call extractor MUST
 * coalesce to deterministic sentinels (0 / 'unknown') — the OTel spec
 * rejects setAttribute(undefined).
 *
 * @see plan v0-8-fixes-cycle-1 § T2.2 + ADR D5 + EC-8
 */

import type { Span, Tracer } from '@opentelemetry/api';

export interface InstrumentationAttributes {
  readonly adapter: string;
  readonly method: 'add' | 'search';
  readonly questionId?: string;
}

/**
 * Extracts post-call span attributes from the fn's resolved value.
 * Called AFTER fn() resolves but BEFORE the span ends. Implementations
 * MUST coalesce nullable fields to deterministic sentinels (OTel rejects
 * undefined values).
 */
export type PostCallAttrs<T> = (result: T) => Record<string, string | number | boolean>;

export async function withSpan<T>(
  tracer: Tracer,
  attrs: InstrumentationAttributes,
  fn: () => Promise<T>,
  postCallAttrs?: PostCallAttrs<T>,
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
      if (postCallAttrs !== undefined) {
        for (const [k, v] of Object.entries(postCallAttrs(result))) {
          span.setAttribute(k, v);
        }
      }
      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}
