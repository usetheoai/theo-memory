/**
 * knowledge-update-supersession (#144, M23) — shared KEYLESS test support.
 *
 * The two stub LLMs + the frozen-embedding embedder that let the fixture prove the
 * write/reflect-time supersession mechanism on the REAL strings with NO API key:
 *
 *  - `realFixtureEmbedder()` — maps each fixture text to its FROZEN real
 *    LocalTransformerEmbedder(384) vector (golden.ts); any other text (incl. the
 *    factory dimension probe) → a fixed distinct 384-vector.
 *  - `reflectNoopLlm` — the REFLECTION extraction LLM: `generateChat` returns an
 *    empty JSON array so `executeReflection` produces no drafts (clean
 *    'no-consolidation' return, never a JSON-parse throw). It does NOT decide the
 *    supersession — the conflict policy owns that via its OWN injected LLM.
 *  - `supersessionJudgeLlm` — the CONFLICT-policy judge: content-aware + deterministic,
 *    mirroring a correct real-LLM merge decision. It parses the merge prompt's
 *    `memoryId=… text: …` lines and keeps the fresh "25:50" while rejecting the stale
 *    "27:12"; for a same-entity/different-attribute cluster (no confident single
 *    keeper) it ABSTAINS (`kept_id=""`) — the ADD-only-safe default the real judge is
 *    instructed to use — so distinct facts about one entity survive (precision guard).
 */
import type { Embedder, LLM, LLMResponse, Message } from '@usetheo/memory';

import { REAL_EMBEDDING_BY_TEXT } from './golden.js';

const DIM = 384;
/** Fixed distinct 384-vector for any unmapped text (satisfies the factory dim probe). */
const PROBE_VECTOR: readonly number[] = Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0));

export function realFixtureEmbedder(): Embedder {
  const one = (text: string): readonly number[] => REAL_EMBEDDING_BY_TEXT.get(text) ?? PROBE_VECTOR;
  return {
    embed: (text) => Promise.resolve(one(text)),
    embedBatch: (texts) => Promise.resolve(texts.map(one)),
  };
}

export const reflectNoopLlm: LLM = {
  generateResponse: (): Promise<unknown> => Promise.resolve([]),
  generateChat: (): Promise<LLMResponse> => Promise.resolve({ role: 'assistant', content: '[]' }),
};

export const supersessionJudgeLlm: LLM = {
  generateResponse: (messages: readonly Message[]): Promise<unknown> => {
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const candidates = [...user.matchAll(/memoryId=(\S+)[\s\S]*?text:\s*([^\n]+)/g)].map((m) => ({
      id: m[1] ?? '',
      text: (m[2] ?? '').trim(),
    }));
    const fresh = candidates.find((c) => c.text.includes('25:50'));
    const stale = candidates.find((c) => c.text.includes('27:12'));
    if (fresh !== undefined && stale !== undefined) {
      return Promise.resolve({
        kept_id: fresh.id,
        rejected_ids: [stale.id],
        reason: 'newer PB 25:50 supersedes the stale 27:12 (same fact, different wording)',
      });
    }
    // Same-entity/different-attribute (or any non-contradiction) → abstain (ADD-only safe).
    return Promise.resolve({ kept_id: '', rejected_ids: [], reason: 'no confident single keeper' });
  },
  generateChat: (): Promise<LLMResponse> => Promise.resolve({ role: 'assistant', content: '' }),
};
