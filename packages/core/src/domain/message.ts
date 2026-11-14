/**
 * Chat-message shape shared across LLM DIP + history manager.
 * Verbatim from the upstream message shape with Role tightened to a string-union.
 *
 * @see ADR-0008 — DIP method counts (Role is the v0.0-locked union; v0.3 adds 'function'/'tool').
 */

/** Tighter than the upstream `string` Role. v0.3 (agent-tools) will add 'function' / 'tool' as a generic. */
export type Role = 'system' | 'user' | 'assistant';

export interface Message {
  readonly role: Role;
  readonly content: string;
  /**
   * The name of the person who wrote the message, when the caller knows it (a group chat, a
   * transcript with several speakers). Facts the author states about themself are then written
   * with this name. Leave it out in a one-to-one chat: the author stays the speaker `user`.
   */
  readonly name?: string;
  /**
   * True when the content is material the author passed along (a pasted document, an email, a
   * tool result) and not something they said. The write path leaves it out: it is not
   * extracted, not logged and not embedded, so nothing in it becomes a memory.
   */
  readonly reference?: boolean;
}

export interface LLMResponse {
  readonly content: string;
  readonly role: Role;
  readonly toolCalls?: readonly {
    readonly name: string;
    readonly arguments: string;
  }[];
}
