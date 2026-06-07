/**
 * LettaOfficialClient — production LettaVendorClient implementation wrapping
 * the official `@letta-ai/letta-client` SDK.
 *
 * Per plan v1.3 § Phase 3 (T3.1 RED + T3.2 GREEN) — closes Drift-T6.x-1 for
 * the Letta vendor cell. Letta's memory is AGENT-scoped (not user-scoped)
 * per blueprint Q5 — scopeKey maps to agent_id via ADR D1.
 *
 * Contract honored:
 * - ADR D1 (EC-1): consumes uniform `scopeKey: string` — semantically the
 *   agent_id at the Letta layer.
 * - ADR D2 (EC-2): synthesize() throws typed `VendorSynthesizeUnsupported
 *   Error`.
 * - Sub-goal 3: uses client.agents.archivalMemory.{insertArchivalMemoryAsync,
 *   searchArchivalMemory} per blueprint Q5 method-name mapping.
 * - EC-5: passage score fallback — when SDK returns Passage without explicit
 *   score field (Letta archival ranking does not always carry numeric score),
 *   use rank-based decay 1.0 / (i + 1) so the result preserves ranking order.
 * - EC-9: 404 propagation — when agent not found, wrap the upstream error
 *   with a vendor-identifiable message so the caller can distinguish "vendor
 *   error" vs "scope-key invalid".
 * - EC-6: empty results `[]` propagated upstream.
 * - EC-10: DI constructor — accepts pre-constructed SDK instance.
 *
 * @see plan v1.3 § Phase 3 + blueprint Q5
 */

import { VendorSynthesizeUnsupportedError } from '../../core/errors.js';
import type { LettaVendorClient } from './adapter.js';

interface LettaSdkLike {
  agents: {
    archivalMemory: {
      insertArchivalMemoryAsync(agentId: string, payload: { text: string }): Promise<unknown>;
      searchArchivalMemory(
        agentId: string,
        opts: { query: string; limit: number },
      ): Promise<readonly { text?: string; score?: number }[]>;
    };
  };
}

export class LettaOfficialClient implements LettaVendorClient {
  constructor(private readonly sdk: LettaSdkLike) {}

  async add(scopeKey: string, text: string): Promise<void> {
    try {
      await this.sdk.agents.archivalMemory.insertArchivalMemoryAsync(scopeKey, { text });
    } catch (e: unknown) {
      // EC-9: wrap with vendor-identifiable message so caller can distinguish
      // a Letta API failure from a generic adapter-level error
      const orig = e instanceof Error ? e.message : String(e);
      throw new Error(`letta add failed for agent ${scopeKey}: ${orig}`);
    }
  }

  async search(
    scopeKey: string,
    query: string,
    topK: number,
  ): Promise<readonly { text: string; score: number }[]> {
    const raw = await this.sdk.agents.archivalMemory.searchArchivalMemory(scopeKey, {
      query,
      limit: topK,
    });
    // EC-5: rank-based fallback when Passage lacks score field
    // EC-6: empty array propagates as empty array
    return raw.map((p, i) => ({
      text: p.text ?? '',
      score: p.score ?? 1.0 / (i + 1),
    }));
  }

  synthesize(_question: string, _context: readonly string[]): Promise<string> {
    // EC-2 + ADR D2: typed throw per Inquebrável Rule 8
    throw new VendorSynthesizeUnsupportedError('letta');
  }
}
