/**
 * Scoring for the author-subject evaluation: when a message names its author, does the fact
 * extracted from it name that person, and when it does not, does the fact stay with the
 * speaker token `user`?
 *
 * Each case lists what its messages state as `expected` pairs of a value and the person it is
 * true of. `subject` is a person's name, or `user` when the author of the statement is unnamed.
 */
import { z } from 'zod';

export const AuthorSubjectCaseSchema = z
  .object({
    id: z.string().min(1),
    language: z.enum(['en', 'pt']),
    family: z.enum(['author-self', 'author-about-third', 'unnamed', 'non-name-prefix', 'two-authors']),
    /** `name` is the author the message names; the runner sends it as a field or as a `Name: ` prefix. */
    messages: z
      .array(z.object({ role: z.literal('user'), content: z.string().min(1), name: z.string().min(1).optional() }).strict())
      .min(1),
    expected: z.array(z.object({ value: z.string().min(1), subject: z.string().min(1) }).strict()).min(1),
    /** Words that open a message before a colon without being a person, and the other names in the case. */
    notSubjects: z.array(z.string().min(1)),
  })
  .strict();

export type AuthorSubjectCase = z.infer<typeof AuthorSubjectCaseSchema>;

/**
 * `unattributed`: the value was stored, but only in facts that name nobody (a detail about the
 * thing itself), so a question about the person does not reach it.
 */
export type SubjectOutcome = 'correct' | 'wrong' | 'unattributed' | 'missing';

const LEADING_ARTICLE = /^(?:an?|the|uma?|o|a)\s+/iu;

function word(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

function states(fact: string, value: string): boolean {
  return fact.toLowerCase().includes(value.replace(LEADING_ARTICLE, '').toLowerCase());
}

/**
 * Judges one expected pair against the extracted facts, looking only at the facts that carry the
 * value. A fact that names someone else (the speaker token for a named author, another name or
 * label of the case) makes the pair `wrong`. Otherwise one fact naming the expected subject makes
 * it `correct`. A fact that carries the value and names nobody decides nothing on its own.
 */
export function scoreSubject(
  expected: { readonly value: string; readonly subject: string },
  notSubjects: readonly string[],
  facts: readonly string[],
): SubjectOutcome {
  const carrying = facts.filter((fact) => states(fact, expected.value));
  if (carrying.length === 0) return 'missing';
  const others = [...notSubjects, 'user'].filter((name) => name.toLowerCase() !== expected.subject.toLowerCase());
  const names = (fact: string): boolean => word(fact, expected.subject);
  const misnames = (fact: string): boolean => others.some((name) => word(fact, name)) && (expected.subject === 'user' || !names(fact));
  if (carrying.some(misnames)) return 'wrong';
  return carrying.some(names) ? 'correct' : 'unattributed';
}

export interface AuthorSubjectScore {
  readonly outcomes: readonly SubjectOutcome[];
  readonly passed: boolean;
}

export function scoreAuthorSubjectCase(fixture: AuthorSubjectCase, facts: readonly string[]): AuthorSubjectScore {
  const outcomes = fixture.expected.map((pair) => scoreSubject(pair, fixture.notSubjects, facts));
  return { outcomes, passed: outcomes.every((outcome) => outcome === 'correct') };
}
