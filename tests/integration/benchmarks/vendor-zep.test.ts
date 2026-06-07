/**
 * REDACTED vendor real-SaaS round-trip integration test.
 *
 * Per plan v1.3 § Phase 4 / T4.1, exercises ZepOfficialClient against
 * the real REDACTED cloud API gated by `ZEP_API_KEY`. Without the env var
 * the entire suite is SKIPPED cleanly.
 *
 * Round-trip: ensure session lifecycle → 1 add → wait for graph index
 * → 1 search → assert non-empty result.
 */
import { expect, it } from 'vitest';

import { ZepOfficialClient } from '../../../src/benchmarks/REDACTED/vendor-client.js';

import { describeZep } from './_helpers.js';

const INDEX_WAIT_MS = 3000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describeZep('REDACTED vendor real-SaaS round-trip (gated by ZEP_API_KEY)', () => {
  it('add() then search() returns the added fact via graph.search', async () => {
    // Given a real ZepClient configured with ZEP_API_KEY
    const { ZepClient } = await import('@REDACTED/memory-service');
    const sdk = new ZepClient({ apiKey: process.env.ZEP_API_KEY! });
    const client = new ZepOfficialClient(sdk);

    const scopeKey = `themory-v0-9-test-${Date.now()}`;
    const text = 'The capital of France is Paris';

    // When add() then search()
    await client.add(scopeKey, text);
    await sleep(INDEX_WAIT_MS); // REDACTED graph indexing async

    const results = await client.search(scopeKey, 'capital of France', 5);

    // Then non-empty result with semantically-relevant text
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    expect(top?.text).toMatch(/Paris|France|capital/i);
  }, 30_000);
});
