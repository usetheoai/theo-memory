/**
 * LLM DIP — adapter contract for chat-completion providers.
 *
 * @see ADR-0008 — DIP method counts (LLM: 2 required).
 * @see ADR-0004 — API verbs (reflect() uses LLM via extraction pipeline).
 */
import type { LLMResponse, Message } from '../message.js';

export type { LLMResponse, Message, Role } from '../message.js';

export interface LLM {
  /**
   * Free-form generation. Provider response shape varies (different providers return
   * different field names) — the adapter normalizes downstream.
   *
   * @see ADR-0008 + ADR-0004.
   * The `tools` parameter is intentionally opaque (`ReadonlyArray<unknown>`) at v0.0.
   * v0.3 (agent-tools layer) will lock a typed schema; expect generic `LLM<TToolSchema>`
   * at that point. Adapters targeting v0.0 to v0.3 MUST type their tool shape locally
   * (avoid `unknown[]` in adapter code).
   */
  generateResponse(
    messages: readonly Message[],
    responseFormat?: { readonly type: 'json' | 'text' },
    tools?: readonly unknown[],
  ): Promise<unknown>;

  /** Chat-completion call with normalized LLMResponse shape. */
  generateChat(messages: readonly Message[]): Promise<LLMResponse>;
}
