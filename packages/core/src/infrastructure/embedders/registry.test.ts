/**
 * Unit tests for the embedder registry (embedder-registry T3.1).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

import { EmbedderError, EmbedderUnavailableError } from '../../domain/errors.js';

import { DeterministicStubEmbedder } from './stub.js';
import { OllamaEmbedder } from './ollama.js';
import { createEmbedder } from './registry.js';

afterEach(() => {
  vi.doUnmock('./openai.js');
});

describe('createEmbedder', () => {
  test('resolves the stub provider to a DeterministicStubEmbedder', async () => {
    const e = await createEmbedder({ provider: 'stub' });
    expect(e).toBeInstanceOf(DeterministicStubEmbedder);
  });

  test('resolves a fetch-based provider (ollama) with its options', async () => {
    const e = await createEmbedder({ provider: 'ollama', baseUrl: 'http://h:11434' });
    expect(e).toBeInstanceOf(OllamaEmbedder);
  });

  test('resolves voyage + google providers', async () => {
    expect((await createEmbedder({ provider: 'voyage', apiKey: 'k' })).constructor.name).toBe('VoyageEmbedder');
    expect((await createEmbedder({ provider: 'google', apiKey: 'k' })).constructor.name).toBe('GoogleEmbedder');
  });

  test('unknown provider → EmbedderError listing valid keys', async () => {
    await expect(
      // @ts-expect-error — deliberately invalid key
      createEmbedder({ provider: 'bogus' }),
    ).rejects.toBeInstanceOf(EmbedderError);
    await expect(
      // @ts-expect-error — deliberately invalid key
      createEmbedder({ provider: 'bogus' }),
    ).rejects.toThrow(/stub.*openai.*openai-compatible.*local.*ollama.*voyage.*google/);
  });

  test('SDK-backed provider whose dep is missing → EmbedderUnavailableError', async () => {
    // Simulate the static `import OpenAI from 'openai'` (openai.ts:35) failing
    // at adapter-module load. A getter that throws the coded error reproduces
    // the destructure-time module-not-found without vitest's factory-throw wrapper.
    vi.doMock('./openai.js', () => ({
      get OpenAIEmbedder(): never {
        const err = new Error('Cannot find module openai') as Error & { code: string };
        err.code = 'ERR_MODULE_NOT_FOUND';
        throw err;
      },
    }));
    await expect(createEmbedder({ provider: 'openai' })).rejects.toBeInstanceOf(EmbedderUnavailableError);
    await expect(createEmbedder({ provider: 'openai' })).rejects.toThrow(/pnpm add openai/);
  });
});
