/**
 * #231 — a row the store refuses is skipped without poisoning the batch, but the reason is kept:
 * the first failure comes back to the caller, and events carry its code, never its message.
 */
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, test } from 'vitest';

import type { InsertOutcome, VectorStore } from '../dip/vector-store.js';

import { persistErrorAttributes } from './persist-error.js';
import { persistWithFallback } from './pipeline-helpers.js';

class DbError extends Error {
  constructor(readonly code: string, readonly constraint: string) { super('Key (workspace_id)=(secret-ws) is not present'); }
}

function storeRejecting(badId: string, error: Error): VectorStore {
  return {
    insert: (_v: readonly (readonly number[])[], ids: readonly string[]): Promise<readonly InsertOutcome[]> => (ids.includes(badId)
      ? Promise.reject(error)
      : Promise.resolve(ids.map((id) => ({ id, confirmationCount: 1, rejectedAsDuplicate: false })))),
  } as unknown as VectorStore;
}

describe('persistWithFallback', () => {
  test('keeps the rows that saved and returns the first failure', async () => {
    const error = new DbError('23503', 'memories_workspace_id_fkey');
    const result = await persistWithFallback(storeRejecting('b', error), [[1], [1]], ['a', 'b'], [{}, {}], undefined);
    expect(result.outcomes.map((o) => o.id)).toEqual(['a']);
    expect(result.failure).toBe(error);
  });

  test('reports no failure when every row saved', async () => {
    const result = await persistWithFallback(storeRejecting('none', new Error('x')), [[1]], ['a'], [{}], undefined);
    expect(result).toEqual({ outcomes: [{ id: 'a', confirmationCount: 1, rejectedAsDuplicate: false }] });
  });

  test('the fallback event names the SQLSTATE and constraint, never the message', async () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).getTracer('t');
    await persistWithFallback(storeRejecting('b', new DbError('23503', 'memories_workspace_id_fkey')), [[1], [1]], ['a', 'b'], [{}, {}], tracer);
    const fallback = exporter.getFinishedSpans().find((span) => span.name === 'persist_fallback');
    expect(fallback?.attributes).toMatchObject({ error_code: '23503', constraint: 'memories_workspace_id_fkey' });
    expect(JSON.stringify(fallback?.attributes)).not.toContain('secret-ws');
  });
});

describe('persistErrorAttributes', () => {
  test('falls back to the error name for errors without a code', () => {
    expect(persistErrorAttributes(new TypeError('boom'))).toEqual({ error_name: 'TypeError' });
    expect(persistErrorAttributes('text')).toEqual({ error_name: 'UnknownError' });
  });
});
