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
import { z } from 'zod';

import { MAX_CONTENT_BYTES } from './constants.js';

export const TOOL_NAME = 'remember' as const;

export const DESCRIPTION =
  'Persist a free-form note to scoped memory. The fact will be extracted and stored under the active user/session/agent scope. Use this when the user states a preference, fact, or decision worth recalling later.';

/**
 * Input shape for `tools/call remember`.
 *
 * Scope is NOT a tool argument — it comes from request-context (AsyncLocalStorage, ADR D3).
 * Agents do not need to (and MUST NOT) pass scope explicitly.
 */
export const INPUT_SCHEMA = z.object({
  /** The note to remember. Free-form natural language. Capped at MAX_CONTENT_BYTES (EC-2). */
  content: z.string().min(1).max(MAX_CONTENT_BYTES),
  /** Optional flat key/value metadata payload (primitives only — REDACTED parity). */
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export type RememberInput = z.infer<typeof INPUT_SCHEMA>;
