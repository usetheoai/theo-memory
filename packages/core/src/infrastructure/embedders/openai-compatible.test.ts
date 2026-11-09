import { describe, expect, it, vi } from 'vitest';

import { EmbedderError } from '../../domain/errors.js';
import { OpenAICompatibleEmbedder } from './openai-compatible.js';

function fakeClient(vectors: readonly { index: number; embedding: readonly number[] }[]) {
  const create = vi.fn(async () => ({ data: vectors }));
  return { client: { embeddings: { create } }, create };
}

describe('OpenAICompatibleEmbedder', () => {
  it('sends configured model, dimensions, and inputs; returns vectors in input order', async () => {
    const fake = fakeClient([
      { index: 1, embedding: [0, 1] },
      { index: 0, embedding: [1, 0] },
    ]);
    const embedder = new OpenAICompatibleEmbedder({
      model: 'text-embedding-v4', apiKey: 'test', baseUrl: 'https://example.test/v1', dimensions: 2,
      client: fake.client as never,
    });
    await expect(embedder.embedBatch(['first', 'second'])).resolves.toEqual([[1, 0], [0, 1]]);
    expect(fake.create).toHaveBeenCalledWith({
      model: 'text-embedding-v4', input: ['first', 'second'], dimensions: 2,
    });
  });

  it('does not call the provider for an empty batch', async () => {
    const fake = fakeClient([]);
    const embedder = new OpenAICompatibleEmbedder({ apiKey: 'test', client: fake.client as never });
    await expect(embedder.embedBatch([])).resolves.toEqual([]);
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('splits calls into the provider limit of 10 inputs without losing order', async () => {
    const create = vi.fn(async ({ input }: { input: string[] }) => ({
      data: input.map((_, index) => ({ index, embedding: [input.length, index] })),
    }));
    const embedder = new OpenAICompatibleEmbedder({ apiKey: 'test', dimensions: 2, client: { embeddings: { create } } as never });
    const result = await embedder.embedBatch(Array.from({ length: 12 }, (_, index) => `text-${String(index)}`));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([input]) => input.input.length)).toEqual([10, 2]);
    expect(result).toHaveLength(12);
    expect(result[0]).toEqual([10, 0]);
    expect(result[10]).toEqual([2, 0]);
  });

  it('fails fast for missing credentials, insecure URLs, and invalid dimensions', () => {
    expect(() => new OpenAICompatibleEmbedder({ apiKey: '' })).toThrow(/API_KEY/);
    expect(() => new OpenAICompatibleEmbedder({ apiKey: 'test', baseUrl: 'http://example.test' })).toThrow(/HTTPS/);
    expect(() => new OpenAICompatibleEmbedder({ apiKey: 'test', dimensions: 0 })).toThrow(EmbedderError);
    expect(() => new OpenAICompatibleEmbedder({ apiKey: 'test', dimensions: 2048 })).toThrow(/1..2000/);
  });

  it('accepts the project .env Alibaba key alias', () => {
    vi.stubEnv('ALIBABA_API_KEY', 'test-alibaba-key');
    try {
      expect(() => new OpenAICompatibleEmbedder()).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects overlong inputs instead of silently truncating memory text', async () => {
    const fake = fakeClient([{ index: 0, embedding: [1, 0] }]);
    const embedder = new OpenAICompatibleEmbedder({ apiKey: 'test', dimensions: 2, client: fake.client as never });
    await expect(embedder.embed('x'.repeat(16_001))).rejects.toThrow(/split it before embedding/);
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('rejects mismatched vector dimensions and malformed batch responses', async () => {
    const wrongDimension = new OpenAICompatibleEmbedder({
      apiKey: 'test', dimensions: 2, client: fakeClient([{ index: 0, embedding: [1] }]).client as never,
    });
    await expect(wrongDimension.embed('x')).rejects.toThrow(/unexpected dimensions/);

    const missingRows = new OpenAICompatibleEmbedder({ apiKey: 'test', client: fakeClient([]).client as never });
    await expect(missingRows.embedBatch(['one'])).rejects.toThrow(/vectors for 1 inputs/);
  });

  it('rejects non-finite vector values', async () => {
    const embedder = new OpenAICompatibleEmbedder({
      apiKey: 'test', dimensions: 2, client: fakeClient([{ index: 0, embedding: [1, Number.NaN] }]).client as never,
    });
    await expect(embedder.embed('x')).rejects.toThrow(/non-finite/);
  });
});
