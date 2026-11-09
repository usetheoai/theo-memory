/**
 * MessageLog DIP: the immutable record of the raw messages each write received.
 *
 * Extracted facts are a lossy reading of a conversation. The log keeps what was actually
 * said, so that (a) extraction can read the preceding turns of the same scope as context,
 * (b) every fact can be traced to the exact messages that produced it, and (c) recall can
 * return the source text alongside a fact.
 *
 * Messages are append-only: there is no update. They leave the log only by erasure, and a
 * hard forget of a memory erases the messages that produced it (ADR-0027), so forgotten
 * content cannot survive as evidence of another fact.
 */
import type { Message } from '../message.js';
import type { Filters } from '../scope.js';

export interface LoggedMessage {
  readonly id: string;
  readonly role: Message['role'];
  readonly content: string;
  /** When the message was sent, as declared by the caller (`RememberOptions.observedAt`); null when not declared. */
  readonly observedAt: Date | null;
  /** When the log received it. */
  readonly loggedAt: Date;
}

export interface MessageLog {
  /** Append messages to the scope's log, in order. Returns one id per message, in the same order. */
  append(filters: Filters, messages: readonly Message[], observedAt?: Date): Promise<readonly string[]>;

  /** Record that each memory in `memoryIds` was produced from each message in `messageIds`. Idempotent. */
  linkSources(filters: Filters, memoryIds: readonly string[], messageIds: readonly string[]): Promise<void>;

  /** The last `limit` messages logged under exactly this scope, oldest first. */
  recent(filters: Filters, limit: number): Promise<readonly LoggedMessage[]>;

  /** The messages that produced a memory, oldest first. Empty when the memory has none in this scope. */
  sourcesOf(filters: Filters, memoryId: string): Promise<readonly LoggedMessage[]>;

  /** `sourcesOf` for several memories in one call. Memories without sources may be absent from the map. */
  sourcesFor(filters: Filters, memoryIds: readonly string[]): Promise<ReadonlyMap<string, readonly LoggedMessage[]>>;

  /**
   * Erase the messages that produced a memory, together with their links to any other memory.
   * Returns the number of messages erased. Called by hard forget.
   */
  eraseSourcesOf(filters: Filters, memoryId: string): Promise<number>;
}
