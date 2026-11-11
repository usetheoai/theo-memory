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

/** A logged message returned by `search`, with its BM25 score (higher is better). */
export interface ScoredLoggedMessage extends LoggedMessage {
  readonly score: number;
}

export interface MessageSearchOptions {
  /** Maximum number of messages returned. */
  readonly limit: number;
  /**
   * The query's embedding. When given, the BM25 ranking and the cosine ranking of the visible
   * messages that carry an embedding are fused by Reciprocal Rank Fusion (ADR-0031), and each
   * result's `score` is the fused score. Without it, the search is BM25 only.
   */
  readonly queryVector?: readonly number[];
}

export interface MessageLog {
  /**
   * Append messages to the scope's log, in order. Returns one id per message, in the same order.
   * `embeddings`, when given, holds one vector (or null) per message, aligned with `messages`;
   * a message stored without one is reachable by `search` through its words only.
   */
  append(
    filters: Filters,
    messages: readonly Message[],
    observedAt?: Date,
    embeddings?: readonly (readonly number[] | null)[],
  ): Promise<readonly string[]>;

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

  /**
   * Erase every message of a scope, whether or not it produced a memory, with its links.
   * Matching follows the memory store's scope filter, so a reset erases the same partition
   * from both: each id present in `filters` must be equal, an absent id matches any value,
   * and `scopeHierarchy: 'global'` requires no session and no agent. A session hierarchy is a
   * recall predicate, not a partition, and is rejected. Returns the number of messages erased.
   */
  eraseScope(filters: Filters): Promise<number>;

  /**
   * Okapi BM25 over the messages `filters` can see, best first; messages sharing no term with
   * the query are left out. Visibility follows the memory store: a user's global scope sees no
   * session or agent messages, and a user-bound session (`scopeHierarchy: { session }`) sees its
   * own messages plus the user's global ones. With `filters.asOf`, a message observed (or, without
   * an observation time, logged) after that instant is left out. With `options.queryVector`, the
   * ranking is hybrid (see `MessageSearchOptions.queryVector`) and a message need not share a word.
   */
  search(filters: Filters, query: string, options: MessageSearchOptions): Promise<readonly ScoredLoggedMessage[]>;
}

/**
 * Checks the `embeddings` argument of `MessageLog.append`: absent, or one entry per message.
 * Every adapter calls it first, so a misaligned batch fails before anything is written.
 */
export function assertEmbeddingsAligned(messages: readonly Message[], embeddings: readonly unknown[] | undefined): void {
  if (embeddings !== undefined && embeddings.length !== messages.length) {
    throw new RangeError(`MessageLog.append: ${String(embeddings.length)} embeddings for ${String(messages.length)} messages`);
  }
}
