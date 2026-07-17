/**
 * Scope hierarchy — implication between API-key scopes (Model B slice 1, ADR D2).
 *
 * Mirrors the `roleSatisfies` precedent (`packages/core/src/domain/principal.ts`):
 * a coarser/more-privileged scope SATISFIES a requirement for a finer one it
 * implies. Today the only implication is `memory:platform-admin ⊇ memory:admin`
 * — the platform credential the theo-cloud gateway uses to provision per-tenant
 * keys must be able to reach the `memory:admin`-gated lifecycle routes
 * (rotate/revoke of the keys it minted) without ALSO carrying a separate
 * `memory:admin` grant. Least privilege (NIST AC-6): platform-admin is the ONLY
 * scope that may target an arbitrary workspace; it is a strict superset of admin.
 *
 */

/** Implication edges: key = granted scope, value = scopes it additionally satisfies. */
const SCOPE_IMPLIES: Readonly<Record<string, readonly string[]>> = {
  'memory:platform-admin': ['memory:admin'],
};

/**
 * Resolve whether a key's `granted` scope set satisfies the `required` scope,
 * honoring {@link SCOPE_IMPLIES}. Exact membership always satisfies; an implied
 * scope satisfies too. Pure + allocation-light (no Set for the tiny inputs).
 */
export function scopeSatisfies(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  for (const g of granted) {
    if (SCOPE_IMPLIES[g]?.includes(required) === true) return true;
  }
  return false;
}
