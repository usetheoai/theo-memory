/**
 * T2.1 RED — ZepOfficialClient unit tests.
 *
 * Per plan v1.3 § Phase 2 / T2.1, asserts:
 * - method delegation + session lifecycle (user.add + memory.addSession + memory.add)
 * - EC-4 idempotent 409 on memory.addSession (try/catch + ignore 409)
 * - EC-11 concurrent add same scopeKey no data loss (Promise.all race-safe)
 * - blueprint R2 search uses graph.search
 * - EC-6 empty results propagation
 * - EC-2 typed synthesize throw
 */
import { describe, expect, it, vi } from 'vitest';

import { VendorSynthesizeUnsupportedError } from '../../../core/errors.js';
import { ZepOfficialClient } from '../vendor-client.js';

interface StubSearchHit {
  readonly episode?: { readonly content?: string };
  readonly fact?: string;
  readonly score?: number;
}

class StubZepSdk {
  shouldThrow409 = false;
  graphSearchResult: StubSearchHit[] = [];

  user = {
    add: vi.fn(async (_opts: { userId: string }) => ({})),
  };

  memory = {
    addSession: vi.fn(
      async (opts: { sessionId: string; userId: string }): Promise<unknown> => {
        if (this.shouldThrow409) {
          const err: Error & { statusCode?: number } = new Error('Conflict');
          err.statusCode = 409;
          throw err;
        }
        return {};
      },
    ),
    add: vi.fn(async (_sessionId: string, _payload: unknown) => ({})),
  };

  graph = {
    search: vi.fn(async (_opts: unknown): Promise<StubSearchHit[]> => this.graphSearchResult),
  };
}

describe('ZepOfficialClient (T2.1 RED — wraps @getzep/zep-cloud SDK per blueprint R2)', () => {
  it('add() handles existing-session 409 idempotently per EC-4', async () => {
    // Given 2 sequential add() to same scopeKey; 2nd triggers 409 on addSession
    const sdk = new StubZepSdk();
    sdk.shouldThrow409 = true;
    const client = new ZepOfficialClient(sdk);
    // When two adds to the same session
    await client.add('session-1', 'msg-1');
    await client.add('session-1', 'msg-2');
    // Then both memory.add() invocations succeeded — 409 ignored on session create
    expect(sdk.memory.add).toHaveBeenCalledTimes(2);
  });

  it('concurrent add() same scopeKey: no data loss per EC-11', async () => {
    // Given concurrent adds — race on session lifecycle
    const sdk = new StubZepSdk();
    sdk.shouldThrow409 = true;
    const client = new ZepOfficialClient(sdk);
    // When Promise.all of two adds
    await Promise.all([client.add('s1', 'm1'), client.add('s1', 'm2')]);
    // Then both messages persist (409 ignored, no deadlock)
    expect(sdk.memory.add).toHaveBeenCalledTimes(2);
  });

  it('search() uses graph.search per blueprint R2', async () => {
    // Given graph.search stub returns episode-shape result
    const sdk = new StubZepSdk();
    sdk.graphSearchResult = [{ episode: { content: 'fact-1' }, score: 0.85 }];
    const client = new ZepOfficialClient(sdk);
    // When search()
    const results = await client.search('s1', 'query-text', 5);
    // Then graph.search invoked + result mapped to { text, score }
    expect(sdk.graph.search).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    const first = results[0];
    expect(first?.text).toBe('fact-1');
    expect(first?.score).toBe(0.85);
  });

  it('search() returns [] when no matches per EC-6', async () => {
    // Given empty graph.search result
    const sdk = new StubZepSdk();
    sdk.graphSearchResult = [];
    const client = new ZepOfficialClient(sdk);
    // When search()
    const results = await client.search('s1', 'q', 5);
    // Then []
    expect(results).toEqual([]);
  });

  it('synthesize() throws typed VendorSynthesizeUnsupportedError per EC-2', () => {
    // Given a ZepOfficialClient
    const client = new ZepOfficialClient(new StubZepSdk());
    // When synthesize()
    // Then typed error
    expect(() => client.synthesize('q', ['ctx'])).toThrow(VendorSynthesizeUnsupportedError);
  });
});
