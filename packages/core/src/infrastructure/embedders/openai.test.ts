/**
 * Smoke + DIP-shape contract tests for OpenAIEmbedder.
 *
 * **EC-2 absorption — DO NOT call .embed() or .embedBatch() in this file.**
 * Those methods make a live request to the OpenAI API and would cost real
 * tokens (and fail with 401 in CI without OPENAI_API_KEY). The smoke tests
 * below assert the DIP shape only — class export, method type — per ADR D5
 * (integration tests deferred to consumer dogfood via the chat-with-memory
 * demo, which IS the real-API integration surface).
 *
 * @see .claude/knowledge-base/plans/adapters-openai-cycle-2-plan.md § T1.1
 * @see .claude/knowledge-base/reviews/adapters-openai-cycle-2-edge-cases-2026-06-01.md § EC-2
 */
import { describe, it, expect } from 'vitest';

import { OpenAIEmbedder } from './openai.js';

describe('OpenAIEmbedder', () => {
  it('exposes the Embedder DIP shape (class + embed + embedBatch methods)', () => {
    // Given a fresh OpenAIEmbedder constructor reference
    // When an instance is created without an OPENAI_API_KEY (lazy singleton
    // defers client construction until first .embed() call — so the
    // constructor itself never throws)
    const embedder = new OpenAIEmbedder();

    // Then the DIP-mandated method surface is present
    expect(OpenAIEmbedder).toBeDefined();
    expect(typeof embedder.embed).toBe('function');
    expect(typeof embedder.embedBatch).toBe('function');
  });
});
