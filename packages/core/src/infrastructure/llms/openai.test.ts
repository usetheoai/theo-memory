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
import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import { OpenAILLM, resolveChatModel } from './openai.js';

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

describe('resolveChatModel — env-override bridge to OpenRouter-style provider/model ids', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env['OPENAI_CHAT_MODEL'];
    delete process.env['OPENAI_CHAT_MODEL'];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env['OPENAI_CHAT_MODEL'];
    else process.env['OPENAI_CHAT_MODEL'] = prev;
  });

  it('falls back to gpt-4o-mini when OPENAI_CHAT_MODEL is unset', () => {
    expect(resolveChatModel()).toBe('gpt-4o-mini');
  });

  it('falls back to gpt-4o-mini when OPENAI_CHAT_MODEL is empty', () => {
    process.env['OPENAI_CHAT_MODEL'] = '';
    expect(resolveChatModel()).toBe('gpt-4o-mini');
  });

  it('returns the env value when OPENAI_CHAT_MODEL is set to an OpenRouter-style id', () => {
    process.env['OPENAI_CHAT_MODEL'] = 'openai/gpt-4o-mini';
    expect(resolveChatModel()).toBe('openai/gpt-4o-mini');
  });

  it('returns the env value when OPENAI_CHAT_MODEL is set to a non-OpenAI provider', () => {
    process.env['OPENAI_CHAT_MODEL'] = 'anthropic/claude-3-5-sonnet';
    expect(resolveChatModel()).toBe('anthropic/claude-3-5-sonnet');
  });
});
