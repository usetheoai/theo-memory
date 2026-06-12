/**
 * T4.2 RED tests — `/.well-known/oauth-protected-resource` discovery endpoint.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T4.2 + ADR D3 (ADR-0015) #4.
 *
 * Per RFC 9728 (OAuth 2.0 Protected Resource Metadata): when the MCP/REST
 * server is configured with an OIDC issuer, expose metadata so MCP clients
 * can auto-discover the issuer URL + supported scopes + bearer methods
 * WITHOUT manual config. The endpoint MUST be auth-exempt — clients fetch
 * it BEFORE having a token.
 *
 * 3 scenarios per plan acceptance criteria:
 *   1. 404 when OIDC is NOT configured (`oidcDiscovery` option absent).
 *   2. metadata JSON when OIDC is configured — fields per RFC 9728 § 2.
 *   3. accessible WITHOUT Bearer (auth-exempt, like /v1/openapi.json).
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T4.2
 * @see .claude/knowledge-base/adrs/ADR-0015-mcp-streamable-http-auth.md § Decision #4
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../../index.js';

function stubMemory(): Memory {
  const scoped = {
    remember: vi.fn().mockResolvedValue([]),
    recall: vi.fn().mockResolvedValue([]),
    reflect: vi.fn().mockResolvedValue({ jobId: 'job-1', derivedCount: 0 }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  const stub = {
    user: vi.fn().mockReturnValue(scoped),
    session: vi.fn().mockReturnValue(scoped),
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn().mockReturnValue(scoped),
    forget: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    history: vi.fn().mockResolvedValue([]),
    reset: vi.fn().mockResolvedValue(undefined),
    flushReflections: vi.fn().mockResolvedValue(undefined),
  };
  return stub;
}

const WELL_KNOWN_PATH = '/.well-known/oauth-protected-resource';

describe('T4.2 — /.well-known/oauth-protected-resource (RFC 9728)', () => {
  test('1. returns 404 when OIDC is NOT configured (oidcDiscovery option absent)', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request(`http://localhost${WELL_KNOWN_PATH}`));
    expect(res.status).toBe(404);
  });

  test('2. returns RFC 9728 metadata when OIDC issuer is configured', async () => {
    const app = createServer({
      memory: stubMemory(),
      oidcDiscovery: {
        issuer: 'https://auth.example.com',
        resource: 'https://memory.example.com',
        resourceName: 'TheMemory MCP',
        scopesSupported: ['memory:read', 'memory:write', 'memory:delete', 'memory:admin'],
      },
    });
    const res = await app.fetch(new Request(`http://localhost${WELL_KNOWN_PATH}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as {
      resource: string;
      resource_name: string;
      authorization_servers: string[];
      scopes_supported: string[];
      bearer_methods_supported: string[];
    };
    // RFC 9728 § 2 mandatory + recommended fields.
    expect(body.resource).toBe('https://memory.example.com');
    expect(body.resource_name).toBe('TheMemory MCP');
    expect(body.authorization_servers).toEqual(['https://auth.example.com']);
    expect(body.scopes_supported).toEqual([
      'memory:read',
      'memory:write',
      'memory:delete',
      'memory:admin',
    ]);
    // RFC 6750 + RFC 9728 § 2.10 — `header` is the only method we accept on the bearer surface.
    expect(body.bearer_methods_supported).toContain('header');
  });

  test('3. is accessible WITHOUT Bearer even when THEMEMORY_API_KEY is set (auth-exempt)', async () => {
    process.env['THEMEMORY_API_KEY'] = 'sk-secret';
    try {
      const app = createServer({
        memory: stubMemory(),
        oidcDiscovery: {
          issuer: 'https://auth.example.com',
          resource: 'https://memory.example.com',
          resourceName: 'TheMemory MCP',
          scopesSupported: ['memory:read'],
        },
      });
      const res = await app.fetch(new Request(`http://localhost${WELL_KNOWN_PATH}`));
      // The point: NOT 401. Codegen / MCP-client tools fetch the well-known
      // BEFORE having credentials; gating it behind bearer breaks discovery.
      expect(res.status).toBe(200);
      expect(res.status).not.toBe(401);
    } finally {
      delete process.env['THEMEMORY_API_KEY'];
    }
  });
});
