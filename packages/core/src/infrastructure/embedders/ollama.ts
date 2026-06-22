/**
 * OllamaEmbedder — Embedder DIP over a local Ollama server's HTTP embeddings
 * endpoint (`POST {baseUrl}/api/embed`). fetch-based: NO SDK dependency (uses
 * the Node-global `fetch`; Node 22). No API key (local). Part of the Item 24
 * embedder-registry adapter set.
 *
 * Default base URL `http://localhost:11434`, default model `nomic-embed-text`.
 * The `fetchImpl` ctor option injects a stub `fetch` for testing (air-gapped CI).
 *
 * @see .claude/knowledge-base/plans/embedder-registry-plan.md § ADR D3 + § T2.1
 * @see .claude/knowledge-base/references/REDACTED/REDACTED/embeddings/ollama.py (reference shape)
 */
import type { Embedder } from '../../domain/dip/embedder.js';
import { EmbedderError } from '../../domain/errors.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'nomic-embed-text';

export interface OllamaEmbedderOptions {
  readonly model?: string;
  readonly baseUrl?: string;
  /** Injectable `fetch` (defaults to the Node-global). For testing / custom agents. */
  readonly fetchImpl?: typeof fetch;
}

interface OllamaEmbedResponse {
  readonly embeddings?: readonly (readonly number[])[];
}

export class OllamaEmbedder implements Embedder {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
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
      res = await this.fetchImpl(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
    } catch (err) {
      throw new EmbedderError(`Ollama embed request failed: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
    if (!res.ok) {
      throw new EmbedderError(`Ollama embed returned HTTP ${String(res.status)}`);
    }
    const body = (await res.json()) as OllamaEmbedResponse;
    const embeddings = body.embeddings;
    if (embeddings === undefined || embeddings.length !== texts.length) {
      throw new EmbedderError(
        `Ollama embed returned a malformed response (expected ${String(texts.length)} embeddings, got ${String(embeddings?.length)})`,
      );
    }
    return embeddings.map((e) => [...e]);
  }
}
