/**
 * Unit coverage for the session registry's lifecycle rules.
 *
 * Each case pins a behaviour that was written to fix a specific defect and had no
 * regression test — the review of M7 flagged exactly that gap. The testing rules
 * § 3 requires every bug fix to start from a failing test; these backfill the ones
 * that were missing.
 */
import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpSessionRegistry } from './mcp-session-registry.js';
import type { McpServer } from '../server.js';

/** A server that records stop() calls without touching the SDK. */
function fakeServer(): McpServer {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpServer;
}

function request(sessionId?: string): IncomingMessage {
  return {
    headers: sessionId === undefined ? {} : { 'mcp-session-id': sessionId },
  } as unknown as IncomingMessage;
}

interface RecordedResponse {
  readonly res: ServerResponse;
  status(): number | undefined;
  body(): string;
  /** Simulates the HTTP response completing (emits finish, then close). */
  finish(): void;
  /** Simulates the client aborting mid-flight (emits close only). */
  abort(): void;
}

function recordingResponse(): RecordedResponse {
  let status: number | undefined;
  let payload = '';
  // A real ServerResponse emits 'finish' when the response completes; the registry
  // hangs its runtime eviction on that, so the double must honor it.
  const listeners = new Map<string, Array<() => void>>();
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk?: string) => {
      payload = chunk ?? '';
    },
    once: (event: string, fn: () => void) => {
      const bucket = listeners.get(event) ?? [];
      bucket.push(fn);
      listeners.set(event, bucket);
    },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    body: () => payload,
    // A completed response emits finish THEN close; an aborted one emits close only.
    finish: () => {
      for (const event of ['finish', 'close']) {
        (listeners.get(event) ?? []).splice(0).forEach((fn) => fn());
      }
    },
    abort: () => (listeners.get('close') ?? []).splice(0).forEach((fn) => fn()),
  };
}

/** A registry plus the servers it built, so tests can assert on their teardown. */
function trackingRegistry(): { registry: McpSessionRegistry; created: McpServer[] } {
  const created: McpServer[] = [];
  const registry = new McpSessionRegistry(() => {
    const server = fakeServer();
    created.push(server);
    return server;
  });
  return { registry, created };
}

describe('McpSessionRegistry', () => {
  it('rejects an unknown session id instead of opening a new session under it', async () => {
    // Silently upgrading would hand the client a session it never negotiated —
    // it would believe it is on the id it sent.
    const { registry, created } = trackingRegistry();
    const reply = recordingResponse();

    const transport = await registry.resolve(request('00000000-0000-4000-8000-000000000000'), reply.res);

    expect(transport).toBeUndefined();
    expect(reply.status()).toBe(404);
    expect(reply.body()).toContain('-32001');
    expect(created, 'no server may be built for an unknown id').toHaveLength(0);
  });

  it('holds a pre-initialize session so an abandoned handshake is still reachable', async () => {
    // Before `initialize` completes the session has no id, so it is in no map.
    // Untracked, it would pin an McpServer for the process lifetime.
    const registry = new McpSessionRegistry(fakeServer);

    await registry.resolve(request(), recordingResponse().res);

    expect(registry.size).toBe(1);
  });

  it('stops every held session on closeAll, including pre-initialize ones', async () => {
    const { registry, created } = trackingRegistry();
    await registry.resolve(request(), recordingResponse().res);
    await registry.resolve(request(), recordingResponse().res);

    await registry.closeAll();

    expect(registry.size).toBe(0);
    for (const server of created) {
      expect(vi.mocked(server.stop)).toHaveBeenCalledTimes(1);
    }
  });

  it('stops a session at most once across both teardown paths', async () => {
    // server.stop() closes the transport, which fires onclose, which would call
    // server.stop() again — the cycle that produced "Maximum call stack size
    // exceeded". The guard must hold whichever path starts it.
    const { registry, created } = trackingRegistry();
    const transport = await registry.resolve(request(), recordingResponse().res);

    await registry.closeAll();
    // Simulate the SDK firing onclose as a consequence of the stop above.
    transport?.onclose?.();

    expect(vi.mocked(created[0]!.stop)).toHaveBeenCalledTimes(1);
  });
});

describe('McpSessionRegistry — runtime eviction (M7)', () => {
  it('stops a session whose response ended without establishing one', async () => {
    // The SDK answers a sessionless non-initialize with 400 and returns early without
    // closing the transport, so `onclose` never fires. Relying on closeAll alone left
    // one McpServer pinned per such request for the process lifetime — a client retry
    // loop grew it without bound.
    const { registry, created } = trackingRegistry();
    const reply = recordingResponse();

    await registry.resolve(request(), reply.res);
    expect(registry.size, 'held while the response is in flight').toBe(1);

    reply.finish();

    expect(registry.size, 'released once the response ended with no session').toBe(0);
    expect(vi.mocked(created[0]!.stop)).toHaveBeenCalledTimes(1);
  });

  it('does not evict a session that completed its handshake', async () => {
    const { registry, created } = trackingRegistry();
    const reply = recordingResponse();
    const transport = await registry.resolve(request(), reply.res);
    // Stand in for the SDK minting an id on a successful initialize.
    Object.defineProperty(transport, 'sessionId', { value: 'sess-1', configurable: true });

    reply.finish();

    expect(vi.mocked(created[0]!.stop), 'a live session must survive its first response')
      .not.toHaveBeenCalled();
  });
});

describe('McpSessionRegistry — aborted handshake (M7)', () => {
  it('releases a session whose client disconnected before the response was written', async () => {
    // 'finish' never fires on an aborted response, so hanging eviction on it alone
    // left the same leak in a narrower window. 'close' covers both endings.
    const { registry, created } = trackingRegistry();
    const reply = recordingResponse();

    await registry.resolve(request(), reply.res);
    reply.abort();

    expect(registry.size).toBe(0);
    expect(vi.mocked(created[0]!.stop)).toHaveBeenCalledTimes(1);
  });
});
