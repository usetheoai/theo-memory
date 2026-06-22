/**
 * Unit tests for GoogleEmbedder (embedder-registry T2.3) — stub `fetch`, no network.
 */
import { describe, expect, test, vi } from 'vitest';

import { EmbedderError } from '../../domain/errors.js';

import { GoogleEmbedder } from './google.js';

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): typeof fetch {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('GoogleEmbedder', () => {
  test('embed POSTs to :batchEmbedContents with key + model path + parses embeddings[].values', async () => {
    const f = stubFetch({ embeddings: [{ values: [0.7, 0.8] }] });
    const e = new GoogleEmbedder({ apiKey: 'gk-test', model: 'text-embedding-004', fetchImpl: f });
    const vec = await e.embed('hi');
    expect(vec).toEqual([0.7, 0.8]);
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=gk-test',
    );
    const reqBody = JSON.parse((call[1] as { body: string }).body) as {
      requests: { model: string; content: { parts: { text: string }[] } }[];
    };
    expect(reqBody.requests[0]?.content.parts[0]?.text).toBe('hi');
    expect(reqBody.requests[0]?.model).toBe('models/text-embedding-004');
  });

  test('embedBatch preserves order; empty short-circuits', async () => {
    const f = stubFetch({ embeddings: [{ values: [1] }, { values: [2] }] });
    const e = new GoogleEmbedder({ apiKey: 'k', fetchImpl: f });
    expect(await e.embedBatch([])).toEqual([]);
    expect(await e.embedBatch(['a', 'b'])).toEqual([[1], [2]]);
  });

  test('non-2xx → EmbedderError', async () => {
    const e = new GoogleEmbedder({ apiKey: 'k', fetchImpl: stubFetch({}, { ok: false, status: 403 }) });
    await expect(e.embed('x')).rejects.toBeInstanceOf(EmbedderError);
  });

  test('row without values → EmbedderError', async () => {
    const e = new GoogleEmbedder({ apiKey: 'k', fetchImpl: stubFetch({ embeddings: [{}] }) });
    await expect(e.embed('x')).rejects.toBeInstanceOf(EmbedderError);
  });

  test('fail-fast: missing API key throws EmbedderError at construction', () => {
    vi.stubEnv('GOOGLE_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(() => new GoogleEmbedder({})).toThrow(EmbedderError);
    expect(() => new GoogleEmbedder({})).toThrow(/api key/i);
    vi.unstubAllEnvs();
  });
});
