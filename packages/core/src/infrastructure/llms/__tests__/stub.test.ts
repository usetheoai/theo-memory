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
import { AdditiveExtractionSchema } from '../../../domain/extraction/prompt.js';
import type { Message } from '../../../domain/message.js';

const userMsg = (content: string): Message => ({ role: 'user', content });
const sysMsg = (content: string): Message => ({ role: 'system', content });

/**
 * F-tests-3 + EC-3 absorption: contract regex per source plan ADR D3
 * (chat-content shape). The pre-fix assertions `typeof r.content === 'string'`
 * are tautological — pass for `'OK'`, `'undefined'`, or any string. The
 * regex locks the actual ADR D3 contract `stub-response:<4-hex-chars>`.
 * EC-3 extends the regex to the generateResponse text-type path as well.
 */
const STUB_CONTENT_RE = /^stub-response:[0-9a-f]{4}$/;

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

  it('returns LLMResponse with role=assistant + ADR D3 content shape (F-tests-3)', async () => {
    const llm = new DeterministicStubLLM();
    const r = await llm.generateChat([userMsg('hello')]);
    expect(r.role).toBe('assistant');
    expect(r.content).toMatch(STUB_CONTENT_RE);
  });

  it('returns valid LLMResponse for empty messages array + ADR D3 content shape (F-tests-3)', async () => {
    const llm = new DeterministicStubLLM();
    const r = await llm.generateChat([]);
    expect(r.role).toBe('assistant');
    expect(r.content).toMatch(STUB_CONTENT_RE);
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

  it('strips role-prefix when content is in pipeline.ts inline format (F-dom-memory-2)', async () => {
    // Production call site at src/core/extraction/pipeline.ts:230 passes a
    // SINGLE synthetic user message whose `.content` is
    // `messages.map((m) => `${m.role}: ${m.content}`).join('\n')`. Stub must
    // strip role prefix BEFORE sentence-split or dedup hashes get polluted.
    const llm = new DeterministicStubLLM();
    const json = (await llm.generateResponse(
      [userMsg('user: I like coffee\nassistant: noted\nuser: pgvector is fast')],
      { type: 'json' },
    )) as { memory: { id: string; text: string }[] };
    expect(json.memory.length).toBeGreaterThan(0);
    for (const m of json.memory) {
      expect(m.text).not.toMatch(/^(user|assistant|system):/i);
    }
  });

  it('composes strip + sentence-split correctly on multi-line pipeline-shape input (EC-2)', async () => {
    // EC-2 absorption: validates that strip and sentence-split COMPOSE, not
    // just that strip in isolation works. Source: edge-case-plan report
    // adapters-stub-embedder-llm-cycle-1-fixes-edge-cases-2026-06-01.md § EC-2.
    const llm = new DeterministicStubLLM();
    const json = (await llm.generateResponse(
      [
        userMsg(
          'user: I am Paulo.\nassistant: Nice.\nuser: I work at TheoCloud. My language is TS.',
        ),
      ],
      { type: 'json' },
    )) as { memory: { id: string; text: string }[] };
    expect(json.memory.length).toBeGreaterThan(0);
    for (const m of json.memory) {
      expect(m.text).not.toMatch(/^(user|assistant|system):/i);
    }
    const texts = json.memory.map((m) => m.text);
    expect(texts).toContain('I am Paulo');
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
  it('returns same shape as generateChat content + ADR D3 content shape (EC-3)', async () => {
    const llm = new DeterministicStubLLM();
    const msgs: Message[] = [userMsg('say hi')];

    const text = (await llm.generateResponse(msgs, { type: 'text' })) as {
      text: string;
    };
    const chat = await llm.generateChat(msgs);

    expect(text.text).toBe(chat.content);
    // EC-3 absorption: regex assertion locks the contract on the text-type
    // path too, not just the chat path. If BOTH sides regress to e.g. 'OK',
    // the equality holds but the contract is silently broken. The regex
    // catches that.
    expect(text.text).toMatch(STUB_CONTENT_RE);
  });
});
