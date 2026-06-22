/**
 * CrossEncoderReranker — Reranker DIP backed by the @xenova/transformers
 * sequence-classification model running locally via ONNX Runtime Web (Wasm).
 *
 * A cross-encoder scores a `(query, document)` PAIR jointly (vs a bi-encoder
 * that embeds each separately then cosines), capturing relevance the cosine
 * misses. It runs as an OPT-IN post-threshold recall stage (plan ADR D2/D3),
 * re-sorting the threshold-passing pool by relevance then truncating to topK.
 *
 * Default model: `Xenova/ms-marco-MiniLM-L-6-v2` — the ONNX conversion of the
 * standard MS-MARCO cross-encoder (single relevance logit per pair → sigmoid).
 *
 * **No new dependency** (Inquebrável Rule 9): reuses `@xenova/transformers`,
 * already an optionalDependency backing `LocalTransformerEmbedder`. Confirmed
 * cross-encoder support: `AutoModelForSequenceClassification` + tokenizer
 * `text_pair` pair-encoding (blueprint § Coverage Corner 2).
 *
 * **optionalDependency consumer guidance:** this module requires
 * `@xenova/transformers`. Consumers on `npm install --no-optional` get a
 * TypeScript compile error if they import it. It is reached only via the
 * `@usetheo/memory/reranker-local` subpath (bundle-isolated — the default
 * barrel never statically imports this file).
 *
 * **Lazy singleton + retry-on-transient (mirrors `embedders/local.ts`):** the
 * `_bundlePromise` module-level var holds the Promise of `{ tokenizer, model }`.
 * Two concurrent first-callers share ONE load (sync null-check + sync
 * assignment is race-safe per JS single-thread invariant). On rejection the
 * slot resets so the next call retries from scratch (HF CDN hiccup at warmup)
 * — the F-M5 finding from the embedder applies identically.
 *
 * **First-use model download:** the first `rerank()` downloads the ONNX model
 * from the HF CDN and caches it under `~/.cache/transformers-js/`. Requires
 * internet at warmup; subsequent calls are offline. The pipeline wraps the
 * call (plan ADR D4) so a load/inference failure degrades to cosine order —
 * a reranker outage NEVER takes down recall.
 *
 * @see .claude/knowledge-base/plans/cross-encoder-reranker-plan.md § ADR D2 + § T3.1
 * @see packages/core/src/infrastructure/embedders/local.ts (lazy singleton + retry precedent)
 * @see .claude/knowledge-base/discoveries/blueprints/cross-encoder-reranker-blueprint.md § Coverage Corner 2
 */
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@xenova/transformers';

import type { Reranker } from '../../domain/dip/reranker.js';
import type { MemoryItemWithScore } from '../../domain/memory-item.js';

const DEFAULT_MODEL_ID = 'Xenova/ms-marco-MiniLM-L-6-v2';
const DEFAULT_BATCH_SIZE = 32;

interface ModelBundle {
  readonly tokenizer: PreTrainedTokenizer;
  readonly model: PreTrainedModel;
}

/** Map model id → its lazy bundle Promise (so different model ids do not collide). */
const _bundlePromises = new Map<string, Promise<ModelBundle>>();

function getBundle(modelId: string): Promise<ModelBundle> {
  const existing = _bundlePromises.get(modelId);
  if (existing !== undefined) {
    return existing;
  }
  const created = (async (): Promise<ModelBundle> => {
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(modelId),
      AutoModelForSequenceClassification.from_pretrained(modelId, { quantized: true }),
    ]);
    return { tokenizer, model };
  })();
  _bundlePromises.set(modelId, created);
  created.catch(() => {
    // Reset only if the slot still holds THIS rejected promise — so a retry
    // that already overwrote it with a fresh attempt is not clobbered.
    if (_bundlePromises.get(modelId) === created) {
      _bundlePromises.delete(modelId);
    }
  });
  return created;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Minimal typed views over the @xenova call contract (the library types the
 * tokenizer/model call results as `any`). These local types document the exact
 * shape this reranker depends on and keep the impl free of `any` per
 * architecture.md (no `any` in production code).
 */
type PairTokenizedInputs = Record<string, unknown>;
type TokenizePairs = (
  queries: readonly string[],
  opts: { readonly text_pair: readonly string[]; readonly padding: boolean; readonly truncation: boolean },
) => PairTokenizedInputs;
interface SequenceClassifierOutput {
  readonly logits: { readonly data: Float32Array };
}
type RunSequenceClassifier = (inputs: PairTokenizedInputs) => Promise<SequenceClassifierOutput>;

export interface CrossEncoderRerankerOptions {
  /** Cross-encoder model id. Default `Xenova/ms-marco-MiniLM-L-6-v2`. */
  readonly model?: string;
  /** Batch size for pair scoring. Default 32. */
  readonly batchSize?: number;
}

export class CrossEncoderReranker implements Reranker {
  private readonly modelId: string;
  private readonly batchSize: number;

  constructor(options: CrossEncoderRerankerOptions = {}) {
    this.modelId = options.model ?? DEFAULT_MODEL_ID;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async rerank(
    query: string,
    candidates: readonly MemoryItemWithScore[],
    topK: number,
  ): Promise<readonly MemoryItemWithScore[]> {
    if (candidates.length === 0) {
      return [];
    }
    const { tokenizer, model } = await getBundle(this.modelId);
    // The @xenova tokenizer/model instances are callable; their call results are
    // typed `any` upstream. Narrow via the local contract types (no `any`).
    const tokenize = tokenizer as unknown as TokenizePairs;
    const runModel = model as unknown as RunSequenceClassifier;

    // Score each candidate against the query in bounded batches.
    const scores = new Array<number>(candidates.length);
    for (let start = 0; start < candidates.length; start += this.batchSize) {
      const batch = candidates.slice(start, start + this.batchSize);
      const queries = batch.map(() => query);
      const docs = batch.map((c) => c.text);
      // Pair-encode (query, doc): the cross-encoder's text_pair input.
      const inputs = tokenize(queries, {
        text_pair: docs,
        padding: true,
        truncation: true,
      });
      const output = await runModel(inputs);
      // ms-marco cross-encoders emit a single relevance logit per pair.
      // logits.data is a Float32Array of length batch_size * num_labels;
      // num_labels === 1 for this model family → one score per pair.
      // F-arch-3 (review): runtime-guard the narrowed @xenova output shape. The
      // `as unknown as RunSequenceClassifier` cast is a compile-time promise; a
      // future @xenova upgrade that drifts the output shape must trip the ADR D4
      // fail-soft path (the pipeline's try/catch → recall_rerank_failed event)
      // rather than silently yield 0 scores (a quiet precision regression).
      const data = output?.logits?.data as Float32Array | undefined;
      if (data === undefined || typeof data.length !== 'number' || data.length < batch.length) {
        throw new TypeError(
          `CrossEncoderReranker: unexpected model output shape (expected logits.data length >= ${String(batch.length)}, got ${String(data?.length)})`,
        );
      }
      const numLabels = data.length / batch.length;
      for (let i = 0; i < batch.length; i++) {
        // Use the first (relevance) logit of each row, passed through sigmoid.
        const raw = data[i * numLabels] ?? 0;
        scores[start + i] = sigmoid(raw);
      }
    }

    // Re-sort by rerank score desc, overwrite the public `score`, truncate.
    // Does NOT mutate the input array or its items (new objects via spread).
    const ranked = candidates
      .map((c, i): MemoryItemWithScore => ({ ...c, score: scores[i] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return ranked;
  }
}
