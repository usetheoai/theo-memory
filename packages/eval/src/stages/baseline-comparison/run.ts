/**
 * Live baseline comparison: one reader, three ways of giving it a person's history.
 *
 *   memory        the history is written through the real write pipeline; each question is
 *                 answered from what recall returns (top five facts with their source messages);
 *   full context  every message of the history, with its date, is put in the prompt;
 *   retrieval     the five messages most similar to the question, with their dates.
 *
 * A history is the notes of one person from the update case set (values that change, some logged
 * out of order, controls that are not updates) interleaved by date with unrelated first-person
 * messages from the recalled-value case set. Questions come from both sets. The three arms share
 * the reader, its instruction and the scoring; input tokens of each reader call are reported.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (chat calls, e.g. a cost proxy),
 * OPENAI_CHAT_MODEL (default gpt-4o-mini), THEOMEM_PG_URI, BASELINE_COMPARISON_OUTPUT (path),
 * BASELINE_COMPARISON_DB (default themem_baseline_comparison; dropped and recreated),
 * BASELINE_COMPARISON_USERS (optional cap on the number of histories, for a smoke run).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { z } from 'zod';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { OpenAICompatibleEmbedder } from '@usetheo/memory/embedders/openai-compatible';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import { loadJudgeCases, matches, questionKind } from '../consolidation/judge-cases.js';
import { carries, RecalledValueCaseSchema } from '../recalled-value/scoring.js';

const TOP_K = 5;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;
const READER_INSTRUCTION =
  'You answer a question using only the notes given. Each note may carry the date it was said. ' +
  'Reply with the shortest exact answer, as it is written in the notes. ' +
  'When notes give different values for the same thing, the one said later is the current one, ' +
  'unless the question asks about a date: then answer what held on that date. ' +
  'If the notes do not say, reply exactly: unknown.';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const here = dirname(fileURLToPath(import.meta.url));
const apiKey = requiredEnv('OPENAI_API_KEY');
const chatBase = process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';
const chatModel = process.env['OPENAI_CHAT_MODEL'] ?? 'gpt-4o-mini';
const output = resolve(requiredEnv('BASELINE_COMPARISON_OUTPUT'));
const dbName = process.env['BASELINE_COMPARISON_DB'] ?? 'themem_baseline_comparison';
if (!/^[a-z_][a-z0-9_]*$/u.test(dbName)) throw new Error(`BASELINE_COMPARISON_DB must be a plain identifier, got '${dbName}'`);
const userCap = Number(process.env['BASELINE_COMPARISON_USERS'] ?? '0');

const updates = loadJudgeCases('judge-cases-update-judge.json');
const fillers = z.array(RecalledValueCaseSchema).parse(JSON.parse(readFileSync(resolve(here, '../recalled-value/cases-held-out.json'), 'utf8')));

interface Entry {
  readonly date: string;
  readonly content: string;
}

interface Question {
  readonly family: string;
  readonly query: string;
  readonly asOf: string | undefined;
  readonly correct: (answer: string) => boolean;
}

interface History {
  readonly id: string;
  readonly language: string;
  /** In the order the messages were logged. */
  readonly entries: readonly Entry[];
  readonly questions: readonly Question[];
}

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** One history per person of the update set: their notes and every filler message of their language. */
function histories(): readonly History[] {
  const byLanguage = new Map<string, typeof fillers>();
  for (const filler of fillers) byLanguage.set(filler.language, [...(byLanguage.get(filler.language) ?? []), filler]);
  const seen = new Map<string, number>();
  return updates.users.map((user) => {
    const language = user.id.includes('-pt-') ? 'pt' : 'en';
    const pool = byLanguage.get(language) ?? [];
    const index = seen.get(language) ?? 0;
    seen.set(language, index + 1);
    const dates = user.facts.map((fact) => fact.observedAt).sort();
    const first = dates[0] as string;
    const span = Math.max(1, Math.round((Date.parse(dates[dates.length - 1] as string) - Date.parse(first)) / 86_400_000));
    const notes: Entry[] = user.facts.map((fact) => ({ date: fact.observedAt, content: fact.text }));
    const fillerEntries: Entry[] = pool.flatMap((filler, i) =>
      filler.messages.map((content, j) => ({ date: addDays(first, (i * 37 + j * 11) % (span + 1)), content })),
    );
    // Notes keep their logging order (an update logged out of order lists its newer note first);
    // each filler goes before the first note logged at or after its date.
    const entries: Entry[] = [];
    const pending = [...fillerEntries].sort((a, b) => a.date.localeCompare(b.date));
    for (const note of notes) {
      while (pending.length > 0 && (pending[0] as Entry).date <= note.date) entries.push(pending.shift() as Entry);
      entries.push(note);
    }
    entries.push(...pending);
    const own = pool[index % Math.max(1, pool.length)];
    const questions: Question[] = [
      ...user.questions.map((q) => ({
        family: questionKind(user, q),
        query: q.query,
        asOf: q.asOf,
        correct: (answer: string) => matches(q.pattern, answer) && !(q.stalePattern !== undefined && matches(q.stalePattern, answer)),
      })),
      ...(own?.questions ?? []).map((q) => ({ family: `filler-${q.kind}`, query: q.question, asOf: undefined, correct: (answer: string) => carries(answer, q.value) })),
    ];
    return { id: user.id, language, entries, questions };
  });
}

const ChatSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number() }),
});

async function read(question: Question, lines: readonly string[]): Promise<{ answer: string; promptTokens: number }> {
  const asked = question.asOf === undefined ? question.query : `${question.query} (answer what held on ${question.asOf})`;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${chatBase}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: chatModel,
        temperature: 0,
        max_tokens: 40,
        messages: [
          { role: 'system', content: READER_INSTRUCTION },
          { role: 'user', content: `Notes:\n${lines.join('\n')}\n\nQuestion: ${asked}` },
        ],
      }),
    });
    if (response.ok) {
      const parsed = ChatSchema.parse(await response.json());
      return { answer: parsed.choices[0]?.message.content ?? '', promptTokens: parsed.usage.prompt_tokens };
    }
    if (attempt === 2) throw new Error(`reader call failed with status ${String(response.status)}`);
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] as number) * (b[i] as number);
    na += (a[i] as number) ** 2;
    nb += (b[i] as number) ** 2;
  }
  return dot / Math.sqrt(na * nb);
}

interface Row {
  readonly user: string;
  readonly language: string;
  readonly family: string;
  readonly query: string;
  readonly memory: boolean;
  readonly fullContext: boolean;
  readonly retrieval: boolean;
  readonly memoryTokens: number;
  readonly fullContextTokens: number;
  readonly retrievalTokens: number;
}

const all = histories();
const selected = userCap > 0 ? all.slice(0, userCap) : all;
const base = new URL(requiredEnv('THEOMEM_PG_URI'));
const admin = new pg.Pool({ connectionString: base.toString() });
await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();
const uri = new URL(base.toString());
uri.pathname = `/${dbName}`;
const pool = new pg.Pool({ connectionString: uri.toString() });
const embedder = new OpenAICompatibleEmbedder({ apiKey, baseUrl: 'https://api.openai.com/v1', model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIM });
const rows: Row[] = [];
try {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await runMigrations(pool, { embeddingDim: EMBEDDING_DIM });
  const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM }), embedder, llm: new OpenAILLM(), embeddingDim: EMBEDDING_DIM });
  try {
    await Promise.all(
      selected.map(async (history) => {
        const scope = memory.user(history.id);
        for (const entry of history.entries) {
          await scope.rememberMessages([{ role: 'user', content: entry.content }], { observedAt: new Date(`${entry.date}T12:00:00Z`) });
        }
        const dated = history.entries.map((entry) => `- [${entry.date}] ${entry.content}`);
        const vectors = await embedder.embedBatch(history.entries.map((entry) => entry.content));
        for (const question of history.questions) {
          const hits = await scope.recall(question.query, {
            topK: TOP_K,
            includeSources: true,
            ...(question.asOf === undefined ? {} : { asOf: new Date(`${question.asOf}T12:00:00Z`) }),
          });
          const sources = [...new Set(hits.flatMap((hit) => (hit.sources ?? []).map((s) => `- [${s.observedAt?.toISOString().slice(0, 10) ?? 'no date'}] ${s.content}`)))];
          const fromMemory = [...hits.map((hit) => `- ${hit.text}`), '', 'What was said, from which the notes above were taken:', ...sources];
          const queryVector = await embedder.embed(question.query);
          const nearest = vectors
            .map((vector, i) => ({ i, score: cosine(queryVector, vector) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, TOP_K)
            .map(({ i }) => dated[i] as string);
          const [m, f, r] = await Promise.all([read(question, fromMemory), read(question, dated), read(question, nearest)]);
          rows.push({
            user: history.id,
            language: history.language,
            family: question.family,
            query: question.query,
            memory: question.correct(m.answer),
            fullContext: question.correct(f.answer),
            retrieval: question.correct(r.answer),
            memoryTokens: m.promptTokens,
            fullContextTokens: f.promptTokens,
            retrievalTokens: r.promptTokens,
          });
        }
        console.log(`[baseline-comparison] ${history.id} done (${String(history.entries.length)} messages, ${String(history.questions.length)} questions)`);
      }),
    );
  } finally {
    await memory.dispose();
  }
} finally {
  await pool.end();
}

const summary: Record<string, { questions: number; memory: number; fullContext: number; retrieval: number; memoryTokens: number; fullContextTokens: number; retrievalTokens: number }> = {};
for (const row of rows) {
  const s = (summary[row.family] ??= { questions: 0, memory: 0, fullContext: 0, retrieval: 0, memoryTokens: 0, fullContextTokens: 0, retrievalTokens: 0 });
  s.questions += 1;
  s.memory += row.memory ? 1 : 0;
  s.fullContext += row.fullContext ? 1 : 0;
  s.retrieval += row.retrieval ? 1 : 0;
  s.memoryTokens += row.memoryTokens;
  s.fullContextTokens += row.fullContextTokens;
  s.retrievalTokens += row.retrievalTokens;
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ model: chatModel, topK: TOP_K, histories: selected.length, messagesPerHistory: selected[0]?.entries.length ?? 0, summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary));
