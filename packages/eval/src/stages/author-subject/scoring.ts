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
    messages: z.array(z.object({ role: z.literal('user'), content: z.string().min(1) }).strict()).min(1),
    expected: z.array(z.object({ value: z.string().min(1), subject: z.string().min(1) }).strict()).min(1),
    /** Words that open a message before a colon without being a person, and the other names in the case. */
    notSubjects: z.array(z.string().min(1)),
  })
  .strict();

export type AuthorSubjectCase = z.infer<typeof AuthorSubjectCaseSchema>;

export type SubjectOutcome = 'correct' | 'wrong' | 'missing';

const LEADING_ARTICLE = /^(?:an?|the|uma?|o|a)\s+/iu;

function word(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

function states(fact: string, value: string): boolean {
  return fact.toLowerCase().includes(value.replace(LEADING_ARTICLE, '').toLowerCase());
}

/**
 * Judges one expected pair against the extracted facts. The facts that carry the value decide:
 * with a named subject, every one of them has to name that person; with `user`, every one has
 * to name `user` and none of the case's other names or labels.
 */
export function scoreSubject(
  expected: { readonly value: string; readonly subject: string },
  notSubjects: readonly string[],
  facts: readonly string[],
): SubjectOutcome {
  const carrying = facts.filter((fact) => states(fact, expected.value));
  if (carrying.length === 0) return 'missing';
  const others = notSubjects.filter((name) => name.toLowerCase() !== expected.subject.toLowerCase());
  const right = carrying.every(
    (fact) => word(fact, expected.subject) && (expected.subject !== 'user' || !others.some((name) => word(fact, name))),
  );
  return right ? 'correct' : 'wrong';
}

export interface AuthorSubjectScore {
  readonly outcomes: readonly SubjectOutcome[];
  readonly passed: boolean;
}

export function scoreAuthorSubjectCase(fixture: AuthorSubjectCase, facts: readonly string[]): AuthorSubjectScore {
  const outcomes = fixture.expected.map((pair) => scoreSubject(pair, fixture.notSubjects, facts));
  return { outcomes, passed: outcomes.every((outcome) => outcome === 'correct') };
}
