/**
 * Stub RFC 7662 issuer for fixes-cycle-1 e2e tests — a minimal node:http
 * listener emitting fake OIDC discovery + introspection responses.
 *
 * Avoids running real Hydra in CI (image too heavy); the discovery doc +
 * introspection response shape are RFC-faithful enough to exercise the
 * production oauth4webapi adapter end-to-end.
 *
 * EC-10 absorption: callers MUST `await stubIssuer.close()` in afterEach
 * to release the port — the `Promise.allSettled` pattern in the e2e test
 * defends against cascade EADDRINUSE if a scenario crashes.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-fixes-cycle-1-plan.md § T4.1
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubIssuerOptions {
  /**
   * Map of `active=true` tokens. Any token not in this map gets `active=false`.
   * Values are optional claim attributes returned in the introspection response.
   */
  readonly activeTokens: Record<string, { sub?: string; scope?: string; exp?: number }>;
}

export interface StubIssuerHandle {
  readonly issuerUrl: string;
  readonly port: number;
  close(): Promise<void>;
}

export async function startStubIssuer(opts: StubIssuerOptions): Promise<StubIssuerHandle> {
  // Avoid eager URL capture: use a closure that resolves issuer URL post-listen.
  let issuerUrlResolved = '';

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url ?? '/';

    // RFC 8414 — discovery endpoint
    if (url === '/.well-known/openid-configuration' || url === '/.well-known/oauth-authorization-server') {
      const body = {
        issuer: issuerUrlResolved,
        introspection_endpoint: `${issuerUrlResolved}/oauth2/introspect`,
        authorization_endpoint: `${issuerUrlResolved}/oauth2/auth`,
        token_endpoint: `${issuerUrlResolved}/oauth2/token`,
        jwks_uri: `${issuerUrlResolved}/.well-known/jwks.json`,
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    // RFC 7662 — introspection endpoint (POST; token in body)
    if (url === '/oauth2/introspect' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const token = params.get('token') ?? '';
        const hit = opts.activeTokens[token];
        const responseBody = hit !== undefined
          ? { active: true, ...hit }
          : { active: false };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(responseBody));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  };

  const server: Server = createHttpServer(handle);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const port = addr !== null && typeof addr === 'object' ? (addr as AddressInfo).port : 0;
  issuerUrlResolved = `http://127.0.0.1:${String(port)}`;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err !== undefined ? reject(err) : resolve()));
    });
  };

  return { issuerUrl: issuerUrlResolved, port, close };
}
