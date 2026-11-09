/**
 * Subpath export smoke test for `@usetheo/memory/embedders` + `.../stub` +
 * `.../openai` (adapters-openai-cycle-2 § T2.1 extension).
 *
 */
import { describe, it, expect } from 'vitest';

import { OpenAIEmbedder as FromOpenAI } from './openai.js';
import { OpenAICompatibleEmbedder as FromCompatible } from './openai-compatible.js';
import { DeterministicStubEmbedder as FromStub } from './stub.js';

import { DeterministicStubEmbedder, OpenAICompatibleEmbedder, OpenAIEmbedder } from './index.js';

describe('@usetheo/memory/embedders subpath', () => {
  it('barrel re-exports DeterministicStubEmbedder', () => {
    expect(DeterministicStubEmbedder).toBeDefined();
  });

  it('barrel export equals direct stub import', () => {
    expect(DeterministicStubEmbedder).toBe(FromStub);
  });

  it('barrel re-exports OpenAIEmbedder (adapters-openai-cycle-2 § T2.1)', () => {
    expect(OpenAIEmbedder).toBeDefined();
  });

  it('OpenAIEmbedder barrel export equals direct openai import', () => {
    expect(OpenAIEmbedder).toBe(FromOpenAI);
  });

  it('exports the configurable OpenAI-compatible provider', () => {
    expect(OpenAICompatibleEmbedder).toBe(FromCompatible);
  });
});
