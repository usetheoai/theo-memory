/**
 * `delete_entities` tool — input schema, metadata, description (M14 T2.4b).
 *
 * Removes a derived entity (node) — and its links + edges — from the active scope's graph.
 * The source MEMORIES are untouched: only the re-extractable graph projection is dropped.
 * Identity is the Principal `(workspace, user)` resolved from the credential — the schema
 * carries NO identity field (ADR-M14-1). Fail-closed (#252): the handler requires an acting
 * user before any store call; an under-constrained scope never widens into an open-scope wipe.
 *
 * @see ADR-M14-1 — identidade do Principal server-side
 * @see theo-cloud#252 — guarda fail-closed antes de qualquer deleção
 */
import { z } from 'zod';

export const TOOL_NAME = 'delete_entities' as const;

export const DESCRIPTION =
  'Delete a remembered entity (person, org, product, concept) by name from the active scope, removing its graph links and relations. The underlying memories are NOT deleted. Scope is the active user — no identity argument is accepted.';

/** Input shape for `tools/call delete_entities`. */
export const INPUT_SCHEMA = z
  .object({
    /** The entity name to forget from the active scope's graph. */
    name: z.string().min(1),
  })
  .strict();

export type DeleteEntitiesInput = z.infer<typeof INPUT_SCHEMA>;
