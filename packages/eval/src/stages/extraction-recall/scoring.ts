/**
 * Scoring for the extraction-recall evaluation: is a fact the author states about themself
 * stored, whatever the shape of the message that carries it?
 *
 * Most cases state one or three values about their author. The controls mention a value that is
 * not true of the author (a question that only considers it, a request that involves it, a
 * question about someone else); nothing carrying that value should be stored.
 */
import { z } from 'zod';

export const SHAPES = [
  'plain',
  'inside-request',
  'aside-in-long-message',
  'as-a-reason',
  'inside-a-question',
  'three-facts',
  'question-without-fact',
  'request-without-fact',
  'question-about-someone-else',
] as const;

/** Shapes in which the value is mentioned and is not true of the author. */
export const CONTROL_SHAPES: ReadonlySet<string> = new Set(['question-without-fact', 'request-without-fact', 'question-about-someone-else']);

export const ExtractionRecallCaseSchema = z
  .object({
    id: z.string().min(1),
    language: z.enum(['en', 'pt']),
    shape: z.enum(SHAPES),
    text: z.string().min(1),
    values: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type ExtractionRecallCase = z.infer<typeof ExtractionRecallCaseSchema>;

const USER_WORD = /(?<![\p{L}\p{N}_])user(?![\p{L}\p{N}_])/iu;

export interface ValueScore {
  /** A stored fact carries the value. */
  readonly stored: boolean;
  /** A stored fact carries the value and names the speaker. */
  readonly aboutUser: boolean;
  /** Stated values: stored about the speaker. Control values: not stored. */
  readonly correct: boolean;
}

export function scoreExtractionRecallCase(fixture: ExtractionRecallCase, facts: readonly string[]): readonly ValueScore[] {
  return fixture.values.map((value) => {
    const carrying = facts.filter((fact) => fact.toLowerCase().includes(value.toLowerCase()));
    const stored = carrying.length > 0;
    const aboutUser = carrying.some((fact) => USER_WORD.test(fact));
    return { stored, aboutUser, correct: CONTROL_SHAPES.has(fixture.shape) ? !stored : aboutUser };
  });
}
