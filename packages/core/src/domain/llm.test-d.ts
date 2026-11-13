import { expectTypeOf, test } from 'vitest';

import type { LLM, LLMResponse, Message, Role } from './dip/llm.js';

test('Role is exactly the three locked tiers (no function/tool at v0.0)', () => {
  expectTypeOf<Role>().toEqualTypeOf<'system' | 'user' | 'assistant'>();
});

test('Message has role and content, and an optional author name', () => {
  expectTypeOf<Message>().toEqualTypeOf<{
    readonly role: Role;
    readonly content: string;
    readonly name?: string;
  }>();
});

test('LLMResponse exposes content + role + optional toolCalls', () => {
  expectTypeOf<LLMResponse['content']>().toEqualTypeOf<string>();
  expectTypeOf<LLMResponse['role']>().toEqualTypeOf<Role>();
  expectTypeOf<LLMResponse['toolCalls']>().toEqualTypeOf<
    readonly { readonly name: string; readonly arguments: string }[] | undefined
  >();
});

test('LLM has exactly the 2 locked methods (D8)', () => {
  expectTypeOf<keyof LLM>().toEqualTypeOf<'generateResponse' | 'generateChat'>();
});

test('generateResponse accepts (messages, responseFormat?, tools?) and returns Promise<unknown>', () => {
  expectTypeOf<LLM['generateResponse']>().parameters.toEqualTypeOf<
    [
      readonly Message[],
      ({ readonly type: 'json' | 'text' })?,
      (readonly unknown[])?,
    ]
  >();
  expectTypeOf<LLM['generateResponse']>().returns.resolves.toEqualTypeOf<unknown>();
});

test('generateChat(messages) returns Promise<LLMResponse>', () => {
  expectTypeOf<LLM['generateChat']>().parameters.toEqualTypeOf<[readonly Message[]]>();
  expectTypeOf<LLM['generateChat']>().returns.resolves.toEqualTypeOf<LLMResponse>();
});

test('a synthetic stub class structurally implements LLM', () => {
  class StubLLM implements LLM {
    async generateResponse(
      _messages: readonly Message[],
      _responseFormat?: { readonly type: 'json' | 'text' },
      _tools?: readonly unknown[],
    ): Promise<unknown> {
      return {};
    }

    async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
      return { content: '', role: 'assistant' };
    }
  }
  expectTypeOf<StubLLM>().toMatchTypeOf<LLM>();
});
