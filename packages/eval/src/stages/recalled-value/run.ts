/**
 * Live recalled-value evaluation: writes each person's messages through the real write
 * pipeline, recalls for each question, and asks a reader the question twice from the same
 * recall: once with the recalled facts alone, once with the facts and the messages they came
 * from (`includeSources`). Both answers are scored against a value written in the messages.
 *
 * The comparison is paired on the same write and the same recall, so it isolates what the
 * reader is given. Tokens of each reader call are reported.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (chat calls, e.g. a cost proxy),
 * OPENAI_CHAT_MODEL (default gpt-4o-mini), THEOMEM_PG_URI, RECALLED_VALUE_CASES (path),
 * RECALLED_VALUE_OUTPUT (path), RECALLED_VALUE_DB (default themem_recalled_value; dropped and
 * recreated), RECALLED_VALUE_REPETITIONS (default 3).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import pg from 'pg';
import { z } from 'zod';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { OpenAICompatibleEmbedder } from '@usetheo/memory/embedders/openai-compatible';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import { carries, RecalledValueCaseSchema } from './scoring.js';

const TOP_K = 5;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;
const READER_INSTRUCTION =
  'You answer a question the user asks about themself, using only the memories given. ' +
  'Reply with the shortest exact answer, as it is written in the memories. ' +
  'If the memories do not say, reply exactly: unknown.';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const apiKey = requiredEnv('OPENAI_API_KEY');
const chatBase = process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';
const chatModel = process.env['OPENAI_CHAT_MODEL'] ?? 'gpt-4o-mini';
const cases = z.array(RecalledValueCaseSchema).parse(JSON.parse(readFileSync(requiredEnv('RECALLED_VALUE_CASES'), 'utf8')));
const output = resolve(requiredEnv('RECALLED_VALUE_OUTPUT'));
const dbName = process.env['RECALLED_VALUE_DB'] ?? 'themem_recalled_value';
if (!/^[a-z_][a-z0-9_]*$/u.test(dbName)) throw new Error(`RECALLED_VALUE_DB must be a plain identifier, got '${dbName}'`);
const repetitions = Number(process.env['RECALLED_VALUE_REPETITIONS'] ?? '3');
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('RECALLED_VALUE_REPETITIONS must be a positive integer');

const ChatSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number() }),
});

async function read(question: string, lines: readonly string[]): Promise<{ answer: string; promptTokens: number }> {
  const response = await fetch(`${chatBase}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: chatModel,
      temperature: 0,
      max_tokens: 40,
      messages: [
        { role: 'system', content: READER_INSTRUCTION },
        { role: 'user', content: `Memories:\n${lines.join('\n')}\n\nQuestion: ${question}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`reader call failed with status ${String(response.status)}`);
  const parsed = ChatSchema.parse(await response.json());
  return { answer: parsed.choices[0]?.message.content ?? '', promptTokens: parsed.usage.prompt_tokens };
}

interface Row {
  readonly user: string;
  readonly language: string;
  readonly repetition: number;
  readonly kind: 'main' | 'detail';
  readonly question: string;
  /** The value is in the text of a recalled fact. */
  readonly inFacts: boolean;
  /** The value is in a source message of a recalled fact. */
  readonly inSources: boolean;
  readonly factsCorrect: boolean;
  readonly sourcesCorrect: boolean;
  readonly factsTokens: number;
  readonly sourcesTokens: number;
}

const base = new URL(requiredEnv('THEOMEM_PG_URI'));
const admin = new pg.Pool({ connectionString: base.toString() });
await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();
const uri = new URL(base.toString());
uri.pathname = `/${dbName}`;
const pool = new pg.Pool({ connectionString: uri.toString() });
const rows: Row[] = [];
try {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await runMigrations(pool, { embeddingDim: EMBEDDING_DIM });
  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM }),
    embedder: new OpenAICompatibleEmbedder({ apiKey, baseUrl: 'https://api.openai.com/v1', model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIM }),
    llm: new OpenAILLM(),
    embeddingDim: EMBEDDING_DIM,
  });
  try {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      await Promise.all(
        cases.map(async (fixture) => {
          const scope = memory.user(`${fixture.id}-r${String(repetition)}`);
          for (const content of fixture.messages) await scope.rememberMessages([{ role: 'user', content }]);
          for (const q of fixture.questions) {
            const hits = await scope.recall(q.question, { topK: TOP_K, includeSources: true });
            const facts = hits.map((hit) => `- ${hit.text}`);
            const sources = [...new Set(hits.flatMap((hit) => (hit.sources ?? []).map((source) => source.content)))];
            const withSources = [...facts, '', 'What the user wrote, from which the memories above were taken:', ...sources.map((s) => `- ${s}`)];
            const [fromFacts, fromSources] = await Promise.all([read(q.question, facts), read(q.question, withSources)]);
            rows.push({
              user: fixture.id,
              language: fixture.language,
              repetition,
              kind: q.kind,
              question: q.question,
              inFacts: hits.some((hit) => carries(hit.text, q.value)),
              inSources: sources.some((s) => carries(s, q.value)),
              factsCorrect: carries(fromFacts.answer, q.value),
              sourcesCorrect: carries(fromSources.answer, q.value),
              factsTokens: fromFacts.promptTokens,
              sourcesTokens: fromSources.promptTokens,
            });
          }
        }),
      );
      console.log(`[recalled-value] repetition ${String(repetition + 1)}/${String(repetitions)} done`);
    }
  } finally {
    await memory.dispose();
  }
} finally {
  await pool.end();
}

const summary: Record<string, Record<string, number>> = {};
for (const row of rows) {
  const s = (summary[row.kind] ??= { questions: 0, inFacts: 0, inSources: 0, factsCorrect: 0, sourcesCorrect: 0, factsTokens: 0, sourcesTokens: 0 });
  s['questions'] = (s['questions'] ?? 0) + 1;
  for (const key of ['inFacts', 'inSources', 'factsCorrect', 'sourcesCorrect'] as const) s[key] = (s[key] ?? 0) + (row[key] ? 1 : 0);
  s['factsTokens'] = (s['factsTokens'] ?? 0) + row.factsTokens;
  s['sourcesTokens'] = (s['sourcesTokens'] ?? 0) + row.sourcesTokens;
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ model: chatModel, repetitions, topK: TOP_K, summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary));
