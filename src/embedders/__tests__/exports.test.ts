/**
 * Subpath export smoke test for `@usetheo/memory/embedders` + `.../stub`.
 *
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T2.1
 */
import { describe, it, expect } from 'vitest';

import * as barrel from '../index.js';
import { DeterministicStubEmbedder as FromStub } from '../stub.js';

describe('@usetheo/memory/embedders subpath', () => {
  it('barrel re-exports DeterministicStubEmbedder', () => {
    expect(barrel.DeterministicStubEmbedder).toBeDefined();
  });

  it('barrel export equals direct stub import', () => {
    expect(barrel.DeterministicStubEmbedder).toBe(FromStub);
  });
});
