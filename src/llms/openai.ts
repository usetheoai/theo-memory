/**
 * OpenAILLM — LLM DIP backed by OpenAI's official TypeScript SDK.
 *
 * Lifted verbatim from `examples/chat-with-memory/lib/openai-adapters.ts`
 * (lines 49-92) per ADR D3 (MOVE-only Cycle 2 scope). Zero behavioral change
 * from the demo file: same model (`gpt-4o-mini` for chat + extraction), same
 * lazy-singleton client, same `response_format` routing, same JSON-parse
 * error path. The DIP-mandated `_tools?: readonly unknown[]` 3rd param is
 * added to `generateResponse` to match `src/core/dip/llm.ts:LLM.generateResponse`
 * verbatim (Cycle 1 stub precedent at `src/llms/stub.ts:106`); currently
 * ignored (`void _tools;` discard) — function-calling support is Cycle 2.X scope.
 *
 * **EC-6 — optionalDependencies consumer guidance:** this module requires
 * `openai` as an `optionalDependency`. Consumers using
 * `npm install --no-optional` will get a TypeScript compile error if they
 * import this file; use `@usetheo/memory/llms/stub` instead for offline /
 * deterministic dev.
 *
 * **EC-8 — lazy singleton scope:** the `_openai` module-level var below is
 * a lazy singleton: ONE OpenAI client instance per module per process (two
 * total: one in `embedders/openai.ts`, one in `llms/openai.ts`). Sharing
 * across modules would require a new shared file not present in the demo
 * (scope creep per ADR D3).
 *
 * **EC-9 — env timing:** `process.env.OPENAI_API_KEY` MUST be set BEFORE
 * the first `.generateResponse()` or `.generateChat()` call — the singleton
 * captures env at first invocation, not at module-load. Late-set env yields
 * `apiKey: undefined` and the OpenAI client throws 401. Use
 * `import 'dotenv/config'` before importing this module.
 *
 * **EC-10 — opaque JSON-parse error shape (preserved per ADR D3):** when
 * `generateResponse({ type: 'json' })` receives non-JSON content, the
 * method returns `{ error: 'non_json_response', raw: <content> }` INSTEAD
 * of throwing. Caller MUST inspect `result.error` before treating `result`
 * as the parsed shape. Future Cycle 2.X may throw a typed error.
 *
 * @todo Cycle 2.X — accept model name via constructor param (today hard-coded
 *   to `gpt-4o-mini` per ADR D3). Multi-account + `_tools` wiring to the
 *   `tools:` field of `chat.completions.create` deferred to Cycle 2.X.
 *
 * @see .claude/knowledge-base/plans/adapters-openai-cycle-2-plan.md § T1.2
 * @see .claude/knowledge-base/reviews/adapters-openai-cycle-2-edge-cases-2026-06-01.md § EC-6 + EC-7 + EC-8 + EC-9 + EC-10
 * @see src/core/dip/llm.ts § LLM.generateResponse (3rd param contract)
 */
import OpenAI from 'openai';

import type { LLM } from '../core/dip/llm.js';
import type { LLMResponse, Message } from '../core/message.js';

// Lazy singleton — instantiated on first call so build-time page-data
// collection (which runs without runtime env) does not throw.
let _openai: OpenAI | null = null;
function client(): OpenAI {
  if (_openai === null) {
    _openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
  }
  return _openai;
}

const CHAT_MODEL = 'gpt-4o-mini';

function toOpenAIMessages(
  messages: readonly Message[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

export class OpenAILLM implements LLM {
  async generateResponse(
    messages: readonly Message[],
    responseFormat?: { readonly type: 'json' | 'text' },
    _tools?: readonly unknown[],
  ): Promise<unknown> {
    void _tools;
    const resp = await client().chat.completions.create({
      model: CHAT_MODEL,
      messages: toOpenAIMessages(messages),
      response_format:
        responseFormat?.type === 'json'
          ? { type: 'json_object' }
          : { type: 'text' },
    });
    const content = resp.choices[0]?.message.content ?? '';
    if (responseFormat?.type === 'json') {
      try {
        return JSON.parse(content);
      } catch {
        return { error: 'non_json_response', raw: content };
      }
    }
    return { text: content };
  }

  async generateChat(messages: readonly Message[]): Promise<LLMResponse> {
    const resp = await client().chat.completions.create({
      model: CHAT_MODEL,
      messages: toOpenAIMessages(messages),
    });
    return {
      content: resp.choices[0]?.message.content ?? '',
      role: 'assistant',
    };
  }
}
