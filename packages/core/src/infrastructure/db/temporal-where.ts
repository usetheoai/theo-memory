/**
 * Shared bi-temporal recall predicate (v1.1 T3.1 + ADR-0011), extracted so BOTH
 * the primary recall path (`pgvector-store.ts`) AND graph-aware recall
 * (`pg-graph-expansion-store.ts`) reuse ONE audited predicate (DRY) — the M0
 * graph-aware-recall temporal-correctness fix.
 *
 * When `asOf` is set, compose the null-safe clause:
 *
 *   (t_valid IS NULL OR t_valid <= $N) AND (t_invalid IS NULL OR t_invalid > $N+1)
 *
 * NULL `t_valid` rows (pre-bi-temporal legacy) are treated as `-Infinity`
 * (always-valid since creation). When `asOf` is omitted, fall back to the
 * currently-valid filter `t_invalid IS NULL` so existing callers see ZERO
 * behavior change.
 *
 * `columnPrefix` lets a caller qualify the columns with a table alias (e.g.
 * `'m.'`) so the predicate is unambiguous inside a multi-table JOIN — required by
 * the graph expansion query, which aliases `memories` as `m`. Defaults to `''`
 * (unqualified) so the primary recall path is unchanged.
 */
interface TemporalWhere {
  readonly sql: string;
  readonly params: readonly Date[];
  readonly nextParamIndex: number;
}

export function composeTemporalWhere(
  asOf: Date | undefined,
  startParamIndex: number,
  columnPrefix = '',
  includeExpiration = true,
): TemporalWhere {
  const tValid = `${columnPrefix}t_valid`;
  const tInvalid = `${columnPrefix}t_invalid`;
  const expires = `${columnPrefix}expires_at`;
  const expiryNow = includeExpiration ? ` AND (${expires} IS NULL OR ${expires} > NOW())` : '';
  const expiryThen = includeExpiration ? ` AND (${expires} IS NULL OR ${expires} > $${startParamIndex})` : '';
  if (asOf === undefined) {
    return { sql: `${tInvalid} IS NULL${expiryNow}`, params: [], nextParamIndex: startParamIndex };
  }
  return {
    sql: `(${tValid} IS NULL OR ${tValid} <= $${startParamIndex}) AND (${tInvalid} IS NULL OR ${tInvalid} > $${startParamIndex + 1})${expiryThen}`,
    params: [asOf, asOf],
    nextParamIndex: startParamIndex + 2,
  };
}
