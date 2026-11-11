/**
 * Scoring for the message-recall evaluation: does a search over the raw message log reach
 * what the user was told when extraction kept no fact of it?
 */
import { z } from 'zod';

export const caseFileSchema = z.object({
  users: z.array(z.object({
    id: z.string().min(1),
    conversations: z.array(z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) })).min(1)).min(1),
    questions: z.array(z.object({
      query: z.string().min(1),
      pattern: z.string().min(1),
      form: z.enum(['lexical', 'paraphrase']),
    })).min(1),
  })).min(1),
});
export type CaseFile = z.infer<typeof caseFileSchema>;
export type Question = CaseFile['users'][number]['questions'][number];

/** Words that carry no content, ignored by the paraphrase rule (English and Portuguese). */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'with', 'by', 'about',
  'before', 'after', 'my', 'me', 'i', 'you', 'your', 'he', 'she', 'it', 'his', 'her', 'we', 'our', 'they', 'them',
  'what', 'which', 'who', 'when', 'where', 'how', 'why', 'do', 'does', 'did', 'is', 'was', 'are', 'be', 'been',
  'should', 'could', 'would', 'can', 'will', 'must', 'have', 'has', 'had', 'that', 'this', 'for', 'go', 'get',
  'o', 'os', 'as', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'com', 'para', 'por', 'que',
  'qual', 'quando', 'ele', 'ela', 'eu', 'minha', 'meu', 'até', 'antes', 'depois', 'vem', 'devo', 'fazer',
  'ao', 'aos', 'à', 'às',
]);

export function contentWords(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}:]+/u).filter((w) => w.length > 0 && !FUNCTION_WORDS.has(w)));
}

export function matchesPattern(pattern: string, text: string): boolean {
  return new RegExp(pattern, 'iu').test(text);
}

/**
 * Checks the declared form of every question against the messages holding its answer: a
 * `paraphrase` question shares no content word with them, a `lexical` one shares at least one.
 * Returns the violations; an empty list means the case file is well formed.
 */
export function formViolations(cases: CaseFile): string[] {
  const violations: string[] = [];
  for (const user of cases.users) {
    for (const q of user.questions) {
      const holding = user.conversations.flat().filter((m) => matchesPattern(q.pattern, m.content));
      if (holding.length === 0) {
        violations.push(`${user.id}: no message matches /${q.pattern}/`);
        continue;
      }
      const queryWords = contentWords(q.query);
      const shared = holding.flatMap((m) => [...contentWords(m.content)].filter((w) => queryWords.has(w)));
      if (q.form === 'paraphrase' && shared.length > 0) violations.push(`${user.id}: paraphrase "${q.query}" repeats ${shared.join(', ')}`);
      if (q.form === 'lexical' && shared.length === 0) violations.push(`${user.id}: lexical "${q.query}" repeats no word of its answer`);
    }
  }
  return violations;
}

export interface QuestionResult {
  readonly user: string;
  readonly query: string;
  readonly form: Question['form'];
  /** No fact stored in the scope matches the pattern. */
  readonly lostByExtraction: boolean;
  readonly messagesHit: boolean;
  readonly factsHit: boolean;
  /** The fact list (ids, in order) was the same before and after the message search. */
  readonly recallUnchanged: boolean;
}

export interface Tally { readonly hits: number; readonly total: number }

function tally<T>(rows: readonly T[], hit: (r: T) => boolean): Tally {
  return { hits: rows.filter(hit).length, total: rows.length };
}

export function summarize(rows: readonly QuestionResult[]) {
  const lost = rows.filter((r) => r.lostByExtraction);
  const lostLexical = lost.filter((r) => r.form === 'lexical');
  const lostParaphrase = lost.filter((r) => r.form === 'paraphrase');
  const h23 = tally(lostLexical, (r) => r.messagesHit);
  const h24 = tally(rows, (r) => r.recallUnchanged);
  return {
    questions: rows.length,
    lostByExtraction: lost.length,
    h23,
    h23Pass: h23.total > 0 && h23.hits * 3 >= h23.total * 2,
    h24,
    h24Pass: h24.hits === h24.total,
    lostParaphraseMessages: tally(lostParaphrase, (r) => r.messagesHit),
    factsOnly: tally(rows, (r) => r.factsHit),
    union: tally(rows, (r) => r.factsHit || r.messagesHit),
    unionOnLost: tally(lost, (r) => r.factsHit || r.messagesHit),
  };
}

/** A question answered by both rankings over the same stored messages (ADR-0031). */
export interface SemanticResult extends QuestionResult {
  /** `messagesHit` is the hybrid list; this is the BM25-only list. */
  readonly bm25Hit: boolean;
}

/** H25-H27 of the semantic message search criterion, fixed before implementation. */
export function summarizeSemantic(rows: readonly SemanticResult[]) {
  const lost = rows.filter((r) => r.lostByExtraction);
  const paraphrase = lost.filter((r) => r.form === 'paraphrase');
  const lexical = lost.filter((r) => r.form === 'lexical');
  const h25 = { hybrid: tally(paraphrase, (r) => r.messagesHit), bm25: tally(paraphrase, (r) => r.bm25Hit) };
  const h26 = { hybrid: tally(lexical, (r) => r.messagesHit), bm25: tally(lexical, (r) => r.bm25Hit) };
  const h27 = tally(rows, (r) => r.recallUnchanged);
  return {
    h25,
    h25Pass: h25.hybrid.total > 0 && h25.hybrid.hits * 5 >= h25.hybrid.total * 3 && h25.hybrid.hits > h25.bm25.hits,
    h26,
    h26Pass: h26.hybrid.hits >= h26.bm25.hits,
    h27,
    h27Pass: h27.hits === h27.total,
  };
}
