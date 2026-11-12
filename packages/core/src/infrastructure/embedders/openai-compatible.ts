/**
 * OpenAI-compatible hosted embeddings adapter.
 *
 * Supports Model Studio's `text-embedding-v4` and other hosted providers that
 * implement the OpenAI embeddings endpoint. Defaults target Alibaba Model
 * Studio's Singapore endpoint; all provider settings are overridable.
 */
import OpenAI from 'openai';

import type { Embedder } from '../../domain/dip/embedder.js';
import { EmbedderError } from '../../domain/errors.js';

const DEFAULT_MODEL = 'text-embedding-v4';
const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const DEFAULT_DIMENSIONS = 1024;
const MAX_INPUT_CHARS = 16_000;
/** Model Studio text-embedding-v4 synchronous API accepts at most 10 inputs per call. */
const MAX_BATCH_SIZE = 10;

export interface OpenAICompatibleEmbedderOptions {
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly dimensions?: number;
  /** Dependency injection for contract tests and custom OpenAI-compatible clients. */
  readonly client?: Pick<OpenAI, 'embeddings'>;
}

function positiveDimension(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  // The pgvector HNSW index used by this project supports at most 2,000 dims.
  if (!Number.isInteger(value) || value < 1 || value > 2000) {
    throw new EmbedderError('Embedding dimensions must be an integer in 1..2000 for pgvector HNSW');
  }
  return value;
}

export class OpenAICompatibleEmbedder implements Embedder {
  private readonly client: Pick<OpenAI, 'embeddings'>;
  private readonly model: string;
  private readonly dimensions: number | undefined;

  constructor(options: OpenAICompatibleEmbedderOptions = {}) {
    const apiKey = options.apiKey
      ?? process.env['THEOMEM_EMBEDDING_API_KEY']
      ?? process.env['ALIBABA_API_KEY']
      ?? process.env['DASHSCOPE_API_KEY'];
    if (apiKey === undefined || apiKey.trim() === '') {
      throw new EmbedderError(
        'OpenAI-compatible embeddings require THEOMEM_EMBEDDING_API_KEY (or ALIBABA_API_KEY / DASHSCOPE_API_KEY).',
      );
    }
    this.model = options.model ?? process.env['THEOMEM_EMBEDDING_MODEL'] ?? DEFAULT_MODEL;
    if (this.model.trim() === '') throw new EmbedderError('Embedding model must be non-empty');
    const baseUrl = (options.baseUrl ?? process.env['THEOMEM_EMBEDDING_BASE_URL'] ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    if (!/^https:\/\//i.test(baseUrl)) throw new EmbedderError('Embedding base URL must use HTTPS');

    const configuredDimension = options.dimensions
      ?? (process.env['THEOMEM_EMBEDDING_DIM'] === undefined ? DEFAULT_DIMENSIONS : Number(process.env['THEOMEM_EMBEDDING_DIM']));
    this.dimensions = positiveDimension(configuredDimension);
    this.client = options.client ?? new OpenAI({ apiKey, baseURL: baseUrl });
  }

  async embed(text: string): Promise<readonly number[]> {
    const [embedding] = await this.embedBatch([text]);
    return embedding ?? [];
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const output: number[][] = [];
    for (let start = 0; start < texts.length; start += MAX_BATCH_SIZE) {
      const batch = texts.slice(start, start + MAX_BATCH_SIZE);
      if (batch.some((text) => text.length > MAX_INPUT_CHARS)) {
        throw new EmbedderError(`Embedding input exceeds the ${String(MAX_INPUT_CHARS)} character limit; split it before embedding`);
      }
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: batch,
          ...(this.dimensions === undefined ? {} : { dimensions: this.dimensions }),
        });
        const data = [...response.data].sort((a, b) => a.index - b.index);
        if (data.length !== batch.length) {
          throw new EmbedderError(`Embedding provider returned ${String(data.length)} vectors for ${String(batch.length)} inputs`);
        }
        const vectors = data.map((row) => row.embedding);
        if (this.dimensions !== undefined && vectors.some((vector) => vector.length !== this.dimensions)) {
          throw new EmbedderError(`Embedding provider returned a vector with unexpected dimensions (expected ${String(this.dimensions)})`);
        }
        if (vectors.some((vector) => vector.some((value) => !Number.isFinite(value)))) {
          throw new EmbedderError('Embedding provider returned a vector containing a non-finite value');
        }
        output.push(...vectors);
      } catch (error) {
        if (error instanceof EmbedderError) throw error;
        throw new EmbedderError(
          `OpenAI-compatible embed request failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error instanceof Error ? error : undefined },
        );
      }
    }
    return output;
  }
}

