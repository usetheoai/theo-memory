/**
 * The instant a stored memory became valid (bi-temporal valid time), read from the row.
 *
 * Stores project the `t_valid` column into the payload as an ISO string. Write paths put
 * `RememberOptions.observedAt` there. Rows without one (legacy rows, adapters that do not
 * project it) use `fallback`, which callers set to the time they already report for the
 * row, so no second clock is synthesized.
 */
export function validFromOf(payload: Readonly<Record<string, unknown>>, fallback: Date): Date {
  const raw = payload['t_valid'];
  if (typeof raw !== 'string') return fallback;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? fallback : new Date(ms);
}
