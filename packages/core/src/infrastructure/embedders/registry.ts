/**
 * Embedder registry — `createEmbedder(spec)`: a string-keyed factory that
 * resolves an {@link Embedder} from a provider key via LAZY dynamic import.
 *
 * @remarks
 * Item 24 (embedder registry + more providers). The registry NEVER statically
 * imports an adapter module — every provider loads through `await import()`, so
 * the `@usetheo/memory/embedders/registry` subpath's static-import graph
 * excludes the heavy SDK deps (`openai`, `@xenova/transformers`). Importing the
 * registry costs nothing until you call `createEmbedder` for a provider that
 * needs an SDK.
 *
 * Error contract (ADR D2):
 * - unknown provider key → {@link EmbedderError} listing the valid keys (fail-loud).
 * - SDK-backed provider whose dependency is not installed → {@link EmbedderUnavailableError}
 *   with an install hint.
 *
 */
import type { Embedder } from '../../domain/dip/embedder.js';
import { EmbedderError, EmbedderUnavailableError } from '../../domain/errors.js';

/** Provider keys recognized by {@link createEmbedder}. */
export type EmbedderProvider = 'stub' | 'openai' | 'openai-compatible' | 'local' | 'ollama' | 'voyage' | 'google';

/** Declarative spec consumed by {@link createEmbedder}. */
export interface EmbedderSpec {
  readonly provider: EmbedderProvider;
  /** Model name (provider-specific; ignored by `stub`/`local`). */
  readonly model?: string;
  /** API key for the hosted providers (`openai`/`voyage`/`google`); env fallback per adapter. */
  readonly apiKey?: string;
  /** Base URL override (`ollama`/`google`). */
  readonly baseUrl?: string;
  /** Requested vector dimensions for providers that support them. */
  readonly dimensions?: number;
  /** Injectable `fetch` for the fetch-based adapters (`ollama`/`voyage`/`google`). */
  readonly fetchImpl?: typeof fetch;
}

function isModuleNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  // Primary, robust signal: the standard Node error code (ESM + CJS).
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return true;
  // Secondary fallback (permissive by design): some bundlers/loaders drop the
  // code and only carry the message. Narrow enough not to catch generic errors.
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /cannot find (module|package)/i.test(message);
}

/**
 * Provider → lazy loader. Each entry dynamically imports its adapter module so
 * the registry's static graph stays free of SDK deps. The SDK-backed loaders
 * (`openai`/`local`) translate a module-not-found into an install-hint error.
 *
 * Exported (read-only) so advanced consumers can ENUMERATE the available
 * provider keys (`Object.keys(EMBEDDER_REGISTRY)`); `createEmbedder` is the
 * intended construction entry point.
 */
export const EMBEDDER_REGISTRY: Readonly<
  Record<EmbedderProvider, (spec: EmbedderSpec) => Promise<Embedder>>
> = {
  stub: async () => {
    const { DeterministicStubEmbedder } = await import('./stub.js');
    return new DeterministicStubEmbedder();
  },
  openai: async () => {
    try {
      const { OpenAIEmbedder } = await import('./openai.js');
      return new OpenAIEmbedder();
    } catch (err) {
      if (isModuleNotFound(err)) {
        throw new EmbedderUnavailableError('openai', 'openai', {
          cause: err instanceof Error ? err : undefined,
        });
      }
      throw err;
    }
  },
  'openai-compatible': async (spec) => {
    try {
      const { OpenAICompatibleEmbedder } = await import('./openai-compatible.js');
      return new OpenAICompatibleEmbedder({
        ...(spec.model !== undefined ? { model: spec.model } : {}),
        ...(spec.apiKey !== undefined ? { apiKey: spec.apiKey } : {}),
        ...(spec.baseUrl !== undefined ? { baseUrl: spec.baseUrl } : {}),
        ...(spec.dimensions !== undefined ? { dimensions: spec.dimensions } : {}),
      });
    } catch (err) {
      if (isModuleNotFound(err)) {
        throw new EmbedderUnavailableError('openai-compatible', 'openai', {
          cause: err instanceof Error ? err : undefined,
        });
      }
      throw err;
    }
  },
  local: async () => {
    try {
      const { LocalTransformerEmbedder } = await import('./local.js');
      return new LocalTransformerEmbedder();
    } catch (err) {
      if (isModuleNotFound(err)) {
        throw new EmbedderUnavailableError('local', '@xenova/transformers', {
          cause: err instanceof Error ? err : undefined,
        });
      }
      throw err;
    }
  },
  ollama: async (spec) => {
    const { OllamaEmbedder } = await import('./ollama.js');
    // exactOptionalPropertyTypes: omit undefined keys rather than pass them through.
    return new OllamaEmbedder({
      ...(spec.model !== undefined ? { model: spec.model } : {}),
      ...(spec.baseUrl !== undefined ? { baseUrl: spec.baseUrl } : {}),
      ...(spec.fetchImpl !== undefined ? { fetchImpl: spec.fetchImpl } : {}),
    });
  },
  voyage: async (spec) => {
    const { VoyageEmbedder } = await import('./voyage.js');
    return new VoyageEmbedder({
      ...(spec.model !== undefined ? { model: spec.model } : {}),
      ...(spec.apiKey !== undefined ? { apiKey: spec.apiKey } : {}),
      ...(spec.fetchImpl !== undefined ? { fetchImpl: spec.fetchImpl } : {}),
    });
  },
  google: async (spec) => {
    const { GoogleEmbedder } = await import('./google.js');
    return new GoogleEmbedder({
      ...(spec.model !== undefined ? { model: spec.model } : {}),
      ...(spec.apiKey !== undefined ? { apiKey: spec.apiKey } : {}),
      ...(spec.baseUrl !== undefined ? { baseUrl: spec.baseUrl } : {}),
      ...(spec.fetchImpl !== undefined ? { fetchImpl: spec.fetchImpl } : {}),
    });
  },
};

/**
 * Resolve an {@link Embedder} from a provider spec. Lazy-loads the adapter on
 * demand.
 *
 * @throws {EmbedderError} when `spec.provider` is not a recognized key.
 * @throws {EmbedderUnavailableError} when an SDK-backed provider's dependency
 *   is not installed.
 */
export async function createEmbedder(spec: EmbedderSpec): Promise<Embedder> {
  const loader = EMBEDDER_REGISTRY[spec.provider] as
    | ((spec: EmbedderSpec) => Promise<Embedder>)
    | undefined;
  if (loader === undefined) {
    const valid = Object.keys(EMBEDDER_REGISTRY).join(', ');
    throw new EmbedderError(
      `Unknown embedder provider '${String(spec.provider)}'. Valid providers: ${valid}.`,
    );
  }
  return loader(spec);
}
