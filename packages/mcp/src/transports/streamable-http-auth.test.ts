/**
 * T4.1 RED tests — withBearerAuth wrapper + connectStreamableHttp auth wiring.
 *
 * Per plan theo-memory-faang-auth-lifecycle § T4.1:
 *   - 5 mandatory scenarios + EC-10 (well-formed WWW-Authenticate per RFC 6750 § 3).
 *   - Auth gate composed via SAME dualValidationAuth shape (theo_live_* → ApiKeyAuthVerifier,
 *     else → OidcAuthVerifier). Stdio transport unchanged (no auth check).
 *   - Non-localhost host without TLS config refuses to start (MCP spec hygiene per ADR D3 #3).
 *
 * Test surface: HTTP-level (port 0 OS-assigned), undici/fetch as client.
 * The MCP wire protocol is OUT of scope here — we only assert the auth gate
 * behavior. Verifier impls are vi.fn() stubs (no real DB / no real OIDC issuer).
 *
 */
import type { AuthVerifier, Principal } from '@usetheo/memory/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { workspaceFromRequest } from '../auth/request-workspace.js';
import { withBearerAuth } from '../auth/with-bearer-auth.js';
import type { McpServer } from '../server.js';
import { connectStdio } from '../transports/stdio.js';
import { connectStreamableHttp } from '../transports/streamable-http.js';

const VALID_THEO_LIVE = `theo_live_${'a'.repeat(40)}`;
const JWT_LIKE = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';

function alwaysTrue(): AuthVerifier {
  return { verify: vi.fn(() => Promise.resolve(true)) };
}
function alwaysFalse(): AuthVerifier {
  return { verify: vi.fn(() => Promise.resolve(false)) };
}

function principal(workspaceId: string): Principal {
  return { workspaceId, userId: 'u', role: 'member', scopes: ['memory:read'] };
}
/** A resolvePrincipal-capable verifier (the production ApiKeyAuthVerifier shape). */
function resolvesTo(workspaceId: string): AuthVerifier {
  return {
    verify: vi.fn(() => Promise.resolve(true)),
    resolvePrincipal: vi.fn(() => Promise.resolve(principal(workspaceId))),
  };
}
function resolvesNull(): AuthVerifier {
  return {
    verify: vi.fn(() => Promise.resolve(false)),
    resolvePrincipal: vi.fn(() => Promise.resolve(null)),
  };
}
function resolveThrows(): AuthVerifier {
  return {
    verify: vi.fn(() => Promise.resolve(true)),
    resolvePrincipal: vi.fn(() => Promise.reject(new Error('db down'))),
  };
}

/** Minimal node:http req/res doubles capturing status + body. */
function reqRes(token: string): {
  req: Parameters<ReturnType<typeof withBearerAuth>>[0];
  res: Parameters<ReturnType<typeof withBearerAuth>>[1];
  status: () => number;
} {
  const req = { headers: { authorization: `Bearer ${token}` } } as Parameters<
    ReturnType<typeof withBearerAuth>
  >[0];
  let statusCode = 0;
  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as Parameters<ReturnType<typeof withBearerAuth>>[1];
  return { req, res, status: () => statusCode };
}

describe('withBearerAuth — workspace resolution (T2.1, #82)', () => {
  it('resolvePrincipal success attaches the workspaceId and delegates', async () => {
    const delegate = vi.fn();
    const handler = withBearerAuth(delegate, { apiKey: resolvesTo('tn-A') });
    const { req, res } = reqRes(VALID_THEO_LIVE);

    await handler(req, res);

    expect(delegate).toHaveBeenCalledWith(req, res);
    expect(workspaceFromRequest(req)).toBe('tn-A');
  });

  it('resolvePrincipal null → 401, no delegate, no workspace attached', async () => {
    const delegate = vi.fn();
    const handler = withBearerAuth(delegate, { apiKey: resolvesNull() });
    const { req, res, status } = reqRes(VALID_THEO_LIVE);

    await handler(req, res);

    expect(status()).toBe(401);
    expect(delegate).not.toHaveBeenCalled();
    expect(workspaceFromRequest(req)).toBeUndefined();
  });

  it('EC-1 — resolvePrincipal returns a blank workspaceId → 401, no delegate (guards #82 re-open)', async () => {
    const delegate = vi.fn();
    const handler = withBearerAuth(delegate, {
      apiKey: { verify: vi.fn(() => Promise.resolve(true)), resolvePrincipal: vi.fn(() => Promise.resolve(principal('   '))) },
    });
    const { req, res, status } = reqRes(VALID_THEO_LIVE);

    await handler(req, res);

    expect(status()).toBe(401);
    expect(delegate).not.toHaveBeenCalled();
    expect(workspaceFromRequest(req)).toBeUndefined();
  });

  it('resolvePrincipal throws (auth backend down) → 503, no delegate, never unbound', async () => {
    const delegate = vi.fn();
    const handler = withBearerAuth(delegate, { apiKey: resolveThrows() });
    const { req, res, status } = reqRes(VALID_THEO_LIVE);

    await handler(req, res);

    expect(status()).toBe(503);
    expect(delegate).not.toHaveBeenCalled();
    expect(workspaceFromRequest(req)).toBeUndefined();
  });

  it('concurrent test — two requests with different keys attach to their OWN req (no shared state / happens-before observation)', async () => {
    const seen: (string | undefined)[] = [];
    const delegate = vi.fn((req: Parameters<ReturnType<typeof withBearerAuth>>[0]) => {
      seen.push(workspaceFromRequest(req));
    });
    const handlerA = withBearerAuth(delegate, { apiKey: resolvesTo('tn-A') });
    const handlerB = withBearerAuth(delegate, { apiKey: resolvesTo('tn-B') });
    const a = reqRes(VALID_THEO_LIVE);
    const b = reqRes(VALID_THEO_LIVE);

    await Promise.all([handlerA(a.req, a.res), handlerB(b.req, b.res)]);

    expect(workspaceFromRequest(a.req)).toBe('tn-A');
    expect(workspaceFromRequest(b.req)).toBe('tn-B');
    expect(seen.sort()).toEqual(['tn-A', 'tn-B']);
  });
});

function mockMcpServer(): McpServer {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpServer;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withBearerAuth — unit-level (node:http handler wrap)', () => {
  it('0. themory-issue-3 B2 — OPTIONS preflight bypasses Bearer gate and returns 204 with CORS headers', async () => {
    // CORS preflight is unauthenticated by design. Gating OPTIONS with Bearer
    // breaks browser-mode MCP clients (Cursor browser, MCP Inspector, future
    // dashboards). This is purely additive on the existing 401 path: CLI
    // clients (Claude Code, Cline) don't issue OPTIONS so no regression risk.
    const delegate = vi.fn();
    const handler = withBearerAuth(delegate, { apiKey: alwaysTrue(), oidc: alwaysTrue() });

    const req = {
      method: 'OPTIONS',
      headers: {
        'origin': 'https://app.example.com',
        'access-control-request-headers': 'Authorization, Content-Type',
      },
    } as Parameters<typeof handler>[0];
    let statusCode = 0;
    const headers = new Map<string, string>();
    let ended = false;
    const res = {
      get statusCode() { return statusCode; },
      set statusCode(v: number) { statusCode = v; },
      setHeader: (k: string, v: string) => headers.set(k.toLowerCase(), v),
      end: () => { ended = true; },
    } as unknown as Parameters<typeof handler>[1];

    await handler(req, res);

    expect(statusCode).toBe(204);
    expect(ended).toBe(true);
    expect(headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(headers.get('access-control-allow-methods')).toContain('POST');
    expect(headers.get('access-control-allow-methods')).toContain('OPTIONS');
    expect(headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(headers.get('access-control-max-age')).toBe('600');
    // Critical: delegate (the wrapped transport) MUST NOT receive the preflight
    expect(delegate).not.toHaveBeenCalled();
    // Critical: no 401 path — WWW-Authenticate must NOT be set on a preflight
    expect(headers.get('www-authenticate')).toBeUndefined();
  });

  it('1. returns 401 + WWW-Authenticate when Authorization header is missing', async () => {
    const delegate = vi.fn();
    const handler = withBearerAuth(delegate, { apiKey: alwaysTrue(), oidc: alwaysTrue() });

    const req = { headers: {} } as Parameters<typeof handler>[0];
    let statusCode = 0;
    const headers = new Map<string, string>();
    let body = '';
    const res = {
      get statusCode() {
        return statusCode;
      },
      set statusCode(v: number) {
        statusCode = v;
      },
      setHeader: (k: string, v: string) => headers.set(k.toLowerCase(), v),
      end: (chunk?: string) => {
        body = chunk ?? '';
      },
    } as unknown as Parameters<typeof handler>[1];

    await handler(req, res);

    expect(statusCode).toBe(401);
    expect(headers.get('www-authenticate')).toContain('Bearer realm="theo-mcp"');
    expect(headers.get('www-authenticate')).toContain('error="missing_token"');
    expect(headers.get('www-authenticate')).toContain('resource_metadata="/.well-known/oauth-protected-resource"');
    const parsed = JSON.parse(body) as { code: string; message: string };
    expect(parsed.code).toBe('AUTH_REQUIRED');
    expect(parsed.message.length).toBeGreaterThan(0);
    expect(delegate).not.toHaveBeenCalled();
  });

  it('2. delegates when theo_live_ key resolves a Principal (production ApiKeyAuthVerifier shape)', async () => {
    const delegate = vi.fn();
    const apiKey = resolvesTo('tn-default'); // resolvePrincipal-capable, like ApiKeyAuthVerifier
    const oidc = alwaysFalse();
    const handler = withBearerAuth(delegate, { apiKey, oidc });

    const req = { headers: { authorization: `Bearer ${VALID_THEO_LIVE}` } } as Parameters<typeof handler>[0];
    const res = { setHeader: vi.fn(), end: vi.fn() } as unknown as Parameters<typeof handler>[1];

    await handler(req, res);

    expect(apiKey.resolvePrincipal).toHaveBeenCalledWith(VALID_THEO_LIVE);
    expect(oidc.verify).not.toHaveBeenCalled();
    expect(delegate).toHaveBeenCalledWith(req, res);
  });

  it('2b. EC-2 fail-closed — a verify-only verifier on the api-keys path is REJECTED (401), never single-tenant passthrough', async () => {
    const delegate = vi.fn();
    const apiKey = alwaysTrue(); // verify-only: no resolvePrincipal → cannot isolate tenants
    const oidc = alwaysFalse();
    let statusCode = 0;
    const headers = new Map<string, string>();
    const handler = withBearerAuth(delegate, { apiKey, oidc });
    const req = { headers: { authorization: `Bearer ${VALID_THEO_LIVE}` } } as Parameters<typeof handler>[0];
    const res = {
      get statusCode() { return statusCode; },
      set statusCode(v: number) { statusCode = v; },
      setHeader: (k: string, v: string) => headers.set(k.toLowerCase(), v),
      end: vi.fn(),
    } as unknown as Parameters<typeof handler>[1];

    await handler(req, res);

    expect(statusCode).toBe(401);
    expect(headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(delegate).not.toHaveBeenCalled();
  });

  it('3. delegates when JWT-like token passes OIDC verifier', async () => {
    const delegate = vi.fn();
    const apiKey = alwaysFalse();
    const oidc = alwaysTrue();
    const handler = withBearerAuth(delegate, { apiKey, oidc });

    const req = { headers: { authorization: `Bearer ${JWT_LIKE}` } } as Parameters<typeof handler>[0];
    const res = { setHeader: vi.fn(), end: vi.fn() } as unknown as Parameters<typeof handler>[1];

    await handler(req, res);

    expect(oidc.verify).toHaveBeenCalledWith(JWT_LIKE);
    expect(apiKey.verify).not.toHaveBeenCalled();
    expect(delegate).toHaveBeenCalledWith(req, res);
  });

  it('4. returns 401 INVALID_TOKEN when no verifier accepts the token', async () => {
    const delegate = vi.fn();
    const apiKey = alwaysFalse();
    const oidc = alwaysFalse();
    const handler = withBearerAuth(delegate, { apiKey, oidc });

    let statusCode = 0;
    let body = '';
    const headers = new Map<string, string>();
    const req = { headers: { authorization: `Bearer ${JWT_LIKE}` } } as Parameters<typeof handler>[0];
    const res = {
      get statusCode() {
        return statusCode;
      },
      set statusCode(v: number) {
        statusCode = v;
      },
      setHeader: (k: string, v: string) => headers.set(k.toLowerCase(), v),
      end: (chunk?: string) => {
        body = chunk ?? '';
      },
    } as unknown as Parameters<typeof handler>[1];

    await handler(req, res);

    expect(statusCode).toBe(401);
    expect(headers.get('www-authenticate')).toContain('error="invalid_token"');
    const parsed = JSON.parse(body) as { code: string; message: string };
    expect(parsed.code).toBe('INVALID_TOKEN');
    expect(parsed.message.length).toBeGreaterThan(0);
    expect(delegate).not.toHaveBeenCalled();
  });

  it('5. EC-10 — WWW-Authenticate header is RFC 6750 § 3 well-formed (all four params)', async () => {
    const delegate = vi.fn();
    const handler = withBearerAuth(delegate, { apiKey: alwaysFalse(), oidc: alwaysFalse() });

    const headers = new Map<string, string>();
    const req = { headers: { authorization: `Bearer ${JWT_LIKE}` } } as Parameters<typeof handler>[0];
    const res = {
      statusCode: 0,
      setHeader: (k: string, v: string) => headers.set(k.toLowerCase(), v),
      end: vi.fn(),
    } as unknown as Parameters<typeof handler>[1];

    await handler(req, res);

    const wwwAuth = headers.get('www-authenticate') ?? '';
    // RFC 6750 § 3: Bearer scheme + realm + error + error_description.
    // MCP spec: + resource_metadata pointing at /.well-known/oauth-protected-resource.
    expect(wwwAuth).toMatch(/^Bearer\s+realm="[^"]+"/);
    expect(wwwAuth).toMatch(/error="(invalid_token|missing_token)"/);
    expect(wwwAuth).toMatch(/error_description="[^"]+"/);
    expect(wwwAuth).toMatch(/resource_metadata="\/.well-known\/oauth-protected-resource"/);
  });

  it('6. EC-1 fallthrough — theo_live_ prefix but invalid shape falls through to OIDC + logs warn', async () => {
    const delegate = vi.fn();
    const apiKey = alwaysFalse();
    const oidc = alwaysTrue();
    const warnLog: { msg: string; details: Record<string, unknown> }[] = [];
    const handler = withBearerAuth(delegate, {
      apiKey,
      oidc,
      logWarn: (msg, details) => warnLog.push({ msg, details }),
    });

    const INVALID_SHAPE_PREFIX = 'theo_live_short'; // prefix matches but shape regex fails
    const req = { headers: { authorization: `Bearer ${INVALID_SHAPE_PREFIX}` } } as Parameters<typeof handler>[0];
    const res = { setHeader: vi.fn(), end: vi.fn() } as unknown as Parameters<typeof handler>[1];

    await handler(req, res);

    expect(apiKey.verify).not.toHaveBeenCalled();
    expect(oidc.verify).toHaveBeenCalledWith(INVALID_SHAPE_PREFIX);
    expect(delegate).toHaveBeenCalled();
    expect(warnLog).toHaveLength(1);
    expect(warnLog[0]?.msg).toBe('prefix_collision_detected');
  });
});

describe('connectStreamableHttp — auth + TLS hygiene (T4.1 integration)', () => {
  it('7. wires withBearerAuth when bearerAuth option is supplied (401 without Bearer)', async () => {
    const server = mockMcpServer();
    const handle = await connectStreamableHttp(() => server, {
      port: 0,
      host: '127.0.0.1',
      bearerAuth: { apiKey: alwaysTrue(), oidc: alwaysTrue() },
    });
    try {
      const addr = handle.address();
      const port =
        addr !== null && typeof addr === 'object' ? (addr as { port: number }).port : handle.port;
      const res = await fetch(`http://127.0.0.1:${String(port)}/mcp`, { method: 'POST' });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('Bearer realm="theo-mcp"');
    } finally {
      await handle.close();
    }
  });

  it('8. STDIO unchanged — connectStdio surface has no auth knobs (structural invariant per ADR-0015 #1)', () => {
    // connectStreamableHttp is HTTP-only by name; the stdio path lives in
    // transports/stdio.ts and does NOT consume bearerAuth. This invariant is
    // guarded structurally — the StdioServerTransport API has no notion of
    // headers, so there is no surface that could call withBearerAuth.
    // The test exists to document the invariant; future refactors that try
    // to add auth into stdio would surface here via arity drift.
    expect(typeof connectStdio).toBe('function');
    // connectStdio(server: McpServer): Promise<void> — single parameter, no
    // options bag (no place for `bearerAuth` to land).
    expect(connectStdio.length).toBeLessThanOrEqual(1);
  });

  it('9. REFUSE to start when host is non-localhost AND no TLS config supplied (MCP hygiene per ADR D3 #3)', async () => {
    const server = mockMcpServer();
    await expect(
      connectStreamableHttp(() => server, {
        port: 0,
        host: '0.0.0.0', // non-localhost
        bearerAuth: { apiKey: alwaysTrue(), oidc: alwaysTrue() },
        // no tls: { cert, key } supplied
      }),
    ).rejects.toThrow(/HTTPS|TLS|non-localhost/i);
  });

  it('10. localhost (127.0.0.1) is allowed WITHOUT TLS — dev-friendly path', async () => {
    const server = mockMcpServer();
    const handle = await connectStreamableHttp(() => server, {
      port: 0,
      host: '127.0.0.1',
      bearerAuth: { apiKey: alwaysTrue(), oidc: alwaysTrue() },
    });
    expect(handle).toBeDefined();
    await handle.close();
  });
});
