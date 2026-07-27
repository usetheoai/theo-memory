/**
 * M29 T1.2/T1.3 (#160) — the pipeline threads the turn's `attributedTo` into the
 * extraction prompt so the assistant's own statements carry the assistant-speaker
 * directive end-to-end (the kit's Stop hook sets attributedTo:'assistant').
 *
 * Asserts on the SYSTEM PROMPT actually handed to the LLM (captured via the stub),
 * which is the observable wiring between options.attributedTo and prompt.ts. The
 * default/user path must NOT carry the directive (no regression for user turns).
 */
import { describe, expect, test, vi } from 'vitest';

import { InMemoryVectorStore } from '../infrastructure/db/in-memory-store.js';
import { MAX_EMBEDDING_DIM } from './constants.js';
import type { Embedder } from './dip/embedder.js';
import type { LLM } from './dip/llm.js';
import { runExtractionPipeline } from './extraction/pipeline.js';
import type { RememberOptions } from './options.js';

const vec = (): readonly number[] => {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  v[0] = 0.1;
  return v;
};
const embedder = (): Embedder => ({
  embed: vi.fn(async () => vec()),
  embedBatch: vi.fn(async (t: readonly string[]) => t.map(() => vec())),
});

/** Capture the system prompt the pipeline hands to the LLM for one assistant turn. */
async function capturedSystemPrompt(options?: RememberOptions): Promise<string> {
  let captured = '';
  const llm: LLM = {
    generateResponse: vi.fn(async (...args: unknown[]) => {
      captured = JSON.stringify(args);
      return { memory: [{ id: '0', text: 'assistant recommended an allowlist' }] };
    }),
    generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
  };
  await runExtractionPipeline(
    [{ role: 'assistant', content: 'I recommend an allowlist.' }],
    { user_id: 'alice' },
    { vectorStore: new InMemoryVectorStore(), embedder: embedder(), llm },
    options,
  );
  return captured.toLowerCase();
}

describe('pipeline speaker attribution wiring (M29 / #160)', () => {
  test('attributedTo="assistant" injects the assistant-speaker directive into the LLM system prompt', async () => {
    const p = await capturedSystemPrompt({ attributedTo: 'assistant' });
    expect(p).toContain('the author of the new messages is the assistant');
    expect(p).toContain('assistant recommended');
  });

  test('user-attributed turn does NOT inject the assistant directive (regression guard)', async () => {
    const p = await capturedSystemPrompt({ attributedTo: 'alice' });
    expect(p).not.toContain('the author of the new messages is the assistant');
  });

  test('no options (undefined attribution) keeps the default user speaker', async () => {
    const p = await capturedSystemPrompt(undefined);
    expect(p).not.toContain('the author of the new messages is the assistant');
  });
});
