/**
 * Subpath export smoke test for `@usetheo/memory/llms` + `.../stub` +
 * `.../openai` (adapters-openai-cycle-2 § T2.1 extension).
 *
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T2.1
 * @see .claude/knowledge-base/plans/adapters-openai-cycle-2-plan.md § T2.1
 */
import { describe, it, expect } from 'vitest';

import { OpenAILLM as FromOpenAI } from './openai.js';
import { DeterministicStubLLM as FromStub } from './stub.js';

import { DeterministicStubLLM, OpenAILLM } from './index.js';

describe('@usetheo/memory/llms subpath', () => {
  it('barrel re-exports DeterministicStubLLM', () => {
    expect(DeterministicStubLLM).toBeDefined();
  });

  it('barrel export equals direct stub import', () => {
    expect(DeterministicStubLLM).toBe(FromStub);
  });

  it('barrel re-exports OpenAILLM (adapters-openai-cycle-2 § T2.1)', () => {
    expect(OpenAILLM).toBeDefined();
  });

  it('OpenAILLM barrel export equals direct openai import', () => {
    expect(OpenAILLM).toBe(FromOpenAI);
  });
});
