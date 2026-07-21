/**
 * M7 regression — concurrent MCP sessions over streamable-http.
 *
 * Defect this pins: `connectStreamableHttp` built ONE `StreamableHTTPServerTransport`
 * and reused it for every request. An SDK transport binds its session at the first
 * `initialize`, so the SECOND client to connect got:
 *
 *   {"error":{"code":-32600,"message":"Invalid Request: Server already initialized"}}
 *
 * Observed end-to-end against the dev edge (https://app-dev.usetheo.dev/mcp/memory)
 * on 2026-07-21: the first handshake returned 200 + Mcp-Session-Id, every later one
 * returned HTTP 400. Net effect — exactly one MCP client could ever use the server,
 * which makes "every Claude Code instance shares the memory" impossible.
 *
 * The SDK-canonical shape is one transport per session, kept in a sessionId → transport
 * map and routed by the `Mcp-Session-Id` header. These tests assert the observable
 * contract (two independent clients both initialize, and get DISTINCT session ids)
 * rather than the internal map, so the test survives a refactor of the storage.
 */
import { describe, expect, it } from 'vitest';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '../server.js';
import { connectStreamableHttp } from './streamable-http.js';

interface Handshake {
  readonly status: number;
  readonly sessionId: string | undefined;
  readonly body: string;
}

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'regression-client', version: '1.0.0' },
  },
});

/** One real `initialize` over the wire — what Claude Code sends on connect. */
function initialize(port: number): Promise<Handshake> {
  return new Promise<Handshake>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Both types are required by the Streamable HTTP spec: the server may
          // answer with a JSON body or upgrade to an SSE stream.
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
          'content-length': Buffer.byteLength(INITIALIZE),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          const raw = res.headers['mcp-session-id'];
          resolve({
            status: res.statusCode ?? 0,
            sessionId: Array.isArray(raw) ? raw[0] : raw,
            body,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(INITIALIZE);
  });
}

function newServer(): McpServer {
  // No memoryFactory: `initialize` and `tools/list` never touch the backend, and
  // this test is about session lifecycle, not tool behavior.
  return new McpServer({ name: 'themory', version: 'test' });
}

/**
 * Boots a listener, runs two independent `initialize` handshakes against it, and
 * always closes the listener. Both tests need the same two-client setup and differ
 * only in what they assert about the pair.
 */
async function withTwoClients(
  assert: (first: Handshake, second: Handshake) => void,
): Promise<void> {
  const handle = await connectStreamableHttp(newServer, { port: 0, host: '127.0.0.1' });
  const port = (handle.address() as AddressInfo).port;
  try {
    assert(await initialize(port), await initialize(port));
  } finally {
    await handle.close();
  }
}

describe('connectStreamableHttp — concurrent sessions (M7)', () => {
  it('accepts a second client instead of rejecting it as "Server already initialized"', async () => {
    await withTwoClients((first, second) => {
      expect(first.status).toBe(200);
      // The regression: pre-fix this was 400 with -32600 "Server already initialized".
      expect(second.body).not.toContain('Server already initialized');
      expect(second.status).toBe(200);
    });
  });

  it('issues a distinct session id per client so their streams never cross', async () => {
    await withTwoClients((first, second) => {
      expect(first.sessionId).toBeDefined();
      expect(second.sessionId).toBeDefined();
      // Shared session ids would let one Claude Code instance read another's
      // in-flight responses — distinctness is the isolation boundary.
      expect(second.sessionId).not.toBe(first.sessionId);
    });
  });
});
