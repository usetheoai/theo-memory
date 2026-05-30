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
