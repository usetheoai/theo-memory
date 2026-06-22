/**
 * GoogleEmbedder — Embedder DIP over Google's Generative Language embeddings
 * REST endpoint (`POST …/v1beta/models/{model}:batchEmbedContents?key=`).
 * fetch-based: NO SDK dependency (Node-global `fetch`; Node 22). API key query
 * param. Part of the Item 24 embedder-registry adapter set.
 *
 * Default model `text-embedding-004`. API key from the ctor option OR
 * `GOOGLE_API_KEY` / `GEMINI_API_KEY`. The `fetchImpl` ctor option injects a
 * stub `fetch` for testing.
 *
 * Uses `:batchEmbedContents` (one HTTP call for the whole batch); the response
 * `embeddings[].values` preserves request order.
 *
 * @see .claude/knowledge-base/plans/embedder-registry-plan.md § ADR D3 + § T2.3
 * @see .claude/knowledge-base/references/mem0/mem0/embeddings/gemini.py (reference shape)
 */
import type { Embedder } from '../../domain/dip/embedder.js';
import { EmbedderError } from '../../domain/errors.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'text-embedding-004';

export interface GoogleEmbedderOptions {
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  /** Injectable `fetch` (defaults to the Node-global). For testing / custom agents. */
  readonly fetchImpl?: typeof fetch;
}

interface GoogleEmbedResponse {
  readonly embeddings?: readonly { readonly values?: readonly number[] }[];
}

export class GoogleEmbedder implements Embedder {
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.apiKey = options.apiKey ?? process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY'];
    this.baseUrl = (options.baseUrl ?? BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(text: string): Promise<readonly number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec ?? [];
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const modelPath = this.model.startsWith('models/') ? this.model : `models/${this.model}`;
    const url = `${this.baseUrl}/${modelPath}:batchEmbedContents?key=${this.apiKey ?? ''}`;
    const requests = texts.map((t) => ({
      model: modelPath,
      content: { parts: [{ text: t }] },
    }));
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
    } catch (err) {
      throw new EmbedderError(`Google embed request failed: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
    if (!res.ok) {
      throw new EmbedderError(`Google embed returned HTTP ${String(res.status)}`);
    }
    const body = (await res.json()) as GoogleEmbedResponse;
    const embeddings = body.embeddings;
    if (embeddings === undefined || embeddings.length !== texts.length) {
      throw new EmbedderError(
        `Google embed returned a malformed response (expected ${String(texts.length)} embeddings, got ${String(embeddings?.length)})`,
      );
    }
    return embeddings.map((e) => {
      if (e.values === undefined) {
        throw new EmbedderError('Google embed returned a row without `values`');
      }
      return [...e.values];
    });
  }
}
