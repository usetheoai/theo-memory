/**
 * Subpath export smoke test for `@usetheo/memory/embedders` + `.../stub` +
 * `.../openai` (adapters-openai-cycle-2 § T2.1 extension).
 *
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T2.1
 * @see .claude/knowledge-base/plans/adapters-openai-cycle-2-plan.md § T2.1
 */
import { describe, it, expect } from 'vitest';

import * as barrel from './index.js';
import { OpenAIEmbedder as FromOpenAI } from './openai.js';
import { DeterministicStubEmbedder as FromStub } from './stub.js';

describe('@usetheo/memory/embedders subpath', () => {
  it('barrel re-exports DeterministicStubEmbedder', () => {
    expect(barrel.DeterministicStubEmbedder).toBeDefined();
  });

  it('barrel export equals direct stub import', () => {
    expect(barrel.DeterministicStubEmbedder).toBe(FromStub);
  });

  it('barrel re-exports OpenAIEmbedder (adapters-openai-cycle-2 § T2.1)', () => {
    expect(barrel.OpenAIEmbedder).toBeDefined();
  });

  it('OpenAIEmbedder barrel export equals direct openai import', () => {
    expect(barrel.OpenAIEmbedder).toBe(FromOpenAI);
  });
});
