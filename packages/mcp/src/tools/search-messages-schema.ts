/**
 * `search_messages` tool: input and output schemas, name and description (ADR-0031).
 *
 * BM25 search over the raw messages the active scope can see, separate from `recall`. It
 * reaches a turn extraction kept no fact of (an assistant suggestion, a detail said in
 * passing), and matches words, not meaning.
 */
import { z } from 'zod';

import { MAX_QUERY_BYTES } from './constants.js';

export const TOOL_NAME = 'search_messages' as const;

export const DESCRIPTION =
  'Search the raw conversation messages of the active scope by keyword (BM25) and return the best matches with their score. Use it when recall finds no fact for something that was said, such as a suggestion or a detail mentioned in passing. It matches words, not meaning, so reuse the words likely spoken. Omit `sessionId` to search the durable GLOBAL messages; pass it to search that SESSION plus the global ones.';

export const INPUT_SCHEMA = z
  .object({
    /** Keywords to match against message text. Capped at MAX_QUERY_BYTES. */
    query: z.string().min(1).max(MAX_QUERY_BYTES),
    /** When present, search this session of the authenticated user plus the user's global messages. */
    sessionId: z.string().min(1).optional(),
    /** Maximum messages to return. Default 5. */
    limit: z.number().int().min(1).max(100).optional(),
    /** Leave out messages observed after this instant (ISO 8601 datetime). */
    asOf: z.string().datetime().optional(),
  })
  .strict();

export type SearchMessagesInput = z.infer<typeof INPUT_SCHEMA>;

export const OUTPUT_SCHEMA = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
      /** BM25 score; higher is a better match. */
      score: z.number(),
      /** When the message was sent, if the writer declared it (ISO 8601), else null. */
      observedAt: z.string().nullable(),
      /** When the log received it (ISO 8601). */
      loggedAt: z.string(),
    }),
  ),
});

export type SearchMessagesOutput = z.infer<typeof OUTPUT_SCHEMA>;
