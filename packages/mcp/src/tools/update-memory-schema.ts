/**
 * `update_memory` tool — input schema, metadata, description (M14 T2.3).
 *
 * "Update" under ADD-only semantics (ADR-0003): the tool carries the reference name for
 * parity, but under the hood it is `remember(newText)` THEN `forget(oldId)` — never an
 * in-place UPDATE. The order is load-bearing (edge EC-1): remember FIRST so a failed
 * remember degrades to a no-op (old row stays alive), never to data loss.
 *
 * @see ADR-0003 — ADD-only public API (mutation = forget + remember)
 * @see ADR-M14-1 — identidade do Principal server-side
 */
import { z } from 'zod';

export const TOOL_NAME = 'update_memory' as const;

export const DESCRIPTION =
  "Replace a memory's text by id. Under ADD-only semantics this stores the new text and retires the old one (the id changes; the old text stays in history). Returns the new memory id.";

/** Input shape for `tools/call update_memory`. */
export const INPUT_SCHEMA = z
  .object({
    /** UUID of the memory to replace. */
    id: z.string().uuid(),
    /** The new text. */
    content: z.string().min(1),
  })
  .strict();

export type UpdateMemoryInput = z.infer<typeof INPUT_SCHEMA>;
