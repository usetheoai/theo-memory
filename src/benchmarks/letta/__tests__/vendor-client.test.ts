/**
 * T3.1 RED — LettaOfficialClient unit tests.
 *
 * Per plan v1.3 § Phase 3 / T3.1, asserts:
 * - method delegation with agentId mapping (scopeKey === agentId per ADR D1)
 * - EC-9 404 propagation when agent missing (vendor-identifiable msg)
 * - EC-5 passage without score: fallback rank-based decay 1/(i+1)
 * - EC-6 empty results propagation
 * - EC-2 typed synthesize throw
 */
import { describe, expect, it, vi } from 'vitest';

import { VendorSynthesizeUnsupportedError } from '../../../core/errors.js';
import { LettaOfficialClient } from '../vendor-client.js';

interface StubPassage {
  readonly text?: string;
  readonly score?: number;
}

class StubLettaSdk {
  shouldThrow404 = false;
  searchResult: StubPassage[] = [];

  agents = {
    archivalMemory: {
      insertArchivalMemoryAsync: vi.fn(async (_agentId: string, _payload: { text: string }) => {
        if (this.shouldThrow404) {
          const err: Error & { statusCode?: number } = new Error('Not Found');
          err.statusCode = 404;
          throw err;
        }
        return {};
      }),
      searchArchivalMemory: vi.fn(
        async (_agentId: string, _opts: { query: string; limit: number }): Promise<StubPassage[]> =>
          this.searchResult,
      ),
    },
  };
}

describe('LettaOfficialClient (T3.1 RED — wraps @letta-ai/letta-client SDK; agent-scoped)', () => {
  it('add() delegates to archivalMemory.insertArchivalMemoryAsync with agentId mapping', async () => {
    // Given LettaOfficialClient
    const sdk = new StubLettaSdk();
    const client = new LettaOfficialClient(sdk);
    // When add() invoked with scopeKey (= agentId per ADR D1)
    await client.add('agent-xyz', 'fact-1');
    // Then SDK call positional: (agentId, { text })
    expect(sdk.agents.archivalMemory.insertArchivalMemoryAsync).toHaveBeenCalledWith('agent-xyz', {
      text: 'fact-1',
    });
  });

  it('add() propagates 404 with vendor-identifiable message per EC-9', async () => {
    // Given SDK throws 404 on insertArchivalMemoryAsync
    const sdk = new StubLettaSdk();
    sdk.shouldThrow404 = true;
    const client = new LettaOfficialClient(sdk);
    // When add() to nonexistent agent
    // Then thrown error contains 'letta' (caller can distinguish vendor errors)
    await expect(client.add('nonexistent-agent', 'x')).rejects.toThrow(/letta/i);
  });

  it('search() falls back rank-based score when passage lacks score field per EC-5', async () => {
    // Given Passage results lacking explicit score (Letta archival ranking
    // returns Passages without numeric score in some plan tiers)
    const sdk = new StubLettaSdk();
    sdk.searchResult = [{ text: 'passage-1' }, { text: 'passage-2' }];
    const client = new LettaOfficialClient(sdk);
    // When search()
    const results = await client.search('agent-x', 'q', 5);
    // Then fallback score 1/(i+1) — first > second per rank decay
    expect(results).toHaveLength(2);
    const [first, second] = results;
    expect(first?.text).toBe('passage-1');
    expect(second?.text).toBe('passage-2');
    expect(first?.score).toBeGreaterThan(second!.score);
  });

  it('search() returns [] when no matches per EC-6', async () => {
    // Given empty searchArchivalMemory result
    const sdk = new StubLettaSdk();
    sdk.searchResult = [];
    const client = new LettaOfficialClient(sdk);
    // When search()
    const results = await client.search('agent-x', 'q', 5);
    // Then []
    expect(results).toEqual([]);
  });

  it('synthesize() throws typed VendorSynthesizeUnsupportedError per EC-2', () => {
    // Given a LettaOfficialClient
    const client = new LettaOfficialClient(new StubLettaSdk());
    // When synthesize()
    // Then typed error
    expect(() => client.synthesize('q', ['ctx'])).toThrow(VendorSynthesizeUnsupportedError);
  });
});
