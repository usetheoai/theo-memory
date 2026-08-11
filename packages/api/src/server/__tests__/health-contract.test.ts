// The canonical operational names, and what the aliases cost (B-118, contract rule D5).
//
// # What was here
//
// Four routes serving two answers:
//
//   /v1/health         liveness
//   /v1/health/db      the database check — readiness, under a name that says "db"
//   /v1/healthz        an alias of /v1/health           (M6 T1.1)
//   /v1/healthz/ready  an alias of /v1/health/db        (M6 T1.1)
//
// Measured across the ecosystem for the HTTP surface contract (B-115): nine services offered nine
// different combinations, and this repo has the most paths of any of them. The canonical readiness
// name — `/v1/health/ready` — was the one shape NOT served.
//
// # Why adding rather than removing
//
// The aliases have callers. Removing them is a breaking change for whatever probes them, and the
// contract's migration rule is additive by design: the canonical path answers ALONGSIDE the old
// one, the old one is marked deprecated where a consumer can see it, and removal is its own item
// after the deadline. Four routes becoming five looks like the wrong direction and is the only
// direction that does not break someone.
//
// # Why readiness is not an alias of liveness
//
// `/v1/health` answers from `readinessProbe`; `/v1/health/db` answers from `dbProbe`. Pointing the
// canonical readiness name at the liveness handler would give the ecosystem a route that says
// "ready" whenever the process is up — which is the failure D5 exists to remove, wearing the right
// name.

import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

/**
 * `dbProbe` signals failure by THROWING, not by returning false — `healthDbHandler` races it
 * against a timeout and treats any rejection as unavailable. A stub that returned `false` would
 * resolve, the handler would answer 200, and the readiness case below would pass while proving
 * nothing. It did exactly that until the canonical route existed and the 401 stopped hiding it.
 */
function app(dbOk: boolean) {
  return createApp({
    memory: {} as never,
    authVerifier: {} as never,
    readinessProbe: async () => true,
    dbProbe: async () => {
      if (!dbOk) throw new Error('database unreachable');
    },
  } as never);
}

describe('the canonical operational surface', () => {
  it('test_canonical_readiness_is_served', async () => {
    const res = await app(true).request('/v1/health/ready');
    expect(res.status, '/v1/health/ready is the contract name and was the one shape not served').toBe(
      200,
    );
  });

  it('test_canonical_readiness_answers_from_the_database_probe', async () => {
    // Not an alias of liveness. A readiness route wired to the liveness handler answers "ready"
    // whenever the process is up — the exact failure the route exists to prevent, under the right
    // name, which is worse than not having it.
    const res = await app(false).request('/v1/health/ready');
    expect(res.status, 'the database probe failed and readiness still answered 200').not.toBe(200);
  });

  it('test_liveness_is_unaffected_by_the_database_probe', async () => {
    // The counterpart. Liveness failing because a dependency is down makes the orchestrator
    // RESTART a healthy process, which loses in-flight work and does not fix the dependency.
    const res = await app(false).request('/v1/health');
    expect(res.status).toBe(200);
  });

  it('test_the_aliases_still_answer', async () => {
    // They have callers. The migration is additive: nothing that probes today changes, and
    // removal is a separate item after the deprecation deadline.
    for (const path of ['/v1/health', '/v1/health/db', '/v1/healthz', '/v1/healthz/ready']) {
      const res = await app(true).request(path);
      expect(res.status, `${path} stopped answering`).toBe(200);
    }
  });

  it('test_the_document_describes_the_operational_surface', async () => {
    // The ecosystem contract checker only reads the document. A route that is served and not
    // described is a route it never checks — and `/v1/version` was exactly that here: served
    // since M6, absent from the generated spec.
    const doc = (await (await app(true).request('/v1/openapi.json')).json()) as {
      paths?: Record<string, unknown>;
    };
    const paths = Object.keys(doc.paths ?? {});

    expect(paths, 'the canonical readiness path is undocumented').toContain('/v1/health/ready');
    expect(paths, 'version is served but undocumented — the contract checker cannot see it').toContain(
      '/v1/version',
    );
  });
});
