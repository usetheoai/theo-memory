/**
 * The MCP transport as an OAuth 2.1 resource server (usetheoai/theo#477, MCP authorization spec).
 *
 * Every token here is signed by a locally generated RSA key and verified against an
 * in-process JWKS server — the same shape Hydra presents in production, with no network.
 * Each negative case is its own test: a gate that rejects "a bad token" in general proves
 * nothing about the specific claim a forged token would get wrong.
 */
import { createServer, request } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createJwtAccessTokenVerifier,
  loadResourceServerConfig,
  ResourceServerConfigError,
  withOAuthResourceServer,
} from './oauth-resource-server.js';
import type { ResourceServerConfig } from './oauth-resource-server.js';
import { userFromRequest, workspaceFromRequest } from './request-workspace.js';

/** jose's key type, without depending on the DOM lib's global `CryptoKey`. */
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

const ISSUER = 'https://auth.test.example/';
const RESOURCE_PATH = '/mcp/memory';
const KID = 'test-key-1';

interface Listening {
  readonly server: Server;
  readonly port: number;
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<Listening> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

interface Reply {
  readonly status: number;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

function send(port: number, path: string, headers: Record<string, string> = {}, method = 'POST'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('MCP OAuth resource server', () => {
  let signingKey: SigningKey;
  let strangerKey: SigningKey;
  let jwks: Listening;
  let gate: Listening;
  let config: ResourceServerConfig;
  let resource: string;
  const delegated: { workspace: string | undefined; user: string | undefined }[] = [];
  const logged: { msg: string; details: Record<string, unknown> }[] = [];

  async function token(
    claims: Record<string, unknown> = {},
    header: Record<string, unknown> = {},
    opts: { key?: SigningKey; expiresIn?: string | number } = {},
  ): Promise<string> {
    const jwt = new SignJWT({ tenant_id: 'tn-alpha', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'at+jwt', ...header })
      .setIssuer(ISSUER)
      .setAudience(resource)
      .setSubject('user-alice')
      .setIssuedAt();
    jwt.setExpirationTime(opts.expiresIn ?? '5m');
    return jwt.sign(opts.key ?? signingKey);
  }

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256', { extractable: true });
    signingKey = pair.privateKey;
    strangerKey = (await generateKeyPair('RS256')).privateKey;
    const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
    jwks = await listen((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
    });

    // The gate is bound first so its origin can be the resource the tokens name.
    let handler: (req: IncomingMessage, res: ServerResponse) => void = () => undefined;
    gate = await listen((req, res) => handler(req, res));
    resource = `http://127.0.0.1:${String(gate.port)}${RESOURCE_PATH}`;
    config = loadResourceServerConfig({
      THEO_MCP_RESOURCE: resource,
      THEO_OAUTH_ISSUER: ISSUER,
      THEO_OAUTH_JWKS_URI: `http://127.0.0.1:${String(jwks.port)}/jwks.json`,
      THEO_MCP_SCOPES_SUPPORTED: 'memory:read, memory:write',
    });
    const wrapped = withOAuthResourceServer(
      (req, res) => {
        delegated.push({ workspace: workspaceFromRequest(req), user: userFromRequest(req) });
        res.statusCode = 200;
        res.end('ok');
      },
      {
        config,
        verifier: createJwtAccessTokenVerifier(config),
        logWarn: (msg, details) => logged.push({ msg, details }),
      },
    );
    handler = (req, res) => void wrapped(req, res);
  });

  afterAll(async () => {
    await close(gate.server);
    await close(jwks.server);
  });

  const challengeUrl = (): string =>
    `http://127.0.0.1:${String(gate.port)}/.well-known/oauth-protected-resource${RESOURCE_PATH}`;

  function expectInvalidToken(reply: Reply): void {
    expect(reply.status).toBe(401);
    const challenge = String(reply.headers['www-authenticate']);
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain(`resource_metadata="${challengeUrl()}"`);
  }

  it('test_valid_token_reaches_the_handler_bound_to_its_tenant_and_subject', async () => {
    delegated.length = 0;
    const reply = await send(gate.port, '/', { authorization: `Bearer ${await token()}` });
    expect(reply.status).toBe(200);
    expect(delegated).toEqual([{ workspace: 'tn-alpha', user: 'user-alice' }]);
  });

  it('test_missing_authorization_header_is_401_with_resource_metadata', async () => {
    expectInvalidToken(await send(gate.port, '/'));
  });

  it('test_wrong_issuer_is_401', async () => {
    const jwt = await new SignJWT({ tenant_id: 'tn-alpha' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer('https://auth.test.example') // no trailing slash: exact match is required
      .setAudience(resource)
      .setSubject('user-alice')
      .setExpirationTime('5m')
      .sign(signingKey);
    expectInvalidToken(await send(gate.port, '/', { authorization: `Bearer ${jwt}` }));
  });

  it('test_audience_without_the_resource_is_401', async () => {
    const jwt = await new SignJWT({ tenant_id: 'tn-alpha' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(['https://app.test.example/mcp/rag', `${resource}/`])
      .setSubject('user-alice')
      .setExpirationTime('5m')
      .sign(signingKey);
    expectInvalidToken(await send(gate.port, '/', { authorization: `Bearer ${jwt}` }));
  });

  it('test_audience_array_containing_the_resource_is_accepted', async () => {
    const jwt = await new SignJWT({ tenant_id: 'tn-alpha' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(['https://app.test.example/mcp/rag', resource])
      .setSubject('user-alice')
      .setExpirationTime('5m')
      .sign(signingKey);
    expect((await send(gate.port, '/', { authorization: `Bearer ${jwt}` })).status).toBe(200);
  });

  it('test_expired_token_beyond_the_leeway_is_401', async () => {
    const past = Math.floor(Date.now() / 1000) - 120;
    expectInvalidToken(
      await send(gate.port, '/', { authorization: `Bearer ${await token({}, {}, { expiresIn: past })}` }),
    );
  });

  it('test_token_expired_within_the_60s_leeway_is_accepted', async () => {
    const recent = Math.floor(Date.now() / 1000) - 30;
    const reply = await send(gate.port, '/', {
      authorization: `Bearer ${await token({}, {}, { expiresIn: recent })}`,
    });
    expect(reply.status).toBe(200);
  });

  it('test_not_before_in_the_future_is_401', async () => {
    const future = Math.floor(Date.now() / 1000) + 300;
    expectInvalidToken(await send(gate.port, '/', { authorization: `Bearer ${await token({ nbf: future })}` }));
  });

  it('test_hs256_token_is_401', async () => {
    const jwt = await new SignJWT({ tenant_id: 'tn-alpha' })
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(resource)
      .setSubject('user-alice')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-that-is-long-enough-for-hs256'));
    expectInvalidToken(await send(gate.port, '/', { authorization: `Bearer ${jwt}` }));
  });

  it('test_alg_none_token_is_401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const unsigned =
      `${b64url({ alg: 'none', kid: KID, typ: 'JWT' })}.` +
      `${b64url({ iss: ISSUER, aud: resource, sub: 'user-alice', tenant_id: 'tn-alpha', exp: now + 300 })}.`;
    expectInvalidToken(await send(gate.port, '/', { authorization: `Bearer ${unsigned}` }));
  });

  it('test_unknown_kid_is_401', async () => {
    const jwt = await token({}, { kid: 'rotated-away' }, { key: strangerKey });
    expectInvalidToken(await send(gate.port, '/', { authorization: `Bearer ${jwt}` }));
  });

  it('test_known_kid_with_a_foreign_signature_is_401', async () => {
    expectInvalidToken(
      await send(gate.port, '/', { authorization: `Bearer ${await token({}, {}, { key: strangerKey })}` }),
    );
  });

  it('test_missing_kid_is_401', async () => {
    const jwt = await new SignJWT({ tenant_id: 'tn-alpha' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(resource)
      .setSubject('user-alice')
      .setExpirationTime('5m')
      .sign(signingKey);
    expectInvalidToken(await send(gate.port, '/', { authorization: `Bearer ${jwt}` }));
  });

  it('test_unexpected_typ_is_401', async () => {
    expectInvalidToken(
      await send(gate.port, '/', { authorization: `Bearer ${await token({}, { typ: 'id+jwt' })}` }),
    );
  });

  it('test_missing_tenant_id_is_401', async () => {
    expectInvalidToken(
      await send(gate.port, '/', { authorization: `Bearer ${await token({ tenant_id: undefined })}` }),
    );
  });

  it('test_blank_tenant_id_is_401', async () => {
    expectInvalidToken(await send(gate.port, '/', { authorization: `Bearer ${await token({ tenant_id: '  ' })}` }));
  });

  it('test_tenant_id_nested_in_ext_instead_of_top_level_is_401', async () => {
    expectInvalidToken(
      await send(gate.port, '/', {
        authorization: `Bearer ${await token({ tenant_id: undefined, ext: { tenant_id: 'tn-alpha' } })}`,
      }),
    );
  });

  it('test_token_in_query_string_is_ignored', async () => {
    delegated.length = 0;
    const jwt = await token();
    expectInvalidToken(await send(gate.port, `/?access_token=${jwt}`));
    expect(delegated).toHaveLength(0);
  });

  it('test_client_supplied_user_header_cannot_override_the_token_subject', async () => {
    delegated.length = 0;
    const reply = await send(gate.port, '/', {
      authorization: `Bearer ${await token()}`,
      'x-theo-user-id': 'user-mallory',
      'x-workspace-id': 'tn-evil',
    });
    expect(reply.status).toBe(200);
    expect(delegated).toEqual([{ workspace: 'tn-alpha', user: 'user-alice' }]);
  });

  it('test_theo_live_api_key_is_rejected_like_any_non_jwt', async () => {
    expectInvalidToken(
      await send(gate.port, '/', { authorization: `Bearer theo_live_${'a'.repeat(43)}` }),
    );
  });

  it('test_rejection_is_logged_with_a_reason_and_never_the_token', async () => {
    logged.length = 0;
    const jwt = await token({}, {}, { expiresIn: Math.floor(Date.now() / 1000) - 600 });
    await send(gate.port, '/', { authorization: `Bearer ${jwt}` });
    expect(logged).toHaveLength(1);
    expect(logged[0]?.details['reason']).toBeTruthy();
    expect(JSON.stringify(logged)).not.toContain(jwt);
  });

  it('test_root_metadata_document_is_served_unauthenticated', async () => {
    const reply = await send(gate.port, '/.well-known/oauth-protected-resource', {}, 'GET');
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({
      resource,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      scopes_supported: ['memory:read', 'memory:write'],
    });
  });

  it('test_path_suffixed_metadata_document_is_served_unauthenticated', async () => {
    const reply = await send(gate.port, `/.well-known/oauth-protected-resource${RESOURCE_PATH}`, {}, 'GET');
    expect(reply.status).toBe(200);
    expect((JSON.parse(reply.body) as { resource: string }).resource).toBe(resource);
  });
});

describe('MCP OAuth resource server — required scopes', () => {
  it('test_valid_token_without_a_required_scope_is_403_insufficient_scope', async () => {
    const pair = await generateKeyPair('RS256', { extractable: true });
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256' };
    const jwks = await listen((_req, res) => res.end(JSON.stringify({ keys: [jwk] })));
    const resource = 'http://127.0.0.1:1/mcp/memory';
    const config = loadResourceServerConfig({
      THEO_MCP_RESOURCE: resource,
      THEO_OAUTH_ISSUER: ISSUER,
      THEO_OAUTH_JWKS_URI: `http://127.0.0.1:${String(jwks.port)}/jwks.json`,
      THEO_MCP_REQUIRED_SCOPES: 'memory:write',
    });
    const gate = await listen((req, res) => {
      void withOAuthResourceServer(
        (_r, s) => {
          s.end('ok');
        },
        { config, verifier: createJwtAccessTokenVerifier(config), logWarn: () => undefined },
      )(req, res);
    });
    const sign = (scope: string): Promise<string> =>
      new SignJWT({ tenant_id: 'tn-alpha', scope })
        .setProtectedHeader({ alg: 'RS256', kid: KID })
        .setIssuer(ISSUER)
        .setAudience(resource)
        .setSubject('user-alice')
        .setExpirationTime('5m')
        .sign(pair.privateKey);
    try {
      const denied = await send(gate.port, '/', { authorization: `Bearer ${await sign('memory:read')}` });
      expect(denied.status).toBe(403);
      const challenge = String(denied.headers['www-authenticate']);
      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toContain('scope="memory:write"');

      const allowed = await send(gate.port, '/', {
        authorization: `Bearer ${await sign('memory:read memory:write')}`,
      });
      expect(allowed.status).toBe(200);
    } finally {
      await close(gate.server);
      await close(jwks.server);
    }
  });
});

describe('MCP OAuth resource server — JWKS unavailable', () => {
  it('test_unreachable_jwks_fails_closed_without_reaching_the_handler', async () => {
    const pair = await generateKeyPair('RS256');
    // Bind and release a port so nothing answers on it.
    const dead = await listen(() => undefined);
    const deadPort = dead.port;
    await close(dead.server);
    const resource = 'http://127.0.0.1:1/mcp/memory';
    const config = loadResourceServerConfig({
      THEO_MCP_RESOURCE: resource,
      THEO_OAUTH_ISSUER: ISSUER,
      THEO_OAUTH_JWKS_URI: `http://127.0.0.1:${String(deadPort)}/jwks.json`,
    });
    let reached = false;
    const gate = await listen((req, res) => {
      void withOAuthResourceServer(
        (_r, s) => {
          reached = true;
          s.end('ok');
        },
        { config, verifier: createJwtAccessTokenVerifier(config), logWarn: () => undefined },
      )(req, res);
    });
    const jwt = await new SignJWT({ tenant_id: 'tn-alpha' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(resource)
      .setSubject('user-alice')
      .setExpirationTime('5m')
      .sign(pair.privateKey);
    try {
      const reply = await send(gate.port, '/', { authorization: `Bearer ${jwt}` });
      expect(reply.status).toBe(503);
      expect(reached).toBe(false);
    } finally {
      await close(gate.server);
    }
  });
});

describe('loadResourceServerConfig', () => {
  const base = { THEO_MCP_RESOURCE: 'https://app.test.example/mcp/memory', THEO_OAUTH_ISSUER: ISSUER };

  it('test_refuses_to_start_without_the_resource', () => {
    expect(() => loadResourceServerConfig({ THEO_OAUTH_ISSUER: ISSUER })).toThrow(ResourceServerConfigError);
    expect(() => loadResourceServerConfig({ THEO_OAUTH_ISSUER: ISSUER })).toThrow(/THEO_MCP_RESOURCE/);
  });

  it('test_refuses_to_start_without_the_issuer', () => {
    expect(() => loadResourceServerConfig({ THEO_MCP_RESOURCE: base.THEO_MCP_RESOURCE })).toThrow(
      /THEO_OAUTH_ISSUER/,
    );
  });

  it('test_refuses_a_resource_with_a_trailing_slash', () => {
    expect(() =>
      loadResourceServerConfig({ ...base, THEO_MCP_RESOURCE: 'https://app.test.example/mcp/memory/' }),
    ).toThrow(/trailing slash/);
  });

  it('test_refuses_a_resource_with_a_query_or_fragment', () => {
    expect(() =>
      loadResourceServerConfig({ ...base, THEO_MCP_RESOURCE: 'https://app.test.example/mcp/memory#x' }),
    ).toThrow(ResourceServerConfigError);
  });

  it('test_jwks_uri_defaults_under_the_issuer', () => {
    expect(loadResourceServerConfig(base).jwksUri).toBe('https://auth.test.example/.well-known/jwks.json');
  });

  it('test_metadata_url_is_built_from_the_resource_origin_and_path', () => {
    expect(loadResourceServerConfig(base).resourceMetadataUrl).toBe(
      'https://app.test.example/.well-known/oauth-protected-resource/mcp/memory',
    );
  });
});
