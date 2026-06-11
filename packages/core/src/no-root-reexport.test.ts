/**
 * ADR D4 enforcement (EC-6 from edge-case review): the new deterministic
 * stub classes MUST NOT be re-exported from the package root
 * (`@usetheo/memory`). Consumers MUST go through subpath
 * `@usetheo/memory/embedders/stub` and `@usetheo/memory/llms/stub`
 * explicitly. Establishes the discipline for the 52 future adapters per
 * the portfolio roadmap (one subpath per adapter; no root-bundle bloat).
 *
 * **EC-3 absorption (adapters-openai-cycle-2):** the same discipline is
 * extended to the OpenAI adapter pair shipped in Cycle 2 — `OpenAIEmbedder`
 * + `OpenAILLM` MUST stay opt-in via subpath `@usetheo/memory/embedders/openai`
 * + `@usetheo/memory/llms/openai`, never re-exported from root. Locks the
 * regression guard before adapter #3 (anthropic, ollama, etc.) ships.
 *
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § ADR D4
 * @see .claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-edge-cases-2026-06-01.md § EC-6
 * @see .claude/knowledge-base/plans/adapters-openai-cycle-2-plan.md § T2.1 + ADR D1
 * @see .claude/knowledge-base/reviews/adapters-openai-cycle-2-edge-cases-2026-06-01.md § EC-3
 */
import { describe, it, expect } from 'vitest';
import * as root from './index.js';

describe('@usetheo/memory root barrel — ADR D4 enforcement', () => {
  it('does NOT re-export DeterministicStubEmbedder from root', () => {
    expect((root as Record<string, unknown>)['DeterministicStubEmbedder']).toBeUndefined();
  });

  it('does NOT re-export DeterministicStubLLM from root', () => {
    expect((root as Record<string, unknown>)['DeterministicStubLLM']).toBeUndefined();
  });

  it('does NOT re-export OpenAIEmbedder from root (EC-3, adapters-openai-cycle-2)', () => {
    expect((root as Record<string, unknown>)['OpenAIEmbedder']).toBeUndefined();
  });

  it('does NOT re-export OpenAILLM from root (EC-3, adapters-openai-cycle-2)', () => {
    expect((root as Record<string, unknown>)['OpenAILLM']).toBeUndefined();
  });

  it('preserves existing root re-export of pre-existing zero-vector StubEmbedder (ADR D1)', () => {
    // The pre-existing src/local/stubs.ts StubEmbedder + StubLLM (zero-vector
    // probe-safe) stays root-re-exported per ADR D1 — backward-compat for
    // consumers that imported them at v0.2.
    expect((root as Record<string, unknown>)['StubEmbedder']).toBeDefined();
    expect((root as Record<string, unknown>)['StubLLM']).toBeDefined();
  });
});
