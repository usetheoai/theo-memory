/**
 * Smoke + DIP-shape contract tests for OpenAILLM.
 *
 * **EC-2 absorption — DO NOT call .generateResponse() or .generateChat() in
 * this file.** Those methods make a live request to the OpenAI chat-completions
 * API and would cost real tokens (and fail with 401 in CI without
 * OPENAI_API_KEY). The smoke tests below assert the DIP shape only — class
 * export, method type — per ADR D5 (integration tests deferred to consumer
 * dogfood via the chat-with-memory demo, which IS the real-API integration
 * surface).
 *
 * @see .claude/knowledge-base/plans/adapters-openai-cycle-2-plan.md § T1.2
 * @see .claude/knowledge-base/reviews/adapters-openai-cycle-2-edge-cases-2026-06-01.md § EC-2
 */
import { describe, it, expect } from 'vitest';
import { OpenAILLM } from '../openai.js';

describe('OpenAILLM', () => {
  it('exposes the LLM DIP shape (class + generateResponse + generateChat methods)', () => {
    // Given a fresh OpenAILLM constructor reference
    // When an instance is created without an OPENAI_API_KEY (lazy singleton
    // defers client construction until first method call — so the constructor
    // itself never throws)
    const llm = new OpenAILLM();

    // Then the DIP-mandated method surface is present
    expect(OpenAILLM).toBeDefined();
    expect(typeof llm.generateResponse).toBe('function');
    expect(typeof llm.generateChat).toBe('function');
  });
});
