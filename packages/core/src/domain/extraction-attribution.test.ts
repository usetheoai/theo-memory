/**
 * Attribution authority in the extraction (infer:true) write path.
 *
 * The Claude Code kit exposed a real bug: the Stop hook sends
 * `RememberOptions.attributedTo:'assistant'` (the ORIGIN — who produced the turn),
 * but the extraction path ignored it and let the LLM's content-inferred per-fact
 * `attributed_to` guess win. An assistant session-summary was therefore stored as a
 * `user` fact — exactly what the extraction discipline forbids ("what Claude produces is the
 * assistant's; its suggestions never become the user's stated preferences").
 *
 * Contract: request-level `attributedTo` is AUTHORITATIVE when present; the LLM
 * per-fact `attributed_to` is the FALLBACK for attribution-agnostic multi-peer
 * ingestion. This mirrors the infer:false path (both write paths now agree).
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
const llmEmitting = (memory: unknown): LLM => ({
  generateResponse: vi.fn(async () => ({ memory })),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

/** Run one assistant-turn extraction and return the single persisted item's attribution. */
async function extractedAttribution(
  fact: { text: string; attributed_to?: string },
  options?: RememberOptions,
): Promise<string | undefined> {
  const result = await runExtractionPipeline(
    [{ role: 'assistant', content: 'turn content' }],
    { user_id: 'alice' },
    { vectorStore: new InMemoryVectorStore(), embedder: embedder(), llm: llmEmitting([{ id: '0', ...fact }]) },
    options,
  );
  expect(result).toHaveLength(1);
  return result[0]?.attributedTo;
}

/** Extract N facts (each with its own LLM per-fact guess) and return ALL persisted attributions. */
async function extractedAttributions(
  facts: readonly { text: string; attributed_to?: string }[],
  options?: RememberOptions,
): Promise<(string | undefined)[]> {
  const memory = facts.map((f, i) => ({ id: String(i), ...f }));
  const result = await runExtractionPipeline(
    [{ role: 'assistant', content: 'turn content' }],
    { user_id: 'alice' },
    { vectorStore: new InMemoryVectorStore(), embedder: embedder(), llm: llmEmitting(memory) },
    options,
  );
  return result.map((r) => r.attributedTo);
}

describe('extraction attribution authority (claude-code-kit fix)', () => {
  test('request-level attributedTo overrides the LLM per-fact guess — assistant turn is never stored as a user fact', async () => {
    // LLM guesses the fact belongs to 'user'; the hook declared the turn assistant-produced.
    const attr = await extractedAttribution(
      { text: 'Migrated auth to JWT tokens', attributed_to: 'user' },
      { attributedTo: 'assistant' },
    );
    expect(attr).toBe('assistant'); // origin wins — NOT 'user'
  });

  test('LLM per-fact attributed_to still applies as fallback when the caller is attribution-agnostic (multi-peer v1.1 preserved)', async () => {
    const attr = await extractedAttribution({ text: 'Bob prefers tea', attributed_to: 'bob' });
    expect(attr).toBe('bob'); // no request-level attribution → LLM guess is honored
  });

  test('no attribution anywhere leaves the fact unattributed (no fabricated owner)', async () => {
    const attr = await extractedAttribution({ text: 'water boils at 100C' });
    expect(attr).toBeUndefined();
  });

  test('LOOP-WIDE: request-level attributedTo overrides EVERY extracted fact, not just the first (kills an extracted[0]-only fix)', async () => {
    // Three facts with DISTINCT LLM guesses; the declared origin must win for ALL.
    const attrs = await extractedAttributions(
      [
        { text: 'user prefers dark roast', attributed_to: 'user' },
        { text: 'deployed to eu-west-2', attributed_to: 'bob' },
        { text: 'ran the migration' }, // no LLM guess
      ],
      { attributedTo: 'assistant' },
    );
    expect(attrs).toHaveLength(3);
    expect(attrs.every((a) => a === 'assistant')).toBe(true); // every fact, not just [0]
  });

  test('SYMMETRIC: request attributedTo also wins when the LLM guesses ASSISTANT and the caller declared USER (contract is symmetric, not assistant-only)', async () => {
    // Guards against a naive `=== "assistant" ? "assistant" : llmGuess` special-case.
    const attr = await extractedAttribution(
      { text: 'The user set up JWT auth', attributed_to: 'assistant' },
      { attributedTo: 'user' },
    );
    expect(attr).toBe('user'); // origin (user) wins over the LLM's 'assistant' guess
  });

  test('BLANK attributedTo is treated as absent — falls through to the LLM guess, never persists an empty-string owner', async () => {
    // `attributedTo:''` is a caller mistake (peerId || ''); it must NOT win over the
    // LLM per-fact guess nor persist '' as a first-class owner (REST also rejects it).
    const attr = await extractedAttribution(
      { text: 'Bob prefers tea', attributed_to: 'bob' },
      { attributedTo: '' },
    );
    expect(attr).toBe('bob'); // blank ignored → LLM guess honored (pre-fix behavior for '')
  });
});
