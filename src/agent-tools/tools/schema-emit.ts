/**
 * JSON Schema emitter for v0.3 tool schemas — single point of dialect control.
 *
 * Pins `target: 'jsonSchema7'` to guarantee:
 * - `required` arrays emitted correctly (proves LangMem `_ToolWithRequired`
 *   workaround unneeded — blueprint Q6 + F-zod-schema-fixture-test)
 * - `.strict()` translates to `additionalProperties: false` (EC-11 + F-T2.1-3)
 *
 * @see ADR D9 — JSON Schema dialect lock (zod-to-json-schema target pinned)
 * @see EC-3 absorbed: prevents silent dialect drift across emitter version upgrades
 */
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Pinned emitter target per ADR D9. Single source of truth — all 4 tool schemas
 * + recall output schema route through this constant.
 *
 * `as const` ensures literal type narrowing so zod-to-json-schema returns the
 * `JsonSchema7Type` narrowing instead of the broader `object` fallback.
 */
export const ZOD_TO_JSON_SCHEMA_TARGET = 'jsonSchema7' as const;

/**
 * Emits a JSON Schema 7 representation of a zod schema, using the pinned target.
 *
 * Return type is inferred from `zod-to-json-schema` (its `JsonSchema7Type` shape).
 * Callers should rely on structural duck-typing for `.type`, `.required`,
 * `.additionalProperties` etc. — never cast to `any`.
 */
export function emitToolSchema(schema: ZodTypeAny): ReturnType<typeof zodToJsonSchema> {
  return zodToJsonSchema(schema, { target: ZOD_TO_JSON_SCHEMA_TARGET });
}
