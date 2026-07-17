/**
 * Unit tests for VoyageEmbedder (embedder-registry T2.2) — stub `fetch`, no network.
 */
import { describe, expect, test, vi } from 'vitest';

import { EmbedderError } from '../../domain/errors.js';

import { VoyageEmbedder } from './voyage.js';

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): typeof fetch {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('VoyageEmbedder', () => {
  test('embed POSTs to the Voyage endpoint with Bearer key + parses data[].embedding', async () => {
    const f = stubFetch({ data: [{ embedding: [0.4, 0.5] }] });
    const e = new VoyageEmbedder({ apiKey: 'vk-test', model: 'voyage-3', fetchImpl: f });
    const vec = await e.embed('hi');
    expect(vec).toEqual([0.4, 0.5]);
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('https://api.voyageai.com/v1/embeddings');
    const headers = (call[1] as { headers: Record<string, string> }).headers;
    expect(headers['authorization']).toBe('Bearer vk-test');
    const reqBody = JSON.parse((call[1] as { body: string }).body) as { model: string; input: string[] };
    expect(reqBody.model).toBe('voyage-3');
    expect(reqBody.input).toEqual(['hi']);
  });

  test('embedBatch preserves order; empty short-circuits', async () => {
    const f = stubFetch({ data: [{ embedding: [1] }, { embedding: [2] }] });
    const e = new VoyageEmbedder({ apiKey: 'k', fetchImpl: f });
    expect(await e.embedBatch([])).toEqual([]);
    expect(await e.embedBatch(['a', 'b'])).toEqual([[1], [2]]);
  });

  test('non-2xx → EmbedderError', async () => {
    const e = new VoyageEmbedder({ apiKey: 'k', fetchImpl: stubFetch({}, { ok: false, status: 401 }) });
    await expect(e.embed('x')).rejects.toBeInstanceOf(EmbedderError);
  });

  test('row without embedding → EmbedderError', async () => {
    const e = new VoyageEmbedder({ apiKey: 'k', fetchImpl: stubFetch({ data: [{}] }) });
    await expect(e.embed('x')).rejects.toBeInstanceOf(EmbedderError);
  });

  test('fail-fast: missing API key throws EmbedderError at construction', () => {
    vi.stubEnv('VOYAGE_API_KEY', '');
    expect(() => new VoyageEmbedder({})).toThrow(EmbedderError);
    expect(() => new VoyageEmbedder({})).toThrow(/api key/i);
    vi.unstubAllEnvs();
  });
});
