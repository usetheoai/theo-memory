/**
 * Unit tests for OllamaEmbedder (embedder-registry T2.1) — stub `fetch`, no network.
 */
import { describe, expect, test, vi } from 'vitest';

import { EmbedderError } from '../../domain/errors.js';

import { OllamaEmbedder } from './ollama.js';

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): typeof fetch {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('OllamaEmbedder', () => {
  test('embed issues POST {baseUrl}/api/embed with {model, input} + parses the vector', async () => {
    const f = stubFetch({ embeddings: [[0.1, 0.2, 0.3]] });
    const e = new OllamaEmbedder({ baseUrl: 'http://host:11434/', model: 'nomic-embed-text', fetchImpl: f });
    const vec = await e.embed('hello');
    expect(vec).toEqual([0.1, 0.2, 0.3]);
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('http://host:11434/api/embed'); // trailing slash trimmed
    const reqBody = JSON.parse((call[1] as { body: string }).body) as { model: string; input: string[] };
    expect(reqBody.model).toBe('nomic-embed-text');
    expect(reqBody.input).toEqual(['hello']);
  });

  test('embedBatch preserves order; empty short-circuits without a fetch', async () => {
    const f = stubFetch({ embeddings: [[1], [2]] });
    const e = new OllamaEmbedder({ fetchImpl: f });
    expect(await e.embedBatch([])).toEqual([]);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    const out = await e.embedBatch(['a', 'b']);
    expect(out).toEqual([[1], [2]]);
  });

  test('non-2xx → typed EmbedderError', async () => {
    const e = new OllamaEmbedder({ fetchImpl: stubFetch({}, { ok: false, status: 500 }) });
    await expect(e.embed('x')).rejects.toBeInstanceOf(EmbedderError);
  });

  test('malformed response (count mismatch) → EmbedderError', async () => {
    const e = new OllamaEmbedder({ fetchImpl: stubFetch({ embeddings: [] }) });
    await expect(e.embed('x')).rejects.toBeInstanceOf(EmbedderError);
  });
});
