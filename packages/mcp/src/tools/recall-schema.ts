/**
 * `recall` tool — input + output schemas, metadata, description.
 *
 * Searches scoped memory and returns the top-K matches. The MCP server's dispatch
 * handler (T5.1) routes valid input to `memory.recall(query, options)`.
 *
 * @see ADR D2 — Tool schema: zod-authored; recall ships outputSchema + structuredContent
 * @see ADR D6 — Error mechanisms
 * @see EC-2 — Payload size cap absorbed via MAX_QUERY_BYTES
 * @see EC-10 — recall.threshold range [0, 1] default 0
 */
import { z } from 'zod';

import { MAX_QUERY_BYTES } from './constants.js';

export const TOOL_NAME = 'recall' as const;

export const DESCRIPTION =
  'Search scoped memory and return the top-K matches for the query. Use this when the user references past work, asks "how should we..." style questions, or hits an error worth grounding in prior context. Omit `sessionId` to search the durable GLOBAL memory; pass `sessionId` to search that SESSION\'s working context instead.';

/**
 * Input shape for `tools/call recall`.
 *
 * topK default 20 honors v0.0 contract per `src/core/retrieval/pipeline.ts:73`
 * (upstream-pipeline parity, architecture.md § 5 "two surfaces, one contract").
 * threshold default 0 means "return everything ranked"; EC-10 caps range to [0, 1].
 */
export const INPUT_SCHEMA = z.object({
  /** The search query. Free-form natural language (nouns + entities work best). Capped at MAX_QUERY_BYTES (EC-2). */
  query: z.string().min(1).max(MAX_QUERY_BYTES),
  /**
   * M8 routing (ADR D6): when present, search the SESSION scope
   * `(workspace, user, session)` instead of the durable GLOBAL scope `(workspace, user)`.
   * The user is always the auth-trusted context user.
   */
  sessionId: z.string().min(1).optional(),
  /** Maximum results to return. Default 20 per v0.0 contract. */
  topK: z.number().int().min(1).max(100).default(20),
  /** Minimum composite score to include (additive composite, [0, 1] range per EC-10). */
  threshold: z.number().min(0).max(1).default(0),
  /**
   * M0 — point-in-time recall (ADR-0011). ISO 8601 datetime; the handler parses
   * it to a Date. Returns the memory state valid at that instant. Parity with
   * REST `POST /v1/recall`.
   */
  asOf: z.string().datetime().optional(),
  /**
   * M0 — graph-aware recall (v0.19.0 SDK capability), parity with REST. Bounded:
   * `hops` literal 1|2 (mirror the SDK type), `limit` <= 100 (DoS-guard parity
   * with topK). `.strict()` rejects unknown inner keys; optional keeps it
   * default-OFF (byte-unchanged when omitted). The temporal filter (t_invalid /
   * asOf) is applied inside the shared expansion store.
   */
  graphExpand: z
    .object({
      hops: z.union([z.literal(1), z.literal(2)]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict()
    .optional(),
  /** ADR-0027 — return each result's raw source messages (what was actually said). Default off. */
  includeSources: z.boolean().optional(),
});

export type RecallInput = z.infer<typeof INPUT_SCHEMA>;

/**
 * Output shape for `tools/call recall.structuredContent`.
 *
 * Minimal honest subset of `MemoryItemWithScore` (src/core/memory-item.ts:48):
 * LLM-visible fields only. Dropped: `hash` (internal dedup), `updatedAt` (==createdAt
 * under ADD-only ADR-0003) and `tInvalid` (current recall returns only valid rows). `tValid`,
 * `eventTime` and `durability` are on the row, as they are on REST: without `tValid` a reader
 * cannot tell when an imported fact was said. `attributedTo` is shipped at v1.1 (T1.1 + T2.2) as a first-class column
 * + filter, but the MCP recall tool surface is deferred to v1.2 alongside TheoKit
 * binding alignment (EC-13 plan deferral).
 *
 * `scope` shape matches `src/core/scope.ts` discriminated union (UserScope/SessionScope/AgentScope).
 */
const SCOPE_SCHEMA = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: z.string() }),
  z.object({ kind: z.literal('session'), sessionId: z.string(), userId: z.string().optional() }),
  z.object({ kind: z.literal('agent'), agentId: z.string() }),
]);

export const OUTPUT_SCHEMA = z.object({
  results: z.array(
    z.object({
      /** UUID v4 — opaque to the LLM; usable as forget(id) arg. */
      id: z.string(),
      /** The recalled fact, post-extraction. */
      text: z.string(),
      /** Composite score in [0, 1]; higher = better match. */
      score: z.number(),
      /** Typed scope (User/Session/Agent) the memory was written under. */
      scope: SCOPE_SCHEMA,
      /** Write timestamp (ISO 8601 string at wire boundary). */
      createdAt: z.string(),
      /**
       * When the fact was said (ISO 8601), or null on a row written before valid time existed.
       * It is the write time unless the write gave `observedAt`, as an import of older notes does.
       */
      tValid: z.string().nullable(),
      /** The date of the fact's event, counted from when it was said (ADR-0035). Absent when the fact names no time. */
      eventTime: z
        .object({ start: z.string(), end: z.string(), granularity: z.enum(['day', 'month']), expression: z.string() })
        .optional(),
      /** How long the extractor expected the statement to hold. */
      durability: z.enum(['durable', 'temporary', 'tentative']).optional(),
      /** Flat key/value payload set at write time. */
      metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
      /** Raw messages that produced the memory, oldest first; present only with `includeSources`. */
      sources: z
        .array(z.object({ role: z.string(), content: z.string(), observedAt: z.string().nullable() }))
        .optional(),
    }),
  ),
});

export type RecallOutput = z.infer<typeof OUTPUT_SCHEMA>;
