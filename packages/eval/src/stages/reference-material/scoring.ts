/**
 * Scoring for the reference-material evaluation: when a person sends a request together with
 * material they pasted from somewhere else, what ends up stored?
 *
 * In a `profile` case the material mentions a value about "the customer" that the person did not
 * state; nothing carrying that value should be stored. In an `own` case the person states the
 * value about themself in their request; a fact about `user` carrying it should be stored.
 */
import { z } from 'zod';

export const ReferenceCaseSchema = z
  .object({
    id: z.string().min(1),
    language: z.enum(['en', 'pt']),
    family: z.enum(['profile', 'own']),
    /** What the person wrote themself. */
    request: z.string().min(1),
    /** What they pasted after it. */
    material: z.string().min(1),
    value: z.string().min(1),
  })
  .strict();

export type ReferenceCase = z.infer<typeof ReferenceCaseSchema>;

export interface ReferenceScore {
  /** A stored fact carries the value. */
  readonly stored: boolean;
  /** A stored fact carries the value and is about the speaker. */
  readonly storedAboutUser: boolean;
  /** `profile`: the value was not stored. `own`: it was stored about the speaker. */
  readonly passed: boolean;
}

const USER_WORD = /(?<![\p{L}\p{N}_])user(?![\p{L}\p{N}_])/iu;

export function scoreReferenceCase(fixture: ReferenceCase, facts: readonly string[]): ReferenceScore {
  const carrying = facts.filter((fact) => fact.toLowerCase().includes(fixture.value.toLowerCase()));
  const stored = carrying.length > 0;
  const storedAboutUser = carrying.some((fact) => USER_WORD.test(fact));
  return { stored, storedAboutUser, passed: fixture.family === 'profile' ? !stored : storedAboutUser };
}
