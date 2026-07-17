/**
 * Stub adapters for `Embedder` + `LLM` DIPs — T4.5 of plan v0-2-theokit-binding.
 *
 * @see ADR D8 — scaffolded apps need probe-safe defaults so `npm install && npm run dev`
 *   boots without crashing on the embedder dimension probe; consumer sees demo route
 *   work BEFORE wiring real OpenAI/Anthropic providers.
 * @see EC-2 — absorbed from edge-case review v0-2-theokit-binding-edge-cases-2026-05-23.md.
 *
 * Deterministic by design: probe returns correct-dim zero vector; LLM methods return
 * safe-empty responses. NOT for production — the warn-once diagnostic surfaces this
 * loudly on first real method invocation.
 *
 * NOTE on `console.warn`: architecture.md § 7 forbids `console.log` in production paths
 * and mandates a structured logger from src/core/. These stubs are an EXPLICIT exception
 * (ADR D8) — demo/fallback diagnostics, NOT a regular production logger replacement.
 * The eslint-disable comments are scoped per call site. Future v0.3+ may introduce a
 * Logger DIP that subsumes both; until then, stubs use console.warn directly.
 */
import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';
import type { LLMResponse, Message } from '../../domain/message.js';

const PROBE_TEXT_LITERAL = '__themem_probe__';

function zeroVector(): number[] {
  return new Array<number>(MAX_EMBEDDING_DIM).fill(0);
}

/**
 * Probe-aware stub `Embedder`. Returns `MAX_EMBEDDING_DIM` zeros for any input
 * (passing the dimension probe in `createLocalMemory`). Warns once on first
 * non-probe invocation to surface the "replace with your real provider" guidance.
 *
 * @experimental — for scaffold demo only, replace before production.
 */
export class StubEmbedder implements Embedder {
  private warned = false;

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    // eslint-disable-next-line no-console -- stub adapter diagnostic per ADR D8
    console.warn(
      '[StubEmbedder] Replace with your real Embedder (OpenAI/Cohere/etc.) before production use. ' +
        'Returning zero vectors will collapse all memories into a single retrieval bucket.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract requires Promise return; stub has no awaitable work
  async embed(text: string): Promise<readonly number[]> {
    if (text !== PROBE_TEXT_LITERAL) this.warnOnce();
    return zeroVector();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract requires Promise return; stub has no awaitable work
  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    this.warnOnce();
    return texts.map(() => zeroVector());
  }
}

/**
 * Stub `LLM` returning safe-empty responses. Warns once on first invocation of
 * either method (shared flag — single diagnostic per consumer instance).
 *
 * @experimental — for scaffold demo only, replace before production.
 */
export class StubLLM implements LLM {
  private warned = false;

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    // eslint-disable-next-line no-console -- stub adapter diagnostic per ADR D8
    console.warn(
      '[StubLLM] Replace with your real LLM (OpenAI/Anthropic/etc.) before production use. ' +
        'Returning empty responses disables fact extraction and chat completion.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract requires Promise return; stub has no awaitable work
  async generateResponse(
    _messages: readonly Message[],
    _responseFormat?: { readonly type: 'json' | 'text' },
    _tools?: readonly unknown[],
  ): Promise<unknown> {
    void _messages;
    void _responseFormat;
    void _tools;
    this.warnOnce();
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract requires Promise return; stub has no awaitable work
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    void _messages;
    this.warnOnce();
    return { role: 'assistant', content: '' };
  }
}
