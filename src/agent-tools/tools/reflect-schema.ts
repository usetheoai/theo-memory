/**
 * `reflect` tool — input schema, metadata, description.
 *
 * Triggers the manual reflection policy (ADR-0005 / v0.0 contract). v0.3 ships
 * the sync trigger only; async sleep-time policies land at v0.4a per CLAUDE.md
 * Roadmap Item 5.
 *
 * @see ADR D2 — Tool schema: zod-authored, 4 separate tools
 * @see EC-11 — reflect schema strict (extras rejected; prevents silent drift when
 *   v0.4a adds `since: timestamp` field)
 * @see EC-3 / D9 — `.strict()` translates to `additionalProperties: false` only with
 *   `target: 'jsonSchema7'`. T2.2's emitter MUST honor D9.
 */
import { z } from 'zod';

export const TOOL_NAME = 'reflect' as const;

export const DESCRIPTION =
  'Trigger a reflection pass over the active scope. Consolidates memories per the configured ReflectionPolicy (manual-only at v0.3; async scheduler lands at v0.4a). Returns a count of higher-order memories produced.';

/**
 * Input shape for `tools/call reflect`.
 *
 * Strict empty object — extras rejected at boundary. Future fields (e.g., `since`
 * timestamp at v0.4a) MUST be added explicitly to keep the contract forward-honest.
 */
export const INPUT_SCHEMA = z.object({}).strict();

export type ReflectInput = z.infer<typeof INPUT_SCHEMA>;
