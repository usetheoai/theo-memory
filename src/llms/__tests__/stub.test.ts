/**
 * Contract tests for DeterministicStubLLM.
 *
 * Locked at SEPA pre-RED brief: extraction JSON shape uses
 * `AdditiveExtractionSchema` from src/core/extraction/prompt.ts:89 —
 * `{ memory: [{ id, text, attributed_to?, linked_memory_ids? }] }`.
 *
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T1.2
 */
import { describe, it, expect } from 'vitest';
import { DeterministicStubLLM } from '../stub.js';
import { AdditiveExtractionSchema } from '../../core/extraction/prompt.js';
import type { Message } from '../../core/message.js';

const userMsg = (content: string): Message => ({ role: 'user', content });
const sysMsg = (content: string): Message => ({ role: 'system', content });

describe('DeterministicStubLLM.generateChat', () => {
  it('returns same response for repeated calls with same messages', async () => {
    const llm = new DeterministicStubLLM();
    const msgs: Message[] = [userMsg('Hi I am Paulo.')];

    const r1 = await llm.generateChat(msgs);
    const r2 = await llm.generateChat(msgs);

    expect(r1).toEqual(r2);
  });

  it('returns distinct response for distinct messages', async () => {
    const llm = new DeterministicStubLLM();
    const r1 = await llm.generateChat([userMsg('first prompt')]);
    const r2 = await llm.generateChat([userMsg('second prompt')]);
    expect(r1.content).not.toEqual(r2.content);
  });

  it('returns LLMResponse with role=assistant', async () => {
    const llm = new DeterministicStubLLM();
    const r = await llm.generateChat([userMsg('hello')]);
    expect(r.role).toBe('assistant');
    expect(typeof r.content).toBe('string');
  });

  it('returns valid LLMResponse for empty messages array', async () => {
    const llm = new DeterministicStubLLM();
    const r = await llm.generateChat([]);
    expect(r.role).toBe('assistant');
    expect(typeof r.content).toBe('string');
  });
});

describe('DeterministicStubLLM.generateResponse (json type)', () => {
  it('returns JSON conforming to AdditiveExtractionSchema', async () => {
    const llm = new DeterministicStubLLM();
    const msgs: Message[] = [
      sysMsg('You extract facts.'),
      userMsg('I am Paulo. I work at TheoCloud. My favorite language is TypeScript.'),
    ];

    const json = await llm.generateResponse(msgs, { type: 'json' });

    const parsed = AdditiveExtractionSchema.safeParse(json);
    expect(parsed.success).toBe(true);
  });

  it('returns up to 3 memory entries with 1-indexed string ids', async () => {
    const llm = new DeterministicStubLLM();
    const msgs: Message[] = [
      userMsg('Sentence one. Sentence two. Sentence three. Sentence four.'),
    ];

    const json = (await llm.generateResponse(msgs, { type: 'json' })) as {
      memory: { id: string; text: string }[];
    };

    expect(json.memory).toHaveLength(3);
    expect(json.memory.map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('returns same JSON for repeated calls with same messages', async () => {
    const llm = new DeterministicStubLLM();
    const msgs: Message[] = [userMsg('Deterministic test input.')];

    const j1 = await llm.generateResponse(msgs, { type: 'json' });
    const j2 = await llm.generateResponse(msgs, { type: 'json' });

    expect(j1).toEqual(j2);
  });

  it('returns { memory: [] } for empty user content', async () => {
    const llm = new DeterministicStubLLM();
    const json = (await llm.generateResponse([], { type: 'json' })) as {
      memory: unknown[];
    };
    expect(json.memory).toEqual([]);
  });

  it('extracts one fact from content without sentence terminators', async () => {
    const llm = new DeterministicStubLLM();
    const json = (await llm.generateResponse(
      [userMsg('hi there no period')],
      { type: 'json' },
    )) as { memory: { id: string; text: string }[] };
    expect(json.memory).toHaveLength(1);
    expect(json.memory[0]!.text).toBe('hi there no period');
  });

  it('ignores the tools parameter (DIP signature compliance)', async () => {
    const llm = new DeterministicStubLLM();
    const j1 = await llm.generateResponse(
      [userMsg('test')],
      { type: 'json' },
      [{ name: 'someTool' }],
    );
    const j2 = await llm.generateResponse([userMsg('test')], { type: 'json' });
    expect(j1).toEqual(j2);
  });
});

describe('DeterministicStubLLM.generateResponse (text type)', () => {
  it('returns same shape as generateChat content', async () => {
    const llm = new DeterministicStubLLM();
    const msgs: Message[] = [userMsg('say hi')];

    const text = (await llm.generateResponse(msgs, { type: 'text' })) as {
      text: string;
    };
    const chat = await llm.generateChat(msgs);

    expect(text.text).toBe(chat.content);
  });
});
