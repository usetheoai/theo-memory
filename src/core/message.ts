/**
 * Chat-message shape shared across LLM DIP + history manager.
 * Verbatim from Mem0-ts with Role tightened to a string-union.
 *
 * @see ADR-0008 — DIP method counts (Role is the v0.0-locked union; v0.3 adds 'function'/'tool').
 */

/** Tighter than Mem0's `string` Role. v0.3 (agent-tools) will add 'function' / 'tool' as a generic. */
export type Role = 'system' | 'user' | 'assistant';

export interface Message {
  readonly role: Role;
  readonly content: string;
}

export interface LLMResponse {
  readonly content: string;
  readonly role: Role;
  readonly toolCalls?: readonly {
    readonly name: string;
    readonly arguments: string;
  }[];
}
