/**
 * The streamable-HTTP transport behind the OAuth resource-server gate (usetheoai/theo#477).
 *
 * The token rules themselves are pinned in `auth/oauth-resource-server.test.ts` against real
 * RS256 tokens. Here the verifier is a table, because the questions are about the transport:
 * is the gate in front of every request, does a session stay with the principal that opened
 * it, and does the TLS-upstream exception open exactly what it says and nothing more.
 */
import { request } from 'node:http';

import { describe, expect, it } from 'vitest';

import type { AccessTokenVerifier, ResourceServerConfig } from '../auth/oauth-resource-server.js';
import { loadResourceServerConfig } from '../auth/oauth-resource-server.js';
import { McpServer } from '../server.js';
import { connectStdio } from '../transports/stdio.js';

import { connectStreamableHttp } from './streamable-http.js';

const PRINCIPALS: Record<string, { tenantId: string; subject: string }> = {
  'tok-a': { tenantId: 'tn-A', subject: 'alice' },
  'tok-a-bob': { tenantId: 'tn-A', subject: 'bob' },
  'tok-b': { tenantId: 'tn-B', subject: 'alice' },
};

const tableVerifier: AccessTokenVerifier = {
  verify: (token) => {
    const p = PRINCIPALS[token];
    return Promise.resolve(
      p === undefined
        ? { ok: false, kind: 'invalid', reason: 'unknown test token' }
        : { ok: true, principal: { ...p, scopes: [] } },
    );
  },
};

const config: ResourceServerConfig = loadResourceServerConfig({
  THEO_MCP_RESOURCE: 'https://app.test.example/mcp/memory',
  THEO_OAUTH_ISSUER: 'https://auth.test.example/',
});

const oauth = { config, verifier: tableVerifier, logWarn: (): void => undefined };

interface Reply {
  readonly status: number;
  readonly sessionId: string | undefined;
  readonly headers: Record<string, string | string[] | undefined>;
}

function post(port: number, body: unknown, headers: Record<string, string>): Promise<Reply> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          const raw = res.headers['mcp-session-id'];
          resolve({
            status: res.statusCode ?? 0,
            sessionId: Array.isArray(raw) ? raw[0] : raw,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};
const TOOLS_LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

const newServer = (): McpServer => new McpServer({ name: 'themory', version: 'test' });

describe('connectStreamableHttp behind the OAuth gate', () => {
  it('test_request_without_a_token_is_401_with_the_resource_metadata_challenge', async () => {
    const handle = await connectStreamableHttp(newServer, { port: 0, host: '127.0.0.1', oauth });
    try {
      const reply = await post(handle.port, INITIALIZE, {});
      expect(reply.status).toBe(401);
      expect(String(reply.headers['www-authenticate'])).toContain(
        'resource_metadata="https://app.test.example/.well-known/oauth-protected-resource/mcp/memory"',
      );
    } finally {
      await handle.close();
    }
  });

  it('test_metadata_document_is_reachable_through_the_transport', async () => {
    const handle = await connectStreamableHttp(newServer, { port: 0, host: '127.0.0.1', oauth });
    try {
      const res = await fetch(
        `http://127.0.0.1:${String(handle.port)}/.well-known/oauth-protected-resource/mcp/memory`,
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { resource: string }).resource).toBe('https://app.test.example/mcp/memory');
    } finally {
      await handle.close();
    }
  });

  it('test_session_answers_the_principal_that_opened_it', async () => {
    const handle = await connectStreamableHttp(newServer, { port: 0, host: '127.0.0.1', oauth });
    try {
      const init = await post(handle.port, INITIALIZE, { authorization: 'Bearer tok-a' });
      expect(init.status).toBe(200);
      expect(init.sessionId).toBeDefined();
      const same = await post(handle.port, TOOLS_LIST, {
        authorization: 'Bearer tok-a',
        'mcp-session-id': init.sessionId!,
      });
      expect(same.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it('test_session_opened_by_one_tenant_is_not_found_for_another', async () => {
    const handle = await connectStreamableHttp(newServer, { port: 0, host: '127.0.0.1', oauth });
    try {
      const init = await post(handle.port, INITIALIZE, { authorization: 'Bearer tok-a' });
      const other = await post(handle.port, TOOLS_LIST, {
        authorization: 'Bearer tok-b',
        'mcp-session-id': init.sessionId!,
      });
      expect(other.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it('test_session_opened_by_one_user_is_not_found_for_another_user_of_the_same_tenant', async () => {
    const handle = await connectStreamableHttp(newServer, { port: 0, host: '127.0.0.1', oauth });
    try {
      const init = await post(handle.port, INITIALIZE, { authorization: 'Bearer tok-a' });
      const other = await post(handle.port, TOOLS_LIST, {
        authorization: 'Bearer tok-a-bob',
        'mcp-session-id': init.sessionId!,
      });
      expect(other.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it('test_stdio_has_no_auth_surface', () => {
    // stdio is a local subprocess pipe with no headers; nothing could carry a token.
    expect(connectStdio.length).toBeLessThanOrEqual(1);
  });
});

describe('connectStreamableHttp TLS terminated upstream', () => {
  it('test_non_localhost_without_tls_is_refused_when_upstream_termination_is_not_declared', async () => {
    await expect(
      connectStreamableHttp(newServer, { port: 0, host: '0.0.0.0', oauth }),
    ).rejects.toThrow(/THEO_MCP_TLS_TERMINATED_UPSTREAM/);
  });

  it('test_non_localhost_serves_plain_http_when_tls_is_terminated_upstream', async () => {
    const handle = await connectStreamableHttp(newServer, {
      port: 0,
      host: '0.0.0.0',
      oauth,
      tlsTerminatedUpstream: true,
    });
    try {
      // Plain HTTP answers — and the gate is still in front of it.
      const reply = await post(handle.port, INITIALIZE, {});
      expect(reply.status).toBe(401);
    } finally {
      await handle.close();
    }
  });

  it('test_upstream_termination_does_not_admit_an_unauthenticated_listener', async () => {
    await expect(
      connectStreamableHttp(newServer, { port: 0, host: '0.0.0.0', tlsTerminatedUpstream: true }),
    ).rejects.toThrow(/without authentication/);
  });
});
