/**
 * Live stale-state evaluation: a month after a person stated a lasting fact, something that goes
 * on for weeks and a wish of the moment, what does a reader answer from what recall returns?
 *
 * Each case is one person and three sentences said on the same day, thirty days before the
 * questions. Four questions follow: about the lasting fact, about the ongoing matter, whether
 * the wish of the moment holds right now, and what the wish was a month ago. A lasting fact that
 * was stored to expire is not recalled; a wish that recall shows as if it were current is
 * affirmed. The run writes through the real pipeline and reads with one model.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (chat calls, e.g. a cost proxy),
 * OPENAI_CHAT_MODEL (default gpt-4o-mini), THEOMEM_PG_URI, STALE_STATE_OUTPUT (path),
 * STALE_STATE_DB (default themem_stale_state; dropped and recreated), STALE_STATE_CROWDED (`1`
 * adds ten lasting statements about food, music and daily life to each person, said on the same
 * day, so the top five is contested, and asks one more question about one of them).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { z } from 'zod';

import { createLocalMemory, PgvectorStore, runMigrations, type MemoryItem } from '@usetheo/memory';
import { OpenAICompatibleEmbedder } from '@usetheo/memory/embedders/openai-compatible';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import { carries } from '../recalled-value/scoring.js';

const TOP_K = 5;
const REPETITIONS = 3;
const CONCURRENCY = 8;
const DAYS_BEFORE = 30;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

const StatedSchema = z.object({ text: z.string().min(1), value: z.string().min(1), question: z.string().min(1) }).strict();
const CaseSchema = z
  .object({
    id: z.string().min(1),
    language: z.enum(['en', 'pt']),
    lasting: StatedSchema,
    ongoing: StatedSchema,
    /** `question` asks whether the wish holds right now; `pastQuestion` asks what it was a month ago. */
    state: StatedSchema.extend({ pastQuestion: z.string().min(1) }).strict(),
  })
  .strict();
type Case = z.infer<typeof CaseSchema>;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const here = dirname(fileURLToPath(import.meta.url));
const apiKey = requiredEnv('OPENAI_API_KEY');
const chatBase = process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';
const chatModel = process.env['OPENAI_CHAT_MODEL'] ?? 'gpt-4o-mini';
const output = resolve(requiredEnv('STALE_STATE_OUTPUT'));
const dbName = process.env['STALE_STATE_DB'] ?? 'themem_stale_state';
if (!/^[a-z_][a-z0-9_]*$/u.test(dbName)) throw new Error(`STALE_STATE_DB must be a plain identifier, got '${dbName}'`);
const cases = z.array(CaseSchema).parse(JSON.parse(readFileSync(resolve(here, 'cases.json'), 'utf8')));

const crowded = process.env['STALE_STATE_CROWDED'] === '1';

/** Lasting statements that compete for the top five. `{dish}` and `{music}` never repeat the person's wish. */
const CROWD = {
  en: {
    dishes: ['spinach lasagne', 'grilled sardines', 'black bean stew', 'potato gratin', 'chicken curry'],
    music: ['baroque concertos', 'reggae', 'folk ballads', 'electronic ambient'],
    lines: [
      'My favourite dish is {dish}.',
      'I am allergic to peanuts.',
      'I cook for my family every Sunday.',
      'I never drink coffee after lunch.',
      'I have been a volunteer firefighter for ten years.',
      'My favourite kind of music is {music}.',
      'I play the clarinet in a community band.',
      'I walk to work every day.',
      'I have two cats.',
      'I keep a small herb garden on the balcony.',
    ],
    question: 'What is my favourite dish?',
  },
  pt: {
    dishes: ['lasanha de espinafre', 'sardinha grelhada', 'feijão tropeiro', 'batata gratinada', 'frango ao curry'],
    music: ['concertos barrocos', 'reggae', 'modinhas', 'música ambiente eletrônica'],
    lines: [
      'Meu prato preferido é {dish}.',
      'Tenho alergia a amendoim.',
      'Cozinho para a família todo domingo.',
      'Nunca tomo café depois do almoço.',
      'Sou bombeiro voluntário há dez anos.',
      'Meu tipo de música preferido é {music}.',
      'Toco clarinete numa banda comunitária.',
      'Vou a pé para o trabalho todos os dias.',
      'Tenho dois gatos.',
      'Mantenho uma hortinha de temperos na varanda.',
    ],
    question: 'Qual é o meu prato preferido?',
  },
} as const;

function crowdOf(fixture: Case, index: number): { readonly lines: readonly string[]; readonly dish: string; readonly question: string } {
  const set = CROWD[fixture.language];
  const free = (options: readonly string[]): string => {
    const usable = options.filter((option) => !carries(fixture.state.text, option));
    return usable[index % usable.length] as string;
  };
  const dish = free(set.dishes);
  const music = free(set.music);
  return { lines: set.lines.map((line) => line.replace('{dish}', dish).replace('{music}', music)), dish, question: set.question };
}

const today = new Date();
const said = new Date(today.getTime() - DAYS_BEFORE * 86_400_000);
const day = (instant: Date): string => instant.toISOString().slice(0, 10);

const ANSWER_INSTRUCTION =
  `You answer a question the user asks about themself, using only the notes given. Each note carries the date it was said. Today is ${day(today)}. ` +
  'Reply with the shortest exact answer, as it is written in the notes. If the notes do not say, reply exactly: unknown.';
const NOW_INSTRUCTION =
  `You answer a question the user asks about themself, using only the notes given. Each note carries the date it was said. Today is ${day(today)}. ` +
  'Reply with a single letter and nothing else. ' +
  'A: yes, the notes say this holds today. B: the notes only say it held on an earlier date. C: the notes say nothing about it.';

const ChatSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1) });

async function read(instruction: string, question: string, lines: readonly string[]): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${chatBase}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: chatModel,
        temperature: 0,
        max_tokens: 40,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: `Notes:\n${lines.length === 0 ? '(none)' : lines.join('\n')}\n\nQuestion: ${question}` },
        ],
      }),
    });
    if (response.ok) return ChatSchema.parse(await response.json()).choices[0]?.message.content ?? '';
    if (attempt === 2) throw new Error(`reader call failed with status ${String(response.status)}`);
  }
}

interface Row {
  readonly id: string;
  readonly language: string;
  readonly repetition: number;
  /** Stored facts that carry each value, and how many of them end with the day. */
  readonly stored: { readonly lasting: number; readonly ongoing: number; readonly state: number };
  readonly expiring: { readonly lasting: number; readonly ongoing: number; readonly state: number };
  readonly lastingCorrect: boolean;
  readonly ongoingCorrect: boolean;
  /** The reader said the wish of a month ago holds today. */
  readonly stateAffirmedNow: boolean;
  /** A recalled line carried the wish when the reader was asked whether it holds today. */
  readonly stateShownNow: boolean;
  readonly statePastCorrect: boolean;
  /** Crowded runs only: the question about a lasting statement of the crowd was answered. */
  readonly crowdCorrect?: boolean;
  readonly answers: { readonly lasting: string; readonly ongoing: string; readonly now: string; readonly past: string };
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
  const one = async (fixture: Case, repetition: number): Promise<void> => {
    const scope = memory.user(`${fixture.id}-r${String(repetition)}`);
    const items: MemoryItem[] = [];
    const crowd = crowded ? crowdOf(fixture, Number(fixture.id.replace(/\D/gu, ''))) : undefined;
    // The three statements of the case are spread among the crowd, in a fixed order.
    const contents = crowd === undefined
      ? [fixture.lasting.text, fixture.ongoing.text, fixture.state.text]
      : [...crowd.lines.slice(0, 3), fixture.lasting.text, ...crowd.lines.slice(3, 6), fixture.ongoing.text, ...crowd.lines.slice(6, 8), fixture.state.text, ...crowd.lines.slice(8)];
    for (const content of contents) {
      items.push(...(await scope.rememberMessages([{ role: 'user', content }], { observedAt: said })));
    }
    const having = (value: string) => items.filter((item) => carries(item.text, value));
    const ending = (value: string) => having(value).filter((item) => item.expiresAt !== undefined && item.expiresAt !== null).length;
    const lines = async (question: string): Promise<string[]> => {
      const hits = await scope.recall(question, { topK: TOP_K, includeSources: true });
      const facts = hits.map((hit) => `- ${hit.text} (said on ${day(hit.tValid ?? said)}${hit.durability === undefined ? '' : `; ${hit.durability}`})`);
      const sources = [...new Set(hits.flatMap((hit) => (hit.sources ?? []).map((s) => `- [${day(s.observedAt ?? said)}] ${s.content}`)))];
      return sources.length === 0 ? facts : [...facts, '', 'What the user wrote, from which the notes above were taken:', ...sources];
    };
    const nowLines = await lines(fixture.state.question);
    const [lasting, ongoing, now, past] = await Promise.all([
      read(ANSWER_INSTRUCTION, fixture.lasting.question, await lines(fixture.lasting.question)),
      read(ANSWER_INSTRUCTION, fixture.ongoing.question, await lines(fixture.ongoing.question)),
      read(NOW_INSTRUCTION, fixture.state.question, nowLines),
      read(ANSWER_INSTRUCTION, fixture.state.pastQuestion, await lines(fixture.state.pastQuestion)),
    ]);
    const crowdAnswer = crowd === undefined ? undefined : await read(ANSWER_INSTRUCTION, crowd.question, await lines(crowd.question));
    rows.push({
      id: fixture.id,
      language: fixture.language,
      repetition,
      stored: { lasting: having(fixture.lasting.value).length, ongoing: having(fixture.ongoing.value).length, state: having(fixture.state.value).length },
      expiring: { lasting: ending(fixture.lasting.value), ongoing: ending(fixture.ongoing.value), state: ending(fixture.state.value) },
      lastingCorrect: carries(lasting, fixture.lasting.value),
      ongoingCorrect: carries(ongoing, fixture.ongoing.value),
      stateAffirmedNow: /^\s*A\b/iu.test(now),
      stateShownNow: nowLines.some((line) => carries(line, fixture.state.value)),
      statePastCorrect: carries(past, fixture.state.value),
      ...(crowd === undefined || crowdAnswer === undefined ? {} : { crowdCorrect: carries(crowdAnswer, crowd.dish) }),
      answers: { lasting, ongoing, now, past },
    });
  };
  try {
    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
      const queue = [...cases];
      const worker = async (): Promise<void> => {
        for (let fixture = queue.shift(); fixture !== undefined; fixture = queue.shift()) await one(fixture, repetition);
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      console.log(`[stale-state] repetition ${String(repetition + 1)}/${String(REPETITIONS)} done`);
    }
  } finally {
    await memory.dispose();
  }
} finally {
  await pool.end();
}

const count = (pick: (row: Row) => boolean): number => rows.filter(pick).length;
const summary = {
  runs: rows.length,
  lastingCorrect: count((row) => row.lastingCorrect),
  ongoingCorrect: count((row) => row.ongoingCorrect),
  stateAffirmedNow: count((row) => row.stateAffirmedNow),
  stateShownNow: count((row) => row.stateShownNow),
  statePastCorrect: count((row) => row.statePastCorrect),
  lastingExpiring: count((row) => row.expiring.lasting > 0),
  ongoingExpiring: count((row) => row.expiring.ongoing > 0),
  stateExpiring: count((row) => row.expiring.state > 0),
  crowdCorrect: count((row) => row.crowdCorrect === true),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ model: chatModel, repetitions: REPETITIONS, daysBefore: DAYS_BEFORE, crowded, summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary));
