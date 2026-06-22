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
 * @see .claude/knowledge-base/plans/embedder-registry-plan.md § ADR D1 + D2 + D4 + T3.1
 * @see .claude/knowledge-base/references/REDACTED/REDACTED/utils/factory.py (EmbedderFactory shape)
 */
import type { Embedder } from '../../domain/dip/embedder.js';
import { EmbedderError, EmbedderUnavailableError } from '../../domain/errors.js';

/** Provider keys recognized by {@link createEmbedder}. */
export type EmbedderProvider = 'stub' | 'openai' | 'local' | 'ollama' | 'voyage' | 'google';

/** Declarative spec consumed by {@link createEmbedder}. */
export interface EmbedderSpec {
  readonly provider: EmbedderProvider;
  /** Model name (provider-specific; ignored by `stub`/`local`). */
  readonly model?: string;
  /** API key for the hosted providers (`openai`/`voyage`/`google`); env fallback per adapter. */
  readonly apiKey?: string;
  /** Base URL override (`ollama`/`google`). */
  readonly baseUrl?: string;
  /** Injectable `fetch` for the fetch-based adapters (`ollama`/`voyage`/`google`). */
  readonly fetchImpl?: typeof fetch;
}

function isModuleNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /cannot find (module|package)/i.test(message);
}

/**
 * Provider → lazy loader. Each entry dynamically imports its adapter module so
 * the registry's static graph stays free of SDK deps. The SDK-backed loaders
 * (`openai`/`local`) translate a module-not-found into an install-hint error.
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
