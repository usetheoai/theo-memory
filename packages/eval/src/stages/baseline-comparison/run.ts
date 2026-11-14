/**
 * Live baseline comparison: one reader, three ways of giving it a person's history.
 *
 *   memory        the history is written through the real write pipeline; each question is
 *                 answered from what recall returns (top five facts with their source messages);
 *   full context  every message of the history, with its date, is put in the prompt;
 *   retrieval     the five messages most similar to the question, with their dates;
 *   memory+log    what recall returns, plus the five logged messages the store's own message
 *                 search finds for the question, leaving out a message when every fact taken
 *                 from it has been replaced. A candidate for recall, measured here first.
 *
 * A history is the notes about four people from the update case set (values that change, some
 * logged out of order, controls that are not updates) interleaved by date with the first-person
 * messages of one person from the recalled-value case set. No two messages of a history are
 * about the same person and the same thing unless the case set says one updates the other.
 * Questions come from both sets. The three arms share the reader and the scoring, and each
 * question is asked under two instructions: one that tells the reader a later statement is the
 * current one, and one that does not. Answers and input tokens of each reader call are reported.
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
const PEOPLE_PER_HISTORY = 4;
const INSTRUCTION_START =
  'You answer a question using only the notes given. Each note may carry the date it was said. ' +
  'Reply with the shortest exact answer, as it is written in the notes. ';
const INSTRUCTION_END = 'If the notes do not say, reply exactly: unknown.';
const INSTRUCTIONS = {
  laterWins:
    INSTRUCTION_START +
    'When notes give different values for the same thing, the one said later is the current one, ' +
    'unless the question asks about a date: then answer what held on that date. ' +
    INSTRUCTION_END,
  plain: INSTRUCTION_START + INSTRUCTION_END,
} as const;
type Instruction = keyof typeof INSTRUCTIONS;

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

/** One history for each group of four people of the update set, with one person's first-person messages. */
function histories(): readonly History[] {
  const byLanguage = new Map<string, { users: (typeof updates.users)[number][]; fillers: typeof fillers }>();
  const group = (language: string) => {
    const existing = byLanguage.get(language);
    if (existing !== undefined) return existing;
    const created = { users: [] as (typeof updates.users)[number][], fillers: fillers.filter((filler) => filler.language === language) };
    byLanguage.set(language, created);
    return created;
  };
  for (const user of updates.users) group(user.id.includes('-pt-') ? 'pt' : 'en').users.push(user);
  const result: History[] = [];
  for (const [language, { users, fillers: pool }] of byLanguage) {
    for (let start = 0; start < users.length; start += PEOPLE_PER_HISTORY) {
      const people = users.slice(start, start + PEOPLE_PER_HISTORY);
      const own = pool[(start / PEOPLE_PER_HISTORY) % Math.max(1, pool.length)];
      // Notes keep the logging order of their case (an update logged out of order lists its newer
      // note first); the people take turns, so the notes of one person are spread over the history.
      const notes: Entry[] = [];
      for (let i = 0; people.some((person) => i < person.facts.length); i += 1) {
        for (const person of people) {
          const fact = person.facts[i];
          if (fact !== undefined) notes.push({ date: fact.observedAt, content: fact.text });
        }
      }
      const dates = notes.map((note) => note.date).sort();
      const first = dates[0] as string;
      const span = Math.max(1, Math.round((Date.parse(dates[dates.length - 1] as string) - Date.parse(first)) / 86_400_000));
      const ownMessages = own?.messages ?? [];
      const step = Math.max(1, Math.floor(notes.length / (ownMessages.length + 1)));
      const entries: Entry[] = [...notes];
      ownMessages.forEach((content, j) => {
        entries.splice(Math.min(entries.length, (j + 1) * step + j), 0, { date: addDays(first, Math.round(((j + 1) * span) / (ownMessages.length + 1))), content });
      });
      const questions: Question[] = [
        ...people.flatMap((person) =>
          person.questions.map((q) => ({
            family: questionKind(person, q),
            query: q.query,
            asOf: q.asOf,
            correct: (answer: string) => matches(q.pattern, answer) && !(q.stalePattern !== undefined && matches(q.stalePattern, answer)),
          })),
        ),
        ...(own?.questions ?? []).map((q) => ({ family: `first-person-${q.kind}`, query: q.question, asOf: undefined, correct: (answer: string) => carries(answer, q.value) })),
      ];
      result.push({ id: `${language}-${String(start / PEOPLE_PER_HISTORY)}`, language, entries, questions });
    }
  }
  return result;
}

const ChatSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number() }),
});

async function read(question: Question, lines: readonly string[], instruction: Instruction): Promise<{ answer: string; promptTokens: number }> {
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
          { role: 'system', content: INSTRUCTIONS[instruction] },
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
  readonly instruction: Instruction;
  readonly memory: boolean;
  readonly fullContext: boolean;
  readonly retrieval: boolean;
  readonly memoryPlusLog: boolean;
  readonly memoryAnswer: string;
  readonly fullContextAnswer: string;
  readonly retrievalAnswer: string;
  readonly memoryPlusLogAnswer: string;
  /** What the memory arm showed the reader. */
  readonly memoryLines: readonly string[];
  readonly memoryTokens: number;
  readonly fullContextTokens: number;
  readonly retrievalTokens: number;
  readonly memoryPlusLogTokens: number;
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
          // Messages whose every extracted fact was ended by the question's clock carry a value
          // that no longer holds; showing them would put the old value beside the current one.
          const clock = question.asOf === undefined ? new Date() : new Date(`${question.asOf}T12:00:00Z`);
          const { rows: replaced } = await pool.query<{ message_id: string }>(
            `SELECT s.message_id FROM memory_message_sources s JOIN memories m ON m.id = s.memory_id
              WHERE m.user_id = $1 GROUP BY s.message_id
             HAVING bool_and(m.t_invalid IS NOT NULL AND m.t_invalid <= $2)`,
            [history.id, clock],
          );
          const gone = new Set(replaced.map((row) => row.message_id));
          const found = await scope.searchMessages(question.query, { limit: TOP_K, ...(question.asOf === undefined ? {} : { asOf: clock }) });
          const fromLog = found.filter((message) => !gone.has(message.id)).map((message) => `- [${message.observedAt?.toISOString().slice(0, 10) ?? 'no date'}] ${message.content}`);
          const memoryPlusLog = [...fromMemory, ...fromLog.filter((line) => !sources.includes(line))];
          const queryVector = await embedder.embed(question.query);
          const nearest = vectors
            .map((vector, i) => ({ i, score: cosine(queryVector, vector) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, TOP_K)
            .map(({ i }) => dated[i] as string);
          for (const instruction of Object.keys(INSTRUCTIONS) as Instruction[]) {
            const [m, f, r, ml] = await Promise.all([
              read(question, fromMemory, instruction),
              read(question, dated, instruction),
              read(question, nearest, instruction),
              read(question, memoryPlusLog, instruction),
            ]);
            rows.push({
              user: history.id,
              language: history.language,
              family: question.family,
              query: question.query,
              instruction,
              memory: question.correct(m.answer),
              fullContext: question.correct(f.answer),
              retrieval: question.correct(r.answer),
              memoryPlusLog: question.correct(ml.answer),
              memoryAnswer: m.answer,
              fullContextAnswer: f.answer,
              retrievalAnswer: r.answer,
              memoryPlusLogAnswer: ml.answer,
              memoryLines: fromMemory,
              memoryTokens: m.promptTokens,
              fullContextTokens: f.promptTokens,
              retrievalTokens: r.promptTokens,
              memoryPlusLogTokens: ml.promptTokens,
            });
          }
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

const summary: Record<string, { questions: number; memory: number; fullContext: number; retrieval: number; memoryPlusLog: number; memoryTokens: number; fullContextTokens: number; retrievalTokens: number; memoryPlusLogTokens: number }> = {};
for (const row of rows) {
  const s = (summary[`${row.instruction}/${row.family}`] ??= { questions: 0, memory: 0, fullContext: 0, retrieval: 0, memoryPlusLog: 0, memoryTokens: 0, fullContextTokens: 0, retrievalTokens: 0, memoryPlusLogTokens: 0 });
  s.questions += 1;
  s.memory += row.memory ? 1 : 0;
  s.fullContext += row.fullContext ? 1 : 0;
  s.retrieval += row.retrieval ? 1 : 0;
  s.memoryPlusLog += row.memoryPlusLog ? 1 : 0;
  s.memoryTokens += row.memoryTokens;
  s.fullContextTokens += row.fullContextTokens;
  s.retrievalTokens += row.retrievalTokens;
  s.memoryPlusLogTokens += row.memoryPlusLogTokens;
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ model: chatModel, topK: TOP_K, histories: selected.length, messagesPerHistory: selected[0]?.entries.length ?? 0, summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary));
