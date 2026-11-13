import type { Tracer } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';

import type { LLM } from '../dip/llm.js';

import { judgeUpdate, UPDATE_JUDGE_PROMPT } from './update-judge.js';

interface Recorded { event: string; attributes: Record<string, unknown> }

function recordingTracer(sink: Recorded[]): Tracer {
  return {
    startActiveSpan(name: string, fn: (span: unknown) => void): void {
      const attributes: Record<string, unknown> = {};
      fn({ setAttribute: (k: string, v: unknown) => { attributes[k] = v; }, end: () => undefined });
      sink.push({ event: name, attributes });
    },
  } as unknown as Tracer;
}

const answering = (answer: unknown): LLM & { generateResponse: ReturnType<typeof vi.fn> } =>
  ({ generateResponse: vi.fn(async () => answer), generateChat: vi.fn() });

const earlier = { text: 'Maya lives in Denver', saidAt: new Date('2020-03-01T12:00:00Z') };
const later = { text: 'Maya lives in Portland', saidAt: new Date('2023-11-01T12:00:00Z') };

describe('judgeUpdate', () => {
  it('says the later note replaces the earlier one when the judge answers so', async () => {
    const verdict = await judgeUpdate(answering({ reasoning: 'same thing, one value', verdict: 'replaces' }), earlier, later, undefined);

    expect(verdict).toBe('replaces');
  });

  it('says both hold when the judge answers so', async () => {
    const verdict = await judgeUpdate(answering({ reasoning: 'different years', verdict: 'both' }), earlier, later, undefined);

    expect(verdict).toBe('both');
  });

  it('shows the judge only the two texts and the days they were said, earlier first', async () => {
    const llm = answering({ reasoning: '', verdict: 'both' });

    await judgeUpdate(llm, earlier, later, undefined);

    expect(llm.generateResponse).toHaveBeenCalledWith(
      [
        { role: 'system', content: UPDATE_JUDGE_PROMPT },
        { role: 'user', content: 'First note (written 2020-03-01): Maya lives in Denver\nSecond note (written 2023-11-01): Maya lives in Portland' },
      ],
      { type: 'json' },
    );
  });

  it('accepts the answer as a JSON string', async () => {
    expect(await judgeUpdate(answering('{"reasoning":"x","verdict":"replaces"}'), earlier, later, undefined)).toBe('replaces');
  });

  it('gives no verdict, and says why, when the answer is not one of the two', async () => {
    const events: Recorded[] = [];

    const verdict = await judgeUpdate(answering({ verdict: 'maybe' }), earlier, later, recordingTracer(events));

    expect(verdict).toBeNull();
    expect(events).toEqual([{ event: 'update_judge_failed', attributes: { reason: 'malformed_answer' } }]);
  });

  it('gives no verdict, and says why, when the call fails', async () => {
    const events: Recorded[] = [];
    const failing: LLM = { generateResponse: vi.fn(async () => { throw new TypeError('socket closed'); }), generateChat: vi.fn() };

    const verdict = await judgeUpdate(failing, earlier, later, recordingTracer(events));

    expect(verdict).toBeNull();
    expect(events).toEqual([{ event: 'update_judge_failed', attributes: { reason: 'llm_error', error_type: 'TypeError' } }]);
  });
});
