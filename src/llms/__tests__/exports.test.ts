/**
 * Subpath export smoke test for `@usetheo/memory/llms` + `.../stub`.
 *
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T2.1
 */
import { describe, it, expect } from 'vitest';

import * as barrel from '../index.js';
import { DeterministicStubLLM as FromStub } from '../stub.js';

describe('@usetheo/memory/llms subpath', () => {
  it('barrel re-exports DeterministicStubLLM', () => {
    expect(barrel.DeterministicStubLLM).toBeDefined();
  });

  it('barrel export equals direct stub import', () => {
    expect(barrel.DeterministicStubLLM).toBe(FromStub);
  });
});
