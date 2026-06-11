/**
 * Test fixture: minimal LLM impl that returns a canned response.
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T1.2
 */
import type { LLM, LLMResponse, Message } from '../../dip/llm.js';

export class CannedResponseLlm implements LLM {
  constructor(private readonly cannedJsonResponse: string) {}

  generateResponse(
    _messages: readonly Message[],
    _responseFormat?: { type: 'json' | 'text' },
    _tools?: readonly unknown[],
  ): Promise<unknown> {
    return Promise.resolve({ text: this.cannedJsonResponse });
  }

  generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ role: 'assistant', content: this.cannedJsonResponse });
  }
}

export class FailingLlm implements LLM {
  generateResponse(): Promise<unknown> {
    return Promise.reject(new Error('simulated network failure'));
  }
  generateChat(): Promise<LLMResponse> {
    return Promise.reject(new Error('simulated network failure'));
  }
}
