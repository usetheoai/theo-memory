/**
 * T5.1 — LLM-measured extraction tier (ADR D4). Key-gated: runs a REAL
 * OpenRouter LLM over the hard golden cases and scores precision/recall against
 * ground truth. SKIPs honestly when no OpenRouter key is present — it never
 * fabricates a passing score. The deterministic LLM-free tier
 * (`run.ts` / `run.test.ts`) is unaffected by this tier.
 *
 * Cost: ~9 cheap chat calls (openai/gpt-4o-mini) per run, a few US cents.
 * Reproduce: OPENROUTER_KEY=... pnpm --filter @usetheo/memory-eval test.
 */
import { describe, expect, it } from 'vitest';

import type { Message } from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import { precision, recall } from '../../metrics/index.js';
import { hasLlmKey, openrouterKey } from '../../llm-key.js';
import { loadExtractionGolden } from './golden.js';

// Env-shift mirror (matches tests/integration/distillation/the-goal-test-llm-measured.test.ts):
// promote the OpenRouter key so the OpenAI SDK reaches openai/gpt-4o-mini.
const KEY = openrouterKey();
if (KEY !== '' && (process.env['OPENAI_API_KEY'] ?? '') === '') process.env['OPENAI_API_KEY'] = KEY;
if ((process.env['OPENAI_BASE_URL'] ?? '') === '') {
  process.env['OPENAI_BASE_URL'] = 'https://openrouter.ai/api/v1';
}
if ((process.env['OPENAI_CHAT_MODEL'] ?? '') === '') {
  process.env['OPENAI_CHAT_MODEL'] = 'openai/gpt-4o-mini';
}

function parseEntities(content: string): string[] {
  const match = content.match(/\[[\s\S]*\]/);
  if (match === null) return [];
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

describe.skipIf(!hasLlmKey())('LLM-measured extraction (openai/gpt-4o-mini via OpenRouter)', () => {
  it('meets precision >= 0.5 and recall >= 0.5 on the hard golden cases', async () => {
    const hard = loadExtractionGolden().filter((r) => r.kind === 'hard');
    const llm = new OpenAILLM();
    const precisions: number[] = [];
    const recalls: number[] = [];
    for (const row of hard) {
      const messages: Message[] = [
        {
          role: 'system',
          content:
            'Extract the named entities (people, organizations, places, products) from the ' +
            'user text. Reply with ONLY a JSON array of strings, no prose.',
        },
        { role: 'user', content: row.text },
      ];
      const res = await llm.generateChat(messages);
      const extracted = parseEntities(res.content);
      precisions.push(precision(extracted, row.expectedEntities, 0.5));
      recalls.push(recall(extracted, row.expectedEntities, 0.5));
    }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const p = mean(precisions);
    const r = mean(recalls);
     
    console.log(`[eval LLM-measured extraction] p=${p.toFixed(3)} r=${r.toFixed(3)} n=${String(hard.length)}`);
    expect(p).toBeGreaterThanOrEqual(0.5);
    expect(r).toBeGreaterThanOrEqual(0.5);
  }, 120_000);
});
