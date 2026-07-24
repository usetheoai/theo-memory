/**
 * `get_memory` tool — input schema, metadata, description (M14 T2.1).
 *
 * Retrieve a single memory by id from the ACTIVE scope. The scope is the Principal
 * `(workspace, user)` resolved from the credential — NOT from any argument (ADR-M14-1).
 * The schema therefore carries ONLY `id`; there is no `user_id`/`workspace_id` arg to
 * spoof.
 *
 * @see ADR-M14-1 — identidade do Principal server-side, nunca do argumento
 * @see ADR D2 — Tool schema: zod-authored, separate verbs
 */
import { z } from 'zod';

export const TOOL_NAME = 'get_memory' as const;

export const DESCRIPTION =
  'Retrieve a single memory by its id from the active scope. Returns the memory text and metadata, or a not-found result if no memory with that id exists in scope.';

/** Input shape for `tools/call get_memory`. */
export const INPUT_SCHEMA = z
  .object({
    /** UUID of the memory to retrieve. */
    id: z.string().uuid(),
  })
  .strict();

export type GetMemoryInput = z.infer<typeof INPUT_SCHEMA>;
