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

describe('clampEmbedInput (#109 live E2E — 8192-token model context)', () => {
  it('passes short input through verbatim and truncates beyond the char budget', async () => {
    // A 47K-char imported memory node 400'd the embedder ("maximum context length is
    // 8192 tokens") and the whole remember failed. The verbatim text is STORED in full;
    // only the embedding input is clamped (head-truncation, standard practice).
    const { clampEmbedInput, EMBED_INPUT_MAX_CHARS } = await import('./openai.js');
    expect(clampEmbedInput('short')).toBe('short');
    const long = 'x'.repeat(EMBED_INPUT_MAX_CHARS + 5000);
    expect(clampEmbedInput(long)).toHaveLength(EMBED_INPUT_MAX_CHARS);
    expect(EMBED_INPUT_MAX_CHARS).toBeLessThanOrEqual(16000); // ~5-6K tokens, safe under 8192
  });
});
