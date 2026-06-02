/**
 * LocalTransformerEmbedder — Embedder DIP backed by the @xenova/transformers
 * feature-extraction pipeline running locally via ONNX Runtime Web (Wasm).
 *
 * Adopted at adapters-openrouter-local-embedder T1.1 + ADR D1 to unblock the
 * `examples/chat-with-memory/` demo for OpenRouter-only API keys (OpenRouter
 * routes chat completions but NOT embeddings; OpenAIEmbedder against OpenRouter
 * returns 429). This adapter keeps embeddings local (offline after warmup).
 *
 * Default model: `Xenova/all-MiniLM-L6-v2` (384-dim). Output is L2-normalized
 * via the pipeline's `normalize: true` option so cosine distance is
 * well-defined (matches `DeterministicStubEmbedder` invariant).
 *
 * **EC-6 — optionalDependencies consumer guidance:** this module requires the
 * `@xenova/transformers` package as an `optionalDependency`. Consumers who run
 * `npm install --no-optional` will get a TypeScript compile error if they
 * import this file. Use `@usetheo/memory/embedders/stub` for offline /
 * deterministic dev that does not need a real model.
 *
 * **EC-8 — lazy singleton scope:** the `_pipelinePromise` module-level var
 * below is a lazy singleton holding the *Promise* of the pipeline (Xenova's
 * `pipeline()` is async). Two concurrent first-callers both observe the
 * non-null Promise after the synchronous assignment (race-safe per JS
 * single-thread invariant — see SEPA iter-4 pre-RED M1).
 *
 * **F-M5 review finding — retry on transient failure:** if the first `pipeline()`
 * call rejects (e.g., HF CDN hiccup at warmup), the rejected Promise was
 * previously cached forever; every subsequent `embed()` returned the same
 * rejection until process restart. The lazy getter below now resets
 * `_pipelinePromise = null` on rejection so the next call retries from
 * scratch. The OpenAIEmbedder precedent at `src/embedders/openai.ts:42-47`
 * uses a sync constructor (cannot reject) and is qualitatively different —
 * the rejected-cache failure mode does not apply there.
 *
 * **EC-A — first-use model download:** the first `embed()` call downloads
 * the ONNX model (~22 MB for `Xenova/all-MiniLM-L6-v2`) from
 * `huggingface.co/Xenova/all-MiniLM-L6-v2` and caches it under
 * `~/.cache/transformers-js/` (or the equivalent on the runtime). Requires
 * internet at warmup; subsequent calls are offline. CI environments must
 * either warm the cache OR accept the one-time network cost on first run.
 *
 * **Allowlist note (T1.1 deps-audit re-gate):** `@xenova/transformers`
 * transitively pulls `protobufjs <= 7.5.7` which has 1 CRITICAL + 4 HIGH
 * advisories — allowlisted with aggressive sunset (CRITICAL 2026-07-01,
 * HIGHs 2026-08-01) per `.claude/rules/deps-audit-allowlist.txt` because
 * the parser is invoked only at model-warmup time on a one-shot signed
 * download from the HF CDN; runtime inference does NOT route user input
 * through it. Re-audit at sunset; track upstream Xenova v3 line.
 *
 * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T1.1 + ADR D1
 * @see .claude/knowledge-base/implementations/adapters-openrouter-local-embedder/sepa-iterations/iteration-4-pre-red.md (lazy Promise singleton + L2 + batch slicing)
 * @see src/embedders/openai.ts (lazy singleton precedent)
 * @see src/embedders/stub.ts (L2-normalization invariant precedent)
 */
import type { FeatureExtractionPipeline } from '@xenova/transformers';
import { pipeline } from '@xenova/transformers';

import type { Embedder } from '../core/dip/embedder.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

// Lazy singleton — instantiated on first call. Stores the Promise so two
// concurrent first-callers share ONE pipeline instance (sync null check +
// sync assignment is race-safe per JS single-thread invariant).
// /review F-M5: on rejection, reset `_pipelinePromise = null` so the next
// call retries from scratch instead of returning the cached failure forever.
let _pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (_pipelinePromise === null) {
    const created = pipeline('feature-extraction', MODEL_ID);
    _pipelinePromise = created;
    created.catch(() => {
      // If this assignment loses the race against another caller that already
      // overwrote `_pipelinePromise` with a fresh (succeeding) attempt, the
      // reset is a no-op — we only null out the slot if it still holds the
      // rejected promise instance from THIS call.
      if (_pipelinePromise === created) {
        _pipelinePromise = null;
      }
    });
  }
  return _pipelinePromise;
}

export class LocalTransformerEmbedder implements Embedder {
  async embed(text: string): Promise<readonly number[]> {
    const pipe = await getPipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(
    texts: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const pipe = await getPipeline();
    const output = await pipe(texts as string[], { pooling: 'mean', normalize: true });
    // Xenova returns a Tensor with .data: Float32Array of length
    // batch_size * EMBEDDING_DIM and .dims: [batch_size, EMBEDDING_DIM].
    // Slice per row to preserve input order (DIP contract).
    const flat = output.data as Float32Array;
    const rows: number[][] = [];
    for (let i = 0; i < texts.length; i += 1) {
      const start = i * EMBEDDING_DIM;
      const end = start + EMBEDDING_DIM;
      rows.push(Array.from(flat.slice(start, end)));
    }
    return rows;
  }
}
