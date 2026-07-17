/**
 * VoyageEmbedder — Embedder DIP over Voyage AI's HTTP embeddings endpoint
 * (`POST https://api.voyageai.com/v1/embeddings`, OpenAI-shaped response).
 * fetch-based: NO SDK dependency (Node-global `fetch`; Node 22). Bearer API key.
 * Part of the Item 24 embedder-registry adapter set.
 *
 * Default model `voyage-3`. API key from the ctor option OR `VOYAGE_API_KEY`.
 * The `fetchImpl` ctor option injects a stub `fetch` for testing.
 *
 */
import type { Embedder } from '../../domain/dip/embedder.js';
import { EmbedderError } from '../../domain/errors.js';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const DEFAULT_MODEL = 'voyage-3';

export interface VoyageEmbedderOptions {
  readonly model?: string;
  readonly apiKey?: string;
  /** Injectable `fetch` (defaults to the Node-global). For testing / custom agents. */
  readonly fetchImpl?: typeof fetch;
}

interface VoyageEmbedResponse {
  readonly data?: readonly { readonly embedding?: readonly number[] }[];
}

export class VoyageEmbedder implements Embedder {
  private readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VoyageEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    const apiKey = options.apiKey ?? process.env['VOYAGE_API_KEY'];
    // Fail-fast (Inquebrável Rule 8): surface a missing credential at construction
    // with a clear message instead of deferring to an opaque HTTP 401 at embed-time.
    if (apiKey === undefined || apiKey.trim() === '') {
      throw new EmbedderError(
        "Voyage embedder requires an API key. Pass it via the 'apiKey' option or the VOYAGE_API_KEY env var.",
      );
    }
    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(text: string): Promise<readonly number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec ?? [];
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    let res: Response;
    try {
      res = await this.fetchImpl(VOYAGE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
    } catch (err) {
      throw new EmbedderError(`Voyage embed request failed: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
    if (!res.ok) {
      throw new EmbedderError(`Voyage embed returned HTTP ${String(res.status)}`);
    }
    const body = (await res.json()) as VoyageEmbedResponse;
    const data = body.data;
    if (data === undefined || data.length !== texts.length) {
      throw new EmbedderError(
        `Voyage embed returned a malformed response (expected ${String(texts.length)} embeddings, got ${String(data?.length)})`,
      );
    }
    return data.map((d) => {
      if (d.embedding === undefined) {
        throw new EmbedderError('Voyage embed returned a row without an `embedding`');
      }
      return [...d.embedding];
    });
  }
}
