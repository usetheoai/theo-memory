/**
 * Mem0 vendor real-SaaS round-trip integration test.
 *
 * Per plan v1.3 § Phase 4 / T4.1, exercises Mem0OfficialClient against
 * the real Mem0 cloud API gated by `MEM0_API_KEY`. Without the env var
 * the entire suite is SKIPPED cleanly (CI-without-secrets viable per
 * EC-14 documented risk).
 *
 * Round-trip: 1 add → wait for async index → 1 search → assert
 * non-empty result with semantically-relevant text.
 *
 * NOTE: This test burns real Mem0 API quota when env is set (EC-12
 * documented risk; cron at `0 6 * * *` × 30d × ~5 calls = ~450/month).
 */
import { expect, it } from 'vitest';

import { Mem0OfficialClient } from '../../../src/benchmarks/mem0/vendor-client.js';

import { describeMem0 } from './_helpers.js';

const INDEX_WAIT_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describeMem0('Mem0 vendor real-SaaS round-trip (gated by MEM0_API_KEY)', () => {
  it('add() then search() returns the added memory', async () => {
    // Given a real MemoryClient configured with MEM0_API_KEY
    const { MemoryClient } = await import('mem0ai');
    const sdk = new MemoryClient({ apiKey: process.env.MEM0_API_KEY! });
    const client = new Mem0OfficialClient(sdk);

    // unique scope per run to avoid cross-test interference
    const scopeKey = `themory-v0-9-test-${Date.now()}`;
    const text = 'I prefer espresso over filter coffee';

    // When add() then search()
    await client.add(scopeKey, text);
    await sleep(INDEX_WAIT_MS); // Mem0 indexes async

    const results = await client.search(scopeKey, 'coffee preferences', 5);

    // Then non-empty result with semantically-relevant text
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    expect(top?.text).toMatch(/espresso|coffee|filter/i);
    expect(top?.score).toBeGreaterThan(0);
  }, 30_000);
});
