/**
 * T5.1 — auth lifecycle integration test helpers.
 *
 * Stubs the RFC 7662 introspection endpoint via an `IntrospectFn` injection
 * (no real HTTP fixture needed; the OidcAuthVerifier accepts a pluggable
 * IntrospectFn per its DIP shape — see `src/server/auth/oidc-verifier.ts`).
 *
 * EC-9 ABSORBED (DOCUMENT): the integration suite runs against the real
 * `ankane/pgvector:v0.5.1` container provisioned via docker-compose. First
 * image pull is ~250 MB / 30-60s; vitest's per-test default of 30s is
 * usually enough on warm caches but cold runs benefit from the suite-wide
 * `testTimeout: 30_000` already set in `vitest.integration.config.ts`. We
 * do NOT override per-test here — the per-test budget stays at the config
 * default so a regression that adds 60s to a single scenario surfaces as
 * a timeout rather than getting masked.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T5.1
 * @see .claude/knowledge-base/reviews/theo-memory-faang-auth-lifecycle-edge-cases-2026-06-07.md § EC-9
 */
import { vi } from 'vitest';

import type { IntrospectFn, IntrospectionResult } from '../../../src/server/auth/oidc-verifier.js';

/**
 * Build a vi.fn() spy that returns canned `IntrospectionResult` payloads
 * keyed by raw token string. Tests can inspect the spy's call count to
 * verify cache hits (TTL > 0 → 2nd call within TTL = 1 round-trip total).
 */
export function buildStubIntrospect(
  tokens: Record<string, IntrospectionResult>,
): IntrospectFn & ReturnType<typeof vi.fn> {
  return vi.fn(async (token: string, _signal: AbortSignal): Promise<IntrospectionResult> => {
    const hit = tokens[token];
    if (hit !== undefined) return Promise.resolve(hit);
    return Promise.resolve({ active: false });
  }) as IntrospectFn & ReturnType<typeof vi.fn>;
}

/**
 * Cleans the auth tables between tests. Order respects FK: api_keys has
 * no FK pointing in but admin_config does (self) — TRUNCATE CASCADE is
 * safest. Reseeds the single-row admin_config so bootstrap state is
 * `bootstrap_consumed=false` at the start of each test.
 */
export async function resetAuthTables(pool: {
  query: (sql: string, params?: readonly unknown[]) => Promise<unknown>;
}): Promise<void> {
  await pool.query('TRUNCATE TABLE theo_api_keys, admin_config RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO admin_config (id) VALUES (1) ON CONFLICT DO NOTHING');
}
