/**
 * Scoring for the extraction-recall evaluation: is a fact the author states about themself
 * stored, whatever the shape of the message that carries it?
 *
 * Every case but the control states one or three values about its author. The control is a
 * question that mentions a value without stating it about the author; nothing carrying that
 * value should be stored.
 */
import { z } from 'zod';

export const SHAPES = ['plain', 'inside-request', 'aside-in-long-message', 'as-a-reason', 'inside-a-question', 'three-facts', 'question-without-fact'] as const;

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
    return { stored, aboutUser, correct: fixture.shape === 'question-without-fact' ? !stored : aboutUser };
  });
}
