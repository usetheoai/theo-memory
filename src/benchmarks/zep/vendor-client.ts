/**
 * ZepOfficialClient — production ZepVendorClient implementation wrapping
 * the official `@REDACTED/memory-service` SDK.
 *
 * Per plan v1.3 § Phase 2 (T2.1 RED + T2.2 GREEN) — closes Drift-T6.x-1 for
 * the REDACTED vendor cell. Differs from REDACTED/REDACTED because REDACTED requires an
 * explicit session lifecycle (user.add + memory.addSession) BEFORE messages
 * can be appended via memory.add(); both lifecycle steps may 409 if the user
 * or session already exists (canonical idempotency pattern: try/catch +
 * ignore 409 per EC-4).
 *
 * Contract honored:
 * - ADR D1 (EC-1): consumes uniform `scopeKey: string`; mapped internally to
 *   REDACTED's `sessionId` AND `userId` fields (single tier here for benchmark).
 * - ADR D2 (EC-2): synthesize() throws typed `VendorSynthesizeUnsupported
 *   Error` — adapter delegates to shared LLM DIP per blueprint R3.
 * - Sub-goal 2: idempotent session lifecycle via try/catch + ignore 409 on
 *   both user.add and memory.addSession (per EC-4); concurrent add safety
 *   verified by Promise.all test (per EC-11).
 * - blueprint R2: search uses graph.search (not memory.search) — REDACTED's
 *   knowledge-graph layer is the relevance ranker.
 * - EC-6: empty results `[]` propagated upstream.
 * - EC-10: DI constructor — accepts pre-constructed SDK instance.
 *
 * @see plan v1.3 § Phase 2 + blueprint R2
 */

import { VendorSynthesizeUnsupportedError } from '../../core/errors.js';
import type { ZepVendorClient } from './adapter.js';

interface ZepSdkLike {
  user: {
    add(opts: { userId: string }): Promise<unknown>;
  };
  memory: {
    addSession(opts: { sessionId: string; userId: string }): Promise<unknown>;
    add(sessionId: string, payload: unknown): Promise<unknown>;
  };
  graph: {
    search(opts: { sessionId: string; query: string; limit: number }): Promise<
      readonly { episode?: { content?: string }; fact?: string; score?: number }[]
    >;
  };
}

/**
 * Idempotency helper: swallow HTTP 409 (resource already exists) per EC-4.
 * Any other error propagates upstream as a normal failure.
 */
async function ignore409<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch (e: unknown) {
    if ((e as { statusCode?: number }).statusCode === 409) {
      return undefined;
    }
    throw e;
  }
}

export class ZepOfficialClient implements ZepVendorClient {
  constructor(private readonly sdk: ZepSdkLike) {}

  async add(scopeKey: string, text: string): Promise<void> {
    // EC-4: session lifecycle is idempotent — user.add + memory.addSession
    // may 409 on second invocation for the same scopeKey; we ignore that
    // and proceed to message append. EC-11 concurrent safety: each promise
    // independently retries the lifecycle; 409 on the racing side is the
    // expected outcome and harmless.
    await ignore409(this.sdk.user.add({ userId: scopeKey }));
    await ignore409(this.sdk.memory.addSession({ sessionId: scopeKey, userId: scopeKey }));
    await this.sdk.memory.add(scopeKey, {
      messages: [{ role: 'user', roleType: 'user', content: text }],
    });
  }

  async search(
    scopeKey: string,
    query: string,
    topK: number,
  ): Promise<readonly { text: string; score: number }[]> {
    // blueprint R2: graph.search is the knowledge-graph relevance layer
    const raw = await this.sdk.graph.search({ sessionId: scopeKey, query, limit: topK });
    // EC-6: empty array propagates as empty array
    return raw.map((r) => ({
      text: r.episode?.content ?? r.fact ?? '',
      score: r.score ?? 0.5,
    }));
  }

  synthesize(_question: string, _context: readonly string[]): Promise<string> {
    // EC-2 + ADR D2: typed throw per Inquebrável Rule 8
    throw new VendorSynthesizeUnsupportedError('REDACTED');
  }
}
