/**
 * OpenAIEmbedder — Embedder DIP backed by OpenAI's official TypeScript SDK.
 *
 * Lifted verbatim from `examples/chat-with-memory/lib/openai-adapters.ts`
 * (lines 1-47) per ADR D3 (MOVE-only Cycle 2 scope). Zero behavioral change
 * from the demo file: same model (`text-embedding-3-small`, 1536 dims
 * model-implicit), same lazy-singleton client, same empty-batch guard.
 *
 * **EC-6 — optionalDependencies consumer guidance:** this module requires the
 * `openai` SDK as an `optionalDependency`. Consumers who run
 * `npm install --no-optional` to skip the openai package will get a
 * TypeScript compile error if they import this file. Use
 * `@usetheo/memory/embedders/stub` instead for offline / deterministic dev.
 *
 * **EC-8 — lazy singleton scope:** the `_openai` module-level var below is a
 * lazy singleton: ONE OpenAI client instance per module per process (two
 * total: one in `embedders/openai.ts`, one in `llms/openai.ts`). Acceptable
 * trade-off vs ADR D3 MOVE-only — sharing across modules would require a
 * new shared file not present in the demo, which is scope creep.
 *
 * **EC-9 — env timing:** `process.env.OPENAI_API_KEY` MUST be set BEFORE
 * the first `.embed()` call. If using dotenv, ensure `import 'dotenv/config'`
 * runs before any import of this module — the singleton captures the env at
 * first `.embed()` invocation, not at module-load time. Late-set env will
 * yield `apiKey: undefined` and the OpenAI client will throw 401 on first
 * call.
 *
 * @todo Cycle 2.X — accept model name via constructor param (today hard-coded
 *   to `text-embedding-3-small` per MOVE-only ADR D3). Constructor-level
 *   multi-account support also deferred.
 *
 */
import OpenAI from 'openai';

import type { Embedder } from '../../domain/dip/embedder.js';

// Lazy singleton — instantiated on first call so build-time page-data
// collection (which runs without runtime env) does not throw.
let _openai: OpenAI | null = null;
function client(): OpenAI {
  if (_openai === null) {
    _openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
  }
  return _openai;
}

const EMBED_MODEL = 'text-embedding-3-small';

export class OpenAIEmbedder implements Embedder {
  async embed(text: string): Promise<readonly number[]> {
    const resp = await client().embeddings.create({
      model: EMBED_MODEL,
      input: text,
    });
    return resp.data[0]!.embedding;
  }

  async embedBatch(
    texts: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const resp = await client().embeddings.create({
      model: EMBED_MODEL,
      input: texts as string[],
    });
    return resp.data.map((d) => d.embedding);
  }
}
