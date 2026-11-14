/**
 * Live update-history run: a person's history of some three dozen dated messages is written
 * through the real write path, and for each question of the history the stage records what
 * recall returns. The histories carry chains of two to four values of one attribute, the same
 * attribute of a relative said in between, an attribute of the relative that changes once, and
 * facts that never change.
 *
 * The stage only writes and recalls. A reader outside the stage answers from the recorded lines,
 * so the same reader can be given what another system returns for the same history.
 *
 * `UPDATE_HISTORY_SUPERSEDE=0` turns supersession on write off, which leaves every value current.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (chat calls, e.g. a cost proxy), THEOMEM_PG_URI,
 * UPDATE_HISTORY_OUTPUT (path), UPDATE_HISTORY_DB (default themem_update_history; dropped and
 * recreated), UPDATE_HISTORY_SUPERSEDE (default 1), UPDATE_HISTORY_PEOPLE (optional cap, for a
 * smoke run), UPDATE_HISTORY_REPETITIONS (default 3).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { z } from 'zod';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { OpenAICompatibleEmbedder } from '@usetheo/memory/embedders/openai-compatible';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

const TOP_K = 5;
const CONCURRENCY = 4;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

const HistorySchema = z
  .object({
    id: z.string().min(1),
    language: z.enum(['en', 'pt']),
    messages: z.array(z.object({ id: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), kind: z.string().min(1), text: z.string().min(1) }).strict()).min(1),
    questions: z.array(z.object({
      kind: z.enum(['own-current', 'relative-same-attribute', 'relative-current', 'stable']),
      chain: z.number().int().positive().optional(),
      question: z.string().min(1),
      expected: z.string().min(1),
      notExpected: z.array(z.string().min(1)),
    }).strict()).min(1),
  })
  .strict();
type History = z.infer<typeof HistorySchema>;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const here = dirname(fileURLToPath(import.meta.url));
const apiKey = requiredEnv('OPENAI_API_KEY');
const output = resolve(requiredEnv('UPDATE_HISTORY_OUTPUT'));
const dbName = process.env['UPDATE_HISTORY_DB'] ?? 'themem_update_history';
if (!/^[a-z_][a-z0-9_]*$/u.test(dbName)) throw new Error(`UPDATE_HISTORY_DB must be a plain identifier, got '${dbName}'`);
const supersede = process.env['UPDATE_HISTORY_SUPERSEDE'] !== '0';
const repetitions = Number(process.env['UPDATE_HISTORY_REPETITIONS'] ?? '3');
const cap = process.env['UPDATE_HISTORY_PEOPLE'];
const all = z.array(HistorySchema).parse(JSON.parse(readFileSync(resolve(here, 'histories.json'), 'utf8')));
const histories = cap === undefined || cap === '' ? all : all.slice(0, Number(cap));

interface Row {
  readonly person: string;
  readonly language: string;
  readonly repetition: number;
  readonly question: number;
  readonly kind: string;
  /** What recall returned for the question, one line per memory with the day it was said. */
  readonly recalled: readonly string[];
  /** Memories of the scope that were current and that had been ended when the question was asked. */
  readonly current: number;
  readonly ended: number;
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
const day = (instant: Date): string => instant.toISOString().slice(0, 10);
try {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await runMigrations(pool, { embeddingDim: EMBEDDING_DIM });
  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM }),
    embedder: new OpenAICompatibleEmbedder({ apiKey, baseUrl: 'https://api.openai.com/v1', model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIM }),
    llm: new OpenAILLM(),
    embeddingDim: EMBEDDING_DIM,
    supersedeOnWrite: supersede,
  });
  const one = async (history: History, repetition: number): Promise<void> => {
    const user = `${history.id}-r${String(repetition)}`;
    const scope = memory.user(user);
    for (const message of history.messages) {
      await scope.rememberMessages([{ role: 'user', content: message.text }], { observedAt: new Date(`${message.date}T12:00:00Z`) });
    }
    const counts = await pool.query<{ current: string; ended: string }>(
      'SELECT count(*) FILTER (WHERE t_invalid IS NULL) AS current, count(*) FILTER (WHERE t_invalid IS NOT NULL) AS ended FROM memories WHERE user_id = $1',
      [user],
    );
    for (const [index, question] of history.questions.entries()) {
      const hits = await scope.recall(question.question, { topK: TOP_K });
      rows.push({
        person: history.id, language: history.language, repetition, question: index, kind: question.kind,
        recalled: hits.map((hit) => `- ${hit.text} (said on ${day(hit.tValid ?? new Date())})`),
        current: Number(counts.rows[0]?.current ?? 0), ended: Number(counts.rows[0]?.ended ?? 0),
      });
    }
  };
  try {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const queue = [...histories];
      const worker = async (): Promise<void> => {
        for (let history = queue.shift(); history !== undefined; history = queue.shift()) await one(history, repetition);
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      console.log(`[update-history] repetition ${String(repetition + 1)}/${String(repetitions)} done`);
    }
  } finally {
    await memory.dispose();
  }
} finally {
  await pool.end();
}
rows.sort((a, b) => a.person.localeCompare(b.person) || a.repetition - b.repetition || a.question - b.question);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ system: supersede ? 'theo-memory' : 'theo-memory, supersession on write off', topK: TOP_K, rows }, null, 1)}\n`);
console.log(JSON.stringify({ rows: rows.length, output }));
