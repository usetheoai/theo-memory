/**
 * Live author-subject evaluation: runs the real write pipeline (`rememberMessages`,
 * `infer: true`) on chat messages that name their author, name nobody, or open with a label
 * that is not a person, three repetitions per case, and scores the subject of each extracted
 * fact with `scoring.ts`.
 *
 * The cases were drawn by a seeded generator and written for this evaluation; they share no
 * text with any benchmark dataset. Embeddings are a constant stub and each case gets an empty
 * in-memory store, so nothing here depends on recall.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (optional, e.g. a cost proxy),
 * OPENAI_CHAT_MODEL (default gpt-4o-mini), AUTHOR_SUBJECT_OUTPUT (report path),
 * AUTHOR_SUBJECT_CONCURRENCY (default 6).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalMemory, InMemoryVectorStore } from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';
import { z } from 'zod';

import { AuthorSubjectCaseSchema, scoreAuthorSubjectCase, type AuthorSubjectCase, type SubjectOutcome } from './scoring.js';

const REPETITIONS = 3;
const here = dirname(fileURLToPath(import.meta.url));
const cases = z.array(AuthorSubjectCaseSchema).parse(JSON.parse(readFileSync(resolve(here, 'cases.json'), 'utf8')));
if (process.env['OPENAI_API_KEY'] === undefined) throw new Error('OPENAI_API_KEY must be set for the live evaluation');
const concurrency = Number(process.env['AUTHOR_SUBJECT_CONCURRENCY'] ?? '6');
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('AUTHOR_SUBJECT_CONCURRENCY must be a positive integer');

interface Row {
  readonly id: string;
  readonly family: string;
  readonly language: string;
  readonly repetition: number;
  readonly facts: readonly string[];
  /** The excerpt each fact was read from, in the order of `facts`; empty when the fact has none. */
  readonly sourceQuotes: readonly string[];
  readonly outcomes: readonly SubjectOutcome[];
  readonly passed: boolean;
}

async function extract(fixture: AuthorSubjectCase): Promise<readonly { text: string; sourceQuote: string }[]> {
  const memory = await createLocalMemory({
    vectorStore: new InMemoryVectorStore(),
    embedder: { embed: async () => [1, 0, 0], embedBatch: async (texts) => texts.map(() => [1, 0, 0]) },
    llm: new OpenAILLM(),
    embeddingDim: 3,
    entityBoost: false,
  });
  try {
    const items = await memory.user('author-subject').rememberMessages(fixture.messages, { strictExtraction: true });
    return items.map((item) => ({ text: item.text, sourceQuote: item.evidence?.sourceQuote ?? '' }));
  } finally {
    await memory.dispose();
  }
}

const rows: Row[] = [];
for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
  const queue = [...cases];
  const worker = async (): Promise<void> => {
    for (let fixture = queue.shift(); fixture !== undefined; fixture = queue.shift()) {
      const extracted = await extract(fixture);
      const facts = extracted.map((fact) => fact.text);
      const sourceQuotes = extracted.map((fact) => fact.sourceQuote);
      rows.push({ id: fixture.id, family: fixture.family, language: fixture.language, repetition, facts, sourceQuotes, ...scoreAuthorSubjectCase(fixture, facts) });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`[author-subject] repetition ${String(repetition + 1)}/${String(REPETITIONS)} done`);
}

const byFamily: Record<string, Record<SubjectOutcome, number>> = {};
for (const row of rows) {
  const counts = (byFamily[row.family] ??= { correct: 0, wrong: 0, missing: 0 });
  for (const outcome of row.outcomes) counts[outcome] += 1;
}
const report = { model: process.env['OPENAI_CHAT_MODEL'] ?? 'gpt-4o-mini', repetitions: REPETITIONS, cases: cases.length, byFamily, rows };
const output = resolve(process.env['AUTHOR_SUBJECT_OUTPUT'] ?? resolve(here, '../../../../../benchmarks/results/author-subject.json'));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
for (const [family, counts] of Object.entries(byFamily)) {
  console.log(`[author-subject] ${family}: correct ${String(counts.correct)}, wrong ${String(counts.wrong)}, missing ${String(counts.missing)}`);
}
console.log(`[author-subject] -> ${output}`);
