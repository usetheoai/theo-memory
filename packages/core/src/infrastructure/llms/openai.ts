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
 * @see src/core/dip/llm.ts § LLM.generateResponse (3rd param contract)
 */
import OpenAI from 'openai';

import type { LLM } from '../../domain/dip/llm.js';
import type { LLMResponse, Message } from '../../domain/message.js';

// Lazy singleton — instantiated on first call so build-time page-data
// collection (which runs without runtime env) does not throw.
let _openai: OpenAI | null = null;
function client(): OpenAI {
  if (_openai === null) {
    _openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
  }
  return _openai;
}

const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';

/**
 * E2E follow-up (2026-06-02): the demo's `local-openrouter` mode routes via
 * `OPENAI_BASE_URL=https://openrouter.ai/api/v1` per ADR D5, but OpenRouter
 * requires fully-qualified model identifiers (e.g., `openai/gpt-4o-mini`,
 * `anthropic/claude-3-5-sonnet`) — the bare `gpt-4o-mini` returns 404.
 *
 * Resolve model at CALL TIME (not module-load) so the demo can set
 * `OPENAI_CHAT_MODEL=openai/gpt-4o-mini` after `new OpenAILLM()` is
 * already on the heap. Falls back to the locked default per ADR D3
 * when the env var is unset (no behavior change for plain OpenAI mode).
 *
 * Addresses SDK @todo at line 37 (constructor-param model override remains
 * deferred to Cycle 2.X; this env-var path is the bridge).
 */
/** @internal exported for unit-test access only; not part of the public DIP. */
export function resolveChatModel(): string {
  const fromEnv = process.env['OPENAI_CHAT_MODEL'];
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : DEFAULT_CHAT_MODEL;
}

function toOpenAIMessages(
  messages: readonly Message[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/** Constructor options for {@link OpenAILLM}. */
export interface OpenAILLMOptions {
  /**
   * Sampling temperature sent on every call, in [0, 2]. Defaults to 0 so the same input yields
   * the same extraction and a recorded write can be replayed (#241). Without it the provider
   * default applies, which is 1 on the OpenAI API.
   */
  readonly temperature?: number;
}

export class OpenAILLM implements LLM {
  readonly #temperature: number;

  constructor(options: OpenAILLMOptions = {}) {
    const temperature = options.temperature ?? 0;
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new RangeError(`OpenAILLM temperature must be a number in [0, 2], got ${String(options.temperature)}`);
    }
    this.#temperature = temperature;
  }

  async generateResponse(
    messages: readonly Message[],
    responseFormat?: { readonly type: 'json' | 'text' },
    _tools?: readonly unknown[],
  ): Promise<unknown> {
    void _tools;
    const resp = await client().chat.completions.create({
      model: resolveChatModel(),
      messages: toOpenAIMessages(messages),
      temperature: this.#temperature,
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
      model: resolveChatModel(),
      messages: toOpenAIMessages(messages),
      temperature: this.#temperature,
    });
    return {
      content: resp.choices[0]?.message.content ?? '',
      role: 'assistant',
    };
  }
}
