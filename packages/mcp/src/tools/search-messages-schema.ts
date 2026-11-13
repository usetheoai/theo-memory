/**
 * `search_messages` tool: input and output schemas, name and description (ADR-0031).
 *
 * Search over the raw messages the active scope can see, separate from `recall`: BM25 fused
 * with embedding similarity. It reaches a turn extraction kept no fact of (an assistant
 * suggestion, a detail said in passing), by its words or by its meaning.
 */
import { z } from 'zod';

import { MAX_QUERY_BYTES } from './constants.js';

export const TOOL_NAME = 'search_messages' as const;

export const DESCRIPTION =
  'Search the raw conversation messages of the active scope by words and by meaning, and return the best matches with their score. Use it when recall finds no fact for something that was said, such as a suggestion or a detail mentioned in passing. The list is ranked, not filtered: later items can be loosely related. Pass `surroundingTurns: 1` to get the turns just before and after each match, such as the reply to a matching question. Omit `sessionId` to search the durable GLOBAL messages; pass it to search that SESSION plus the global ones.';

export const INPUT_SCHEMA = z
  .object({
    /** What to look for, in words or as a question. Capped at MAX_QUERY_BYTES. */
    query: z.string().min(1).max(MAX_QUERY_BYTES),
    /** When present, search this session of the authenticated user plus the user's global messages. */
    sessionId: z.string().min(1).optional(),
    /** Maximum messages to return. Default 5. */
    limit: z.number().int().min(1).max(100).optional(),
    /** Leave out messages observed after this instant (ISO 8601 datetime). */
    asOf: z.string().datetime().optional(),
    /** Turns to return on each side of every result, 0..5. 1 brings the reply to a matching question. */
    surroundingTurns: z.number().int().min(0).max(5).optional(),
  })
  .strict();

export type SearchMessagesInput = z.infer<typeof INPUT_SCHEMA>;

const LOGGED_MESSAGE = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  /** When the message was sent, if the writer declared it (ISO 8601), else null. */
  observedAt: z.string().nullable(),
  /** When the log received it (ISO 8601). */
  loggedAt: z.string(),
});

export const OUTPUT_SCHEMA = z.object({
  messages: z.array(
    LOGGED_MESSAGE.extend({
      /** Fused rank score (Reciprocal Rank Fusion); higher is a better match. */
      score: z.number(),
      /** The turns logged just before and after, oldest first; only with `surroundingTurns`. */
      surrounding: z.object({ before: z.array(LOGGED_MESSAGE), after: z.array(LOGGED_MESSAGE) }).optional(),
    }),
  ),
});

export type SearchMessagesOutput = z.infer<typeof OUTPUT_SCHEMA>;
