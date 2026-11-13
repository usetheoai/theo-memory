/**
 * The update judge (ADR-0036): of two notes about the same subject, does the later one make the
 * earlier one no longer true?
 *
 * The extractor used to decide this in the call that extracts facts. It found two of three updates
 * said with no word of change and also ended notes that stay true. Asked on its own, with only the
 * two texts and their dates, and reasoning before it answers, the same model found every update of
 * a 223-pair set and wrongly ended none. Asked about a whole list in one call it was worse on both
 * counts, so the call is per pair.
 *
 * The judge gives no verdict when the call fails or the answer is unusable. The caller then leaves
 * the pair alone: two values kept side by side can be seen and fixed, a true fact ended cannot.
 */
import type { Tracer } from '@opentelemetry/api';
import { z } from 'zod';

import type { LLM } from '../dip/llm.js';
import { emitEvent } from '../memory-event.js';

export interface DatedNote {
  readonly text: string;
  /** When it was said (the memory's valid-from instant). */
  readonly saidAt: Date;
}

export type UpdateVerdict = 'replaces' | 'both';

/** System prompt of the judge call. It names no case and was not tuned on the set that approved it. */
export const UPDATE_JUDGE_PROMPT = [
  'You compare two notes about the same person. The second note was written later than the first. Decide whether the second note makes the first one no longer true.',
  'Think first and write your thinking in "reasoning": what kind of information each note gives; whether both notes are about the same thing; whether that thing holds only one value at a time for a person (a home city, an employer, a manager) or can hold several at once (languages, pets, hobbies) or is something that happened on an occasion (a trip, a race, a course); and whether the notes are about different periods or different occasions.',
  'Then give "verdict":',
  '- "replaces": both notes give a value for the same thing, that thing holds one value at a time, and the values differ; or the second note says the first was wrong.',
  '- "both": both notes can be true together. The same value said again, two different things, figures for different periods, separate occasions, or a thing that admits several values.',
  'Answer JSON only: {"reasoning": "...", "verdict": "replaces" | "both"}',
].join('\n');

const answerSchema = z.object({ verdict: z.enum(['replaces', 'both']) });

const day = (instant: Date): string => instant.toISOString().slice(0, 10);

/** Asks the judge about one pair. `earlier` must be the note that was said first. */
export async function judgeUpdate(llm: LLM, earlier: DatedNote, later: DatedNote, tracer: Tracer | undefined): Promise<UpdateVerdict | null> {
  let raw: unknown;
  try {
    raw = await llm.generateResponse(
      [
        { role: 'system', content: UPDATE_JUDGE_PROMPT },
        { role: 'user', content: `First note (written ${day(earlier.saidAt)}): ${earlier.text}\nSecond note (written ${day(later.saidAt)}): ${later.text}` },
      ],
      { type: 'json' },
    );
  } catch (error) {
    emitEvent(tracer, 'update_judge_failed', { reason: 'llm_error', error_type: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      emitEvent(tracer, 'update_judge_failed', { reason: 'malformed_answer' });
      return null;
    }
  }
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) {
    emitEvent(tracer, 'update_judge_failed', { reason: 'malformed_answer' });
    return null;
  }
  return parsed.data.verdict;
}
