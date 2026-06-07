/**
 * Mem0OfficialClient — production Mem0VendorClient implementation wrapping
 * the official `vendor SDK` SDK (`MemoryClient`).
 *
 * Per plan v1.3 § Phase 1 (T1.1 RED + T1.2 GREEN) — closes Drift-T6.x-1's
 * "real SDK wiring deferred" gap for the REDACTED vendor cell so the v0.8
 * benchmark cell becomes executable against real REDACTED cloud API.
 *
 * Contract honored:
 * - ADR D1 (EC-1): consumes uniform `scopeKey: string` — maps internally
 *   to vendor SDK's `user_id` field per Sub-goal 1.
 * - ADR D2 (EC-2): synthesize() throws typed `VendorSynthesizeUnsupported
 *   Error` — caller delegates to shared LLM DIP.
 * - Sub-goal 1 (EC-3): reference TS port v3 response shape is `{ memory, score }` —
 *   adapter remaps to TheMemory's `{ text, score }` semantic. Verified
 *   against `.claude/knowledge-base/references/REDACTED/reference TS port/src/client/
 *   REDACTED.types.ts:89` + `tests/helpers.ts:67`.
 * - EC-6: empty results `[]` propagated upstream (NOT null/undefined).
 * - EC-10: DI constructor — accepts pre-constructed SDK instance (NOT
 *   api-key string). Mirrors `LocalTransformerEmbedder` DI precedent.
 *
 * @see plan v1.3 § Phase 1 + ADR D1 + ADR D2
 */

import { VendorSynthesizeUnsupportedError } from '../../core/errors.js';

import type { Mem0VendorClient } from './adapter.js';

/**
 * Minimal structural type capturing the `vendor SDK` `MemoryClient` surface
 * Mem0OfficialClient depends on. Matches reference TS port@3.0.6 contract verified
 * via `node_modules/vendor SDK` exports inspection. Defined here as an internal
 * structural seam to keep this module independent of any single vendor SDK
 * release-shape — assignment from a real `MemoryClient` works via TypeScript
 * structural typing without an explicit import (avoids pinning to vendor SDK's
 * exact type-export shape, which changed between v2 and v3).
 */
interface Mem0SdkLike {
  add(
    text: string,
    opts: { user_id: string; infer: boolean },
  ): Promise<unknown>;
  search(
    query: string,
    opts: { user_id: string; top_k: number },
  ): Promise<readonly { memory: string; score: number }[]>;
}

export class Mem0OfficialClient implements Mem0VendorClient {
  constructor(private readonly sdk: Mem0SdkLike) {}

  async add(scopeKey: string, text: string): Promise<void> {
    await this.sdk.add(text, { user_id: scopeKey, infer: true });
  }

  async search(
    scopeKey: string,
    query: string,
    topK: number,
  ): Promise<readonly { text: string; score: number }[]> {
    const raw = await this.sdk.search(query, { user_id: scopeKey, top_k: topK });
    // EC-3: reference TS port v3.0.6 response field is `memory` — remap to `text`.
    // EC-6: empty array propagates as empty array.
    return raw.map((r) => ({ text: r.memory, score: r.score }));
  }

  synthesize(question: string, context: readonly string[]): Promise<string> {
    // EC-2 + ADR D2: typed error so callers can branch on
    // `instanceof VendorSynthesizeUnsupportedError` without parsing
    // error.message strings (Inquebrável Rule 8). Adapter wraps this in
    // a fallback to the shared LLM DIP per blueprint R3.
    void question;
    void context;
    throw new VendorSynthesizeUnsupportedError('REDACTED');
  }
}
