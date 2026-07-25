/**
 * Shared pgvector vector-literal serializer.
 *
 * Extracted from `pgvector-store.ts` at v0.6.1 T3.1 / F3 so both `PgvectorStore`
 * and `PgvectorSkillStore` consume the same serialization rule. Pgvector accepts
 * the `[v1,v2,...]` literal syntax for parameterized `$N::vector` casts.
 *
 * F-dom-1 absorption: guards every component against NaN / Infinity / -Infinity.
 * Without the guard, malformed vectors would reach pgvector and fail with a
 * cryptic `invalid input syntax for type vector` error at the SQL layer. With
 * the guard, callers see a clear JS error pointing at the offending index.
 */
export function vectorLiteral(vector: readonly number[]): string {
  for (let i = 0; i < vector.length; i += 1) {
    const n = vector[i] as number;
    if (!Number.isFinite(n)) {
      throw new Error(
        `vectorLiteral: vector[${i}] is not finite (${String(n)}); pgvector requires finite numbers`,
      );
    }
  }
  return `[${vector.join(',')}]`;
}

/**
 * Inverse of {@link vectorLiteral}: parse pgvector's text output form
 * (`[v1,v2,...]`) back into a `number[]`. `node-pg` returns the `vector` type
 * as this string (no native parser), so any read that SELECTs an `embedding`
 * column parses it here (DRY — M24 consolidation candidates share this rule).
 *
 * Throws on a malformed literal (missing brackets, non-numeric component) so a
 * corrupt vector fails loudly at the boundary rather than yielding NaN.
 */
export function parseVectorLiteral(literal: string): number[] {
  const trimmed = literal.trim();
  if (trimmed.length < 2 || trimmed[0] !== '[' || trimmed[trimmed.length - 1] !== ']') {
    throw new Error(
      `parseVectorLiteral: expected a "[...]" pgvector literal, got ${JSON.stringify(literal)}`,
    );
  }
  const body = trimmed.slice(1, -1).trim();
  if (body === '') {
    return [];
  }
  return body.split(',').map((part, i) => {
    const n = Number(part);
    if (!Number.isFinite(n)) {
      throw new Error(
        `parseVectorLiteral: component ${String(i)} is not finite (${JSON.stringify(part)})`,
      );
    }
    return n;
  });
}
