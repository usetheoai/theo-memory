import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { MemoryEvidence } from '../domain/memory-evidence.js';
import type { MemoryItem, MemoryItemWithScore } from '../domain/memory-item.js';
import type { ScopedMemory } from '../domain/memory-store.js';
import type { RecallOptions } from '../domain/options.js';

/**
 * Authoritative application data. Implement with parameterized domain queries,
 * not semantic recall or model-generated SQL. Bind tenant/user before injection.
 * Writes resolve only after the application store acknowledges persistence.
 * @see docs/memory-semantics.md
 */
export interface SessionFactStore<Query, Command, Fact> {
  lookup(query: Query): Promise<readonly Fact[]>;
  write(command: Command): Promise<Fact>;
}

/** Only extracted meaning enters memory. Media bytes/URLs belong in separate storage. */
export const SessionObservationSchema = z.object({
  text: z.string().trim().min(1).max(100_000),
  sourceId: z.string().trim().min(1).max(512),
  originSourceId: z.string().trim().min(1).max(512).optional(),
  modality: z.enum(['text', 'audio', 'video']).default('text'),
  expiresAt: z.date().optional(),
  idempotencyKey: z.string().trim().min(1).max(256).optional(),
  attributedTo: z.string().trim().min(1).optional(),
}).strict();

/** A transcript or textual observation referencing separately retained media, if any. */
export type SessionObservation = z.input<typeof SessionObservationSchema>;

export type MemoryExtractionResult =
  | { readonly status: 'succeeded'; readonly items: readonly MemoryItem[] }
  | { readonly status: 'failed'; readonly error: unknown };

/** Completion never rejects unobserved; failures are also reported by flush()/close(). */
export interface MemoryExtractionJob {
  readonly jobId: string;
  readonly completion: Promise<MemoryExtractionResult>;
}

/** Queue is full or the session is closed; the observation was NOT accepted. */
export class MemorySessionUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemorySessionUnavailable';
  }
}

export interface MemorySessionConfig<Query, Command, Fact> {
  readonly memory: Pick<ScopedMemory, 'recall' | 'remember'>;
  readonly facts: SessionFactStore<Query, Command, Fact>;
  /** Maximum accepted, unfinished extractions. Default 32; no silent eviction. */
  readonly maxPending?: number;
}

/**
 * Session integration: exact domain operations and contextual recall stay separate.
 * Extraction starts on a later event-loop turn, runs serially, and must be drained
 * before process exit. This bounded queue is in-process, NOT crash-durable.
 * Construct one per authenticated session with already-bound stores.
 * @see docs/memory-semantics.md
 */
export class MemorySession<Query, Command, Fact> {
  private readonly maxPending: number;
  private readonly pending = new Set<Promise<MemoryExtractionResult>>();
  private readonly failures: unknown[] = [];
  private tail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly config: MemorySessionConfig<Query, Command, Fact>) {
    this.maxPending = config.maxPending ?? 32;
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1) {
      throw new RangeError('maxPending must be a positive safe integer.');
    }
  }

  /** Read exact facts and relevant understanding concurrently before conversation. */
  async loadContext(
    factQuery: Query,
    memoryQuery: string,
    options?: RecallOptions,
  ): Promise<{ readonly facts: readonly Fact[]; readonly memories: readonly MemoryItemWithScore[] }> {
    this.assertOpen();
    const [facts, memories] = await Promise.all([
      this.config.facts.lookup(factQuery),
      this.config.memory.recall(memoryQuery, options),
    ]);
    return { facts, memories };
  }

  /** Exact queries never fall back to approximate matches when a record is absent. */
  lookupFacts(query: Query): Promise<readonly Fact[]> {
    this.assertOpen();
    return this.config.facts.lookup(query);
  }

  /** Await this tool call before telling the user an operational change was saved. */
  writeFact(command: Command): Promise<Fact> {
    this.assertOpen();
    return this.config.facts.write(command);
  }

  /**
   * Accept a turn, interval, or final transcript without waiting for LLM extraction.
   * Acceptance means queued, not persisted. Inspect completion or await flush().
   * Strict validation rejects media fields and malformed textual observations.
   */
  enqueueUnderstanding(observation: SessionObservation): MemoryExtractionJob {
    this.assertOpen();
    const parsed = SessionObservationSchema.parse(observation);
    if (this.pending.size >= this.maxPending) {
      throw new MemorySessionUnavailable('Memory extraction queue is full; observation was not accepted.');
    }
    const jobId = randomUUID();
    const evidence: MemoryEvidence = {
      kind: 'inferred',
      sourceId: parsed.sourceId,
      ...(parsed.originSourceId !== undefined ? { originSourceId: parsed.originSourceId } : {}),
      modality: parsed.modality,
    };
    // Schedule within the caller's async context so tenant scoping follows the job.
    const nextTurn = new Promise<void>((resolve) => setImmediate(resolve));
    const completion = Promise.all([this.tail, nextTurn]).then(async (): Promise<MemoryExtractionResult> => {
      try {
        const items = await this.config.memory.remember(parsed.text, {
          infer: true,
          ...(parsed.expiresAt !== undefined ? { expiresAt: parsed.expiresAt } : {}),
          ...(parsed.idempotencyKey !== undefined ? { idempotencyKey: parsed.idempotencyKey } : {}),
          strictExtraction: true,
          evidence,
          ...(parsed.attributedTo !== undefined ? { attributedTo: parsed.attributedTo } : {}),
        });
        return { status: 'succeeded', items };
      } catch (error) {
        this.failures.push(error);
        return { status: 'failed', error };
      }
    });
    this.pending.add(completion);
    this.tail = completion.then(() => { this.pending.delete(completion); });
    return { jobId, completion };
  }

  /** Drain accepted work, including work accepted while draining; report all failures. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) await this.tail;
    if (this.failures.length > 0) {
      throw new AggregateError(this.failures.splice(0), 'Memory extraction failed.');
    }
  }

  /** Stop accepting work and wait for accepted extractions, including failures. */
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  private assertOpen(): void {
    if (this.closed) throw new MemorySessionUnavailable('Memory session is closed.');
  }
}
