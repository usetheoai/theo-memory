/**
 * Case files shared by the consolidation runners (`judge-run.ts`, `write-run.ts`): users with
 * distinct facts, updates of one attribute (an old and a new fact) and questions, some asked at a
 * past instant.
 */
import { readFileSync } from 'node:fs';

import { z } from 'zod';

export const factSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  observedAt: z.string().date(),
  role: z.enum(['distinct', 'old', 'new']),
  update: z.string().optional(),
  loggedOutOfOrder: z.boolean().optional(),
});
export const questionSchema = z.object({
  query: z.string().min(1),
  pattern: z.string().min(1),
  stalePattern: z.string().optional(),
  asOf: z.string().date().optional(),
});
const casesSchema = z.object({
  users: z.array(z.object({ id: z.string().min(1), facts: z.array(factSchema), questions: z.array(questionSchema) })),
});
export type JudgeCases = z.infer<typeof casesSchema>;
export type JudgeQuestion = z.infer<typeof questionSchema>;

/** distinct: about a distinct fact; current / asOf-before-change / asOf-after-change: about an update. */
export type QuestionKind = 'distinct' | 'current' | 'asOf-before-change' | 'asOf-after-change';

export const matches = (pattern: string, text: string): boolean => new RegExp(pattern, 'i').test(text);

/** Reads a case file of this directory, named `judge-cases*.json`, and checks every update has one old and one new fact. */
export function loadJudgeCases(caseFile: string): JudgeCases {
  if (!/^judge-cases[a-z-]*\.json$/.test(caseFile)) throw new Error(`Unexpected case file: '${caseFile}'`);
  const cases = casesSchema.parse(JSON.parse(readFileSync(new URL(`./${caseFile}`, import.meta.url), 'utf8')));
  for (const user of cases.users) {
    const updates = new Map<string, string[]>();
    for (const f of user.facts) {
      if (f.role === 'distinct') continue;
      if (f.update === undefined) throw new Error(`${user.id}/${f.key}: an update fact needs 'update'`);
      updates.set(f.update, [...(updates.get(f.update) ?? []), f.role]);
    }
    for (const [name, roles] of updates) {
      if (roles.sort().join() !== 'new,old') throw new Error(`${user.id}: update '${name}' needs exactly one old and one new fact`);
    }
  }
  return cases;
}

/** What a question asks about: a distinct fact, the current value, or a past value before or after the change. */
export function questionKind(user: JudgeCases['users'][number], q: JudgeQuestion): QuestionKind {
  if (q.stalePattern === undefined) return 'distinct';
  if (q.asOf === undefined) return 'current';
  const oldTexts = user.facts.filter((f) => f.role === 'old').map((f) => f.text);
  return oldTexts.some((t) => matches(q.stalePattern!, t)) ? 'asOf-after-change' : 'asOf-before-change';
}
