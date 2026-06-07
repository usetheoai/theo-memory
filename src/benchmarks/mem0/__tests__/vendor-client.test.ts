/**
 * T1.1 RED — Mem0OfficialClient unit tests.
 *
 * Per plan v1.3 § Phase 1 / T1.1, asserts:
 * - method delegation: add() forwards (text, { user_id: scopeKey, infer: true })
 * - EC-3 field mapping: SDK returns `memory` (NOT `text`); adapter remaps
 * - EC-6 empty results propagation
 * - EC-2 typed synthesize throw (VendorSynthesizeUnsupportedError)
 * - EC-10 DI constructor pattern (pre-constructed SDK, not api-key string)
 */
import { describe, expect, it } from 'vitest';

import { VendorSynthesizeUnsupportedError } from '../../../core/errors.js';
import { Mem0OfficialClient } from '../vendor-client.js';

interface StubAddOpts {
  readonly user_id: string;
  readonly infer: boolean;
}

interface StubSearchOpts {
  readonly user_id: string;
  readonly top_k: number;
}

interface StubSearchResult {
  readonly memory: string;
  readonly score: number;
}

class StubMem0Sdk {
  lastAddArgs: [string, StubAddOpts] | null = null;
  lastSearchArgs: [string, StubSearchOpts] | null = null;
  searchResult: StubSearchResult[] = [];

  add(text: string, opts: StubAddOpts): Promise<{ id: string }> {
    this.lastAddArgs = [text, opts];
    return Promise.resolve({ id: 'stub-id-1' });
  }

  search(query: string, opts: StubSearchOpts): Promise<StubSearchResult[]> {
    this.lastSearchArgs = [query, opts];
    return Promise.resolve(this.searchResult);
  }
}

describe('Mem0OfficialClient (T1.1 RED — wraps vendor SDK SDK per ADR D2 + EC-3 mapping)', () => {
  it('add() delegates to SDK with user_id mapping per Sub-goal 1', async () => {
    // Given Mem0OfficialClient wrapping a stub SDK
    const sdk = new StubMem0Sdk();
    const client = new Mem0OfficialClient(sdk);
    // When add() is invoked with the canonical scopeKey + text
    await client.add('user-abc', 'I love sushi');
    // Then SDK receives the message with { user_id: scopeKey, infer: true }
    expect(sdk.lastAddArgs).toEqual(['I love sushi', { user_id: 'user-abc', infer: true }]);
  });

  it('search() maps `memory` field to `text` per EC-3 (reference TS port v3.0.6 contract)', async () => {
    // Given stub returns reference TS port v3 shape with `memory` field (NOT `text`)
    const sdk = new StubMem0Sdk();
    sdk.searchResult = [{ memory: 'hello world', score: 0.9 }];
    const client = new Mem0OfficialClient(sdk);
    // When search() is invoked
    const results = await client.search('user-abc', 'greeting', 5);
    // Then result has `text` (mapped from `memory`) + `score`
    expect(results).toEqual([{ text: 'hello world', score: 0.9 }]);
  });

  it('search() returns empty array when SDK returns no matches per EC-6', async () => {
    // Given stub returns empty
    const sdk = new StubMem0Sdk();
    sdk.searchResult = [];
    const client = new Mem0OfficialClient(sdk);
    // When search()
    const results = await client.search('user-abc', 'no match', 5);
    // Then [] propagated (not null, not undefined, not throw)
    expect(results).toEqual([]);
  });

  it('synthesize() throws typed VendorSynthesizeUnsupportedError per ADR D2 + EC-2', () => {
    // Given a Mem0OfficialClient
    const client = new Mem0OfficialClient(new StubMem0Sdk());
    // When synthesize() is invoked
    // Then it throws the typed error (NOT a generic Error)
    expect(() => client.synthesize('q', ['ctx'])).toThrow(VendorSynthesizeUnsupportedError);
  });

  it('constructor uses DI pattern (pre-constructed SDK, NOT api-key string) per EC-10', () => {
    // Given pre-constructed SDK (DI)
    const sdk = new StubMem0Sdk();
    // When Mem0OfficialClient instantiated with the SDK directly
    const client = new Mem0OfficialClient(sdk);
    // Then constructor accepts the SDK instance without requiring api-key string
    expect(client).toBeDefined();
    // Defensive: ensure no api-key parsing happened by inspecting stub state
    expect(sdk.lastAddArgs).toBeNull();
  });
});
