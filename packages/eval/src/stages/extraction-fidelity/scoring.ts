/**
 * Scoring for the extraction-fidelity evaluation: does extraction keep the specific detail a
 * turn states, and does it name the subject the message names?
 *
 * A case passes when every `required` pattern matches at least one extracted fact, no fact uses
 * the bare speaker token `user` as its subject while the message names its author, and a
 * `maxFacts` ceiling (for filler turns) is respected.
 */
import { z } from 'zod';

export const FidelityCaseSchema = z
  .object({
    name: z.string().min(1),
    family: z.enum(['passing-plan', 'title-or-name', 'suggestion', 'secondary-detail', 'named-subject', 'control']),
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) }).strict())
      .min(1),
    required: z.array(z.string().min(1)),
    subject: z.string().min(1).optional(),
    maxFacts: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.family === 'control' && c.maxFacts === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `control case ${c.name} must declare maxFacts` });
    }
    if (c.family !== 'control' && c.required.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `case ${c.name} must declare at least one required pattern` });
    }
  });

export type FidelityCase = z.infer<typeof FidelityCaseSchema>;

export interface FidelityScore {
  readonly passed: boolean;
  readonly missing: readonly string[];
  readonly bareUserSubject: readonly string[];
  readonly overLimit: boolean;
  readonly facts: number;
}

const BARE_USER_SUBJECT = /^\s*user(\b|'s)/i;

export function scoreFidelityCase(fixture: FidelityCase, facts: readonly string[]): FidelityScore {
  const missing = fixture.required.filter((pattern) => !facts.some((fact) => new RegExp(pattern, 'iu').test(fact)));
  const bareUserSubject = fixture.subject === undefined ? [] : facts.filter((fact) => BARE_USER_SUBJECT.test(fact));
  const overLimit = fixture.maxFacts !== undefined && facts.length > fixture.maxFacts;
  return {
    passed: missing.length === 0 && bareUserSubject.length === 0 && !overLimit,
    missing,
    bareUserSubject,
    overLimit,
    facts: facts.length,
  };
}
