/**
 * `list_entities` tool — input schema, metadata, description (M14 T2.2).
 *
 * Lists the entities the agent has accumulated in the ACTIVE scope. The scope is the
 * Principal `(workspace, user)` resolved from the credential — NOT from any argument
 * (ADR-M14-1). The schema carries NO identity field; the only optional input is a `limit`.
 *
 * @see ADR-M14-1 — identidade do Principal server-side
 * @see packages/api/src/server/handlers/entities.ts — REST counterpart reused as-is
 */
import { z } from 'zod';

export const TOOL_NAME = 'list_entities' as const;

export const DESCRIPTION =
  'List the entities (people, orgs, products, concepts) remembered in the active scope, most-recent first. Returns each entity name with its memory count. Scope is the active user — no identity argument is accepted.';

/** Input shape for `tools/call list_entities`. */
export const INPUT_SCHEMA = z
  .object({
    /** Optional cap on the number of entities returned. */
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();

export type ListEntitiesInput = z.infer<typeof INPUT_SCHEMA>;
