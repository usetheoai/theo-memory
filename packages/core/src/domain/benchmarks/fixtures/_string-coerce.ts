/**
 * Safe unknown→string coercion for fixture row fields.
 *
 * Returns the string form when input is string/number/bigint/boolean;
 * otherwise returns the fallback. Avoids the `[object Object]` lint
 * footgun on unknown-typed JSON row fields.
 */
export function coerceFieldToString(raw: unknown, fallback = ''): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'bigint' || typeof raw === 'boolean') {
    return String(raw);
  }
  return fallback;
}
