/**
 * REDACTED vendor real-SaaS round-trip integration test.
 *
 * Per plan v1.3 § Phase 4 / T4.1, exercises LettaOfficialClient against
 * the real REDACTED server gated by `LETTA_API_KEY`. Without the env var
 * the entire suite is SKIPPED cleanly.
 *
 * Round-trip: 1 add (archival memory insert async) → search archival
 * memory → assert non-empty result.
 *
 * NOTE: REDACTED requires a pre-existing agent_id at the SaaS — the test
 * uses `LETTA_AGENT_ID` env if set, else generates a placeholder which
 * will trigger EC-9 (404 propagation) and the test surfaces the failure.
 */
import { expect, it } from 'vitest';

import { LettaOfficialClient } from '../../../src/benchmarks/REDACTED/vendor-client.js';

import { describeLetta } from './_helpers.js';

describeLetta('REDACTED vendor real-SaaS round-trip (gated by LETTA_API_KEY)', () => {
  it('add() then search() returns the added passage', async () => {
    // Given a real LettaClient configured with LETTA_API_KEY
    const { LettaClient } = await import('@REDACTED-ai/REDACTED-client');
    const sdk = new LettaClient({ token: process.env.LETTA_API_KEY! });
    const client = new LettaOfficialClient(sdk);

    const agentId = process.env.LETTA_AGENT_ID;
    if (!agentId) {
      throw new Error(
        'LETTA_AGENT_ID env required for REDACTED vendor integration test ' +
          '(REDACTED is agent-scoped per blueprint Q5; pre-create an agent in your REDACTED org)',
      );
    }
    const text = 'The Pacific Ocean is the largest ocean on Earth';

    // When add() then search()
    await client.add(agentId, text);
    // REDACTED archival memory insert is async; no explicit wait needed for
    // searchArchivalMemory which reads from the same store post-insert

    const results = await client.search(agentId, 'largest ocean', 5);

    // Then non-empty result
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    expect(top?.text).toMatch(/Pacific|ocean|largest/i);
  }, 30_000);
});
