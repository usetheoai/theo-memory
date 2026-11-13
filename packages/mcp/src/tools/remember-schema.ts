/**
 * `remember` tool — input schema, metadata, description.
 *
 * Persists a free-form note to scoped memory. The MCP server's dispatch handler
 * (T5.1) routes valid input to `memory.remember(content, metadata?)`.
 *
 * @see ADR D2 — Tool schema: zod-authored, 4 separate tools
 * @see ADR D6 — Error mechanisms: zod validation fail → Protocol Error -32602
 * @see EC-2 — Payload size cap absorbed via MAX_CONTENT_BYTES
 */
import { MemoryEvidenceSchema } from '@usetheo/memory/contract';
import { z } from 'zod';

import { MAX_CONTENT_BYTES } from './constants.js';

export const TOOL_NAME = 'remember' as const;

export const DESCRIPTION =
  'Persist a free-form note to scoped memory. Use this when the user states a preference, fact, or decision worth recalling later. Choose WHERE it lives: omit `sessionId` to store in the durable GLOBAL memory (remembered across all sessions — preferences, long-lived facts, decisions); pass `sessionId` to store it in that SESSION only (ephemeral working context that should not leak into other conversations). Pass `infer:false` to store the content verbatim without LLM extraction. This stores contextual memory, not authoritative purchases or calendar records; use the application tools for exact operations. Do not turn temporary choices into permanent preferences.';

/**
 * Input shape for `tools/call remember`.
 *
 * The USER identity is NOT a tool argument — it comes from the auth-trusted
 * request-context (AsyncLocalStorage, ADR D3); the agent can never address another
 * user. M8 (ADR D6 amendment): the agent MAY pass a `sessionId` to route the write to
 * a session sub-partition of its OWN user space `(workspace, user, session)`; omitting
 * it stores globally `(workspace, user)`.
 */
export const INPUT_SCHEMA = z.object({
  /** The note to remember. Free-form natural language. Capped at MAX_CONTENT_BYTES (EC-2). */
  content: z.string().min(1).max(MAX_CONTENT_BYTES),
  /**
   * M8 routing (ADR D6): when present, store this note in the SESSION scope
   * `(workspace, user, session)` instead of the durable GLOBAL scope `(workspace, user)`.
   * The user is always the auth-trusted context user — this only picks the sub-partition.
   */
  sessionId: z.string().min(1).optional(),
  /** Optional flat key/value metadata payload (primitives only — upstream-pipeline parity). */
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  /**
   * When false, skip the LLM extraction pipeline and store the content verbatim.
   * Default true (LLM fact-extraction mode). Mirrors REST `POST /v1/remember` `infer` flag.
   */
  infer: z.boolean().optional(),
  evidence: MemoryEvidenceSchema.optional(),
  idempotencyKey: z.string().trim().min(1).max(256).optional(),
  expiresAt: z.string().datetime({offset:true}).optional(),
  /** When the content was said or written (ISO-8601), if not now; relative dates resolve against it. */
  observedAt: z.string().datetime({offset:true}).optional(),
    strictExtraction: z.boolean().optional(),
});

export type RememberInput = z.infer<typeof INPUT_SCHEMA>;
