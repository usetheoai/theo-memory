/**
 * `forget` tool — input schema, metadata, description.
 *
 * Removes a specific memory by id OR all memories in the active scope.
 * Mutual exclusion enforced via `.refine()` per ADR D6 (refine fail → -32602).
 *
 * @see ADR D2 — Tool schema: zod-authored, separate verbs (no action collapsing)
 * @see ADR D6 — Error mechanisms (mutual exclusion → Protocol Error)
 */
import { z } from 'zod';

export const TOOL_NAME = 'forget' as const;

export const DESCRIPTION =
  'Remove a memory from the active scope. Provide exactly one of: `id` (UUID of a specific memory) OR `all: true` (bulk delete of the scope). Use sparingly — forget is a destructive operation under ADD-only semantics.';

/**
 * Input shape for `tools/call forget`.
 *
 * EXACTLY ONE of `id` xor `all` MUST be present. `.refine()` rejects both `{id, all}`
 * and `{}` with explicit message. Discrimination via boolean XOR pattern.
 */
export const INPUT_SCHEMA = z
  .object({
    /** UUID of a specific memory to forget. Mutually exclusive with `all`. */
    id: z.string().uuid().optional(),
    /** If true, forget all memories in the active scope. Mutually exclusive with `id`. */
    all: z.boolean().optional(),
  })
  .refine((d) => Boolean(d.id) !== Boolean(d.all), {
    message: 'Provide exactly one of `id` or `all` — not both, not neither.',
  });

export type ForgetInput = z.infer<typeof INPUT_SCHEMA>;
