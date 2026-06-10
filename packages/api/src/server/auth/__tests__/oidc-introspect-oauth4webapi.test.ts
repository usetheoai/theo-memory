/**
 * T2.1 RED tests — `createOauth4webapiIntrospect` adapter contract.
 *
 * Plan: `theo-memory-faang-auth-lifecycle-fixes-cycle-1` § T2.1 + ADR D2 + EC-3 + EC-8.
 *
 * 5 scenarios:
 *   1. discovery_called_once_at_construction — N introspect calls = 1 discovery + N introspection round-trips
 *   2. active=true mapping — happy-path token validation
 *   3. active=false mapping — token rejection
 *   4. EC-8 — AbortSignal propagation: controller.abort() → promise rejects in ≤ 10ms (not 5000ms)
 *   5. EC-3 — factory throws at construction when discovery doc omits introspection_endpoint
 *
 * Tests use the `customFetch` symbol from oauth4webapi to inject a stub fetch
 * — no real HTTP listener, no real issuer. The stub records request shapes +
 * returns canned discovery + introspection responses.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-fixes-cycle-1-plan.md § T2.1
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

import { createOauth4webapiIntrospect } from '../oidc-introspect-oauth4webapi.js';

interface FetchCall {
  readonly url: string;
  readonly method?: string;
}

interface StubFetchOptions {
  /** Discovery doc body returned for the GET /.well-known/openid-configuration response. */
  readonly discoveryBody: Record<string, unknown>;
  /** Introspection response body returned for POST $issuer/oauth2/introspect (default: active=true). */
  readonly introspectionBody?: { active: boolean; sub?: string; scope?: string; exp?: number };
  /** Optional latency in ms for the introspection request (for AbortSignal test). */
  readonly introspectionLatencyMs?: number;
}

function buildStubFetch(opts: StubFetchOptions): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const stub = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, ...(init?.method !== undefined ? { method: init.method } : {}) });

    // Discovery endpoint
    if (url.includes('/.well-known/openid-configuration') || url.includes('/.well-known/oauth-authorization-server')) {
      return new Response(JSON.stringify(opts.discoveryBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Introspection endpoint — honor latency + abort signal
    const latency = opts.introspectionLatencyMs ?? 0;
    if (latency > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, latency);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    const body = opts.introspectionBody ?? { active: true, sub: 'alice' };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { fetch: stub, calls };
}

const ISSUER = 'https://auth.example.com';
const VALID_DISCOVERY = {
  issuer: ISSUER,
  introspection_endpoint: `${ISSUER}/oauth2/introspect`,
  authorization_endpoint: `${ISSUER}/oauth2/auth`,
  token_endpoint: `${ISSUER}/oauth2/token`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('T2.1 — createOauth4webapiIntrospect adapter (ADR D2)', () => {
  test('1. discovery called ONCE at construction; N introspect calls = 1 discovery + N introspection round-trips', async () => {
    const { fetch: stubFetch, calls } = buildStubFetch({ discoveryBody: VALID_DISCOVERY });
    const introspect = await createOauth4webapiIntrospect({
      issuer: ISSUER,
      clientId: 'theo-memory-server',
      clientSecret: 'super-secret-for-test',
      fetchImpl: stubFetch,
    });

    const discoveryCallsBefore = calls.filter((c) => c.url.includes('.well-known')).length;
    expect(discoveryCallsBefore).toBe(1);

    const ac = new AbortController();
    await introspect('token-1', ac.signal);
    await introspect('token-2', ac.signal);
    await introspect('token-3', ac.signal);

    const discoveryCallsAfter = calls.filter((c) => c.url.includes('.well-known')).length;
    const introspectionCalls = calls.filter((c) => c.url.includes('/oauth2/introspect')).length;
    expect(discoveryCallsAfter).toBe(1); // still 1 — cached at construction
    expect(introspectionCalls).toBe(3); // one per verify
  });

  test('2. active=true maps to { active: true } in IntrospectionResult', async () => {
    const { fetch: stubFetch } = buildStubFetch({
      discoveryBody: VALID_DISCOVERY,
      introspectionBody: { active: true, sub: 'alice', scope: 'memory:read memory:write' },
    });
    const introspect = await createOauth4webapiIntrospect({
      issuer: ISSUER,
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl: stubFetch,
    });
    const result = await introspect('any-token', new AbortController().signal);
    expect(result.active).toBe(true);
    expect(result.sub).toBe('alice');
    expect(result.scope).toBe('memory:read memory:write');
  });

  test('3. active=false maps to { active: false } in IntrospectionResult', async () => {
    const { fetch: stubFetch } = buildStubFetch({
      discoveryBody: VALID_DISCOVERY,
      introspectionBody: { active: false },
    });
    const introspect = await createOauth4webapiIntrospect({
      issuer: ISSUER,
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl: stubFetch,
    });
    const result = await introspect('revoked-token', new AbortController().signal);
    expect(result.active).toBe(false);
  });

  test('4. EC-8 — AbortSignal propagates: abort fires → promise rejects in ≤ 50ms', async () => {
    const { fetch: stubFetch } = buildStubFetch({
      discoveryBody: VALID_DISCOVERY,
      introspectionLatencyMs: 5000, // would block 5s without abort
    });
    const introspect = await createOauth4webapiIntrospect({
      issuer: ISSUER,
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl: stubFetch,
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1);
    const start = Date.now();
    await expect(introspect('any', ac.signal)).rejects.toThrow();
    const elapsed = Date.now() - start;
    // CRITICAL: aborts in ≤ 50ms, NOT waits for the 5000ms latency
    expect(elapsed).toBeLessThan(50);
  });

  test('5. EC-3 — factory throws at construction when discovery doc omits introspection_endpoint', async () => {
    const incompleteDiscovery = {
      issuer: ISSUER,
      // intentionally omits introspection_endpoint
      authorization_endpoint: `${ISSUER}/oauth2/auth`,
      token_endpoint: `${ISSUER}/oauth2/token`,
      jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    };
    const { fetch: stubFetch } = buildStubFetch({ discoveryBody: incompleteDiscovery });
    await expect(
      createOauth4webapiIntrospect({
        issuer: ISSUER,
        clientId: 'client',
        clientSecret: 'secret',
        fetchImpl: stubFetch,
      }),
    ).rejects.toThrow(/introspection_endpoint|RFC 7662/i);
  });
});
