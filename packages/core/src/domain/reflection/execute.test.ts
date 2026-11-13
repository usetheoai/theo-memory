/**
 * #112 — reflection at real-scope scale. A 441-memory scope built ONE consolidation
 * prompt; the LLM response truncated/overflowed → `ReflectionLLMResponseError:
 * response is not valid JSON` → dashboard 502 (the EC-18 followup materializing live).
 *
 * Contract under test: `executeReflection` BATCHES sourceMemories (count + serialized
 * chars, same discipline as the #109 import chunking), one LLM call per batch, drafts
 * concatenated. Plus fenced-JSON tolerance: models routinely wrap JSON in ```json fences.
 */
import { describe, expect, test } from 'vitest';

import type { LLM } from '../dip/llm.js';
import type { MemoryItem } from '../memory-item.js';
import type { UserScope } from '../scope.js';

import { REFLECTION_BATCH_MAX_ITEMS, executeReflection } from './execute.js';

const SCOPE: UserScope = { kind: 'user', userId: 'alice' };
const NOW = new Date('2026-01-01T00:00:00.000Z');

function item(i: number, text: string): MemoryItem {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    text,
    hash: `h${String(i)}`,
    scope: SCOPE,
    createdAt: NOW,
    updatedAt: NOW,
    metadata: {},
    tValid: NOW,
    tInvalid: null,
  };
}

function recordingLlm(responses: readonly string[] | ((call: number) => string)): {
  llm: LLM;
  prompts: string[];
} {
  const prompts: string[] = [];
  const llm: LLM = {
    generateResponse: () => Promise.resolve([]),
    generateChat: (msgs) => {
      const content = typeof responses === 'function'
        ? responses(prompts.length)
        : (responses[prompts.length] ?? '[]');
      prompts.push(String(msgs[0]?.content ?? ''));
      return Promise.resolve({ role: 'assistant' as const, content });
    },
  };
  return { llm, prompts };
}

describe('executeReflection — batching at real-scope scale (#112)', () => {
  test('a large scope is split into multiple LLM calls, drafts concatenated', async () => {
    const source = Array.from({ length: REFLECTION_BATCH_MAX_ITEMS * 2 + 10 }, (_, i) =>
      item(i, `memoria numero ${String(i)} com conteudo razoavel de prosa para consolidar`),
    );
    const { llm, prompts } = recordingLlm((call) =>
      JSON.stringify([{ text: `insight-${String(call)}`, derived_from: [source[call * 2]!.id] }]),
    );
    const drafts = await executeReflection({ scope: SCOPE, sourceMemories: source, llm });
    expect(prompts.length).toBeGreaterThan(1); // one giant prompt is the #112 failure mode
    expect(drafts.map((d) => d.text)).toEqual(prompts.map((_, c) => `insight-${String(c)}`));
  });

  test('very long memories force a byte-bounded split even under the item cap', async () => {
    // 30 items × ~8K chars ≈ 240K chars — far beyond a sane single prompt.
    const source = Array.from({ length: 30 }, (_, i) => item(i, 'prosa '.repeat(1400) + String(i)));
    const { llm, prompts } = recordingLlm(() => '[]');
    await executeReflection({ scope: SCOPE, sourceMemories: source, llm });
    expect(prompts.length).toBeGreaterThan(1);
    for (const p of prompts) expect(p.length).toBeLessThanOrEqual(60_000); // prompt char ceiling
  });

  test('markdown-fenced JSON responses are tolerated (```json ... ```)', async () => {
    const source = [item(1, 'fato um sobre o usuario'), item(2, 'fato dois sobre o usuario')];
    const { llm } = recordingLlm([
      '```json\n[{"text":"insight cercado","derived_from":["00000000-0000-4000-8000-000000000001"]}]\n```',
    ]);
    const drafts = await executeReflection({ scope: SCOPE, sourceMemories: source, llm });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.text).toBe('insight cercado');
  });

  test('normalizes a single derived_from source ID into a one-item array', async () => {
    const source = [item(1, 'User is planning a trip to Hawaii.')];
    const { llm } = recordingLlm([
      '[{"text":"User is planning a trip to Hawaii.","derived_from":"00000000-0000-4000-8000-000000000001"}]',
    ]);
    const drafts = await executeReflection({ scope: SCOPE, sourceMemories: source, llm });
    expect(drafts).toEqual([{
      text: 'User is planning a trip to Hawaii.',
      derivedFrom: ['00000000-0000-4000-8000-000000000001'],
    }]);
  });
});
