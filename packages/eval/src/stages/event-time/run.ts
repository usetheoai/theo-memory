/**
 * Live event-time evaluation (ADR-0035, stage 1): writes each sentence of `cases.json` through
 * the real write path (`remember`, `infer: true`) at its `observedAt`, and checks whether what was
 * stored carries the date the sentence meant. Each case gets an empty in-memory store and a
 * constant stub embedder: nothing here measures recall.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (optional, e.g. a cost proxy), OPENAI_CHAT_MODEL,
 * EVENT_TIME_OUTPUT (report path), EVENT_TIME_REPETITIONS (default 3), EVENT_TIME_CONCURRENCY
 * (default 4).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalMemory, InMemoryVectorStore } from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import type { EventTimeCase } from './cases.js';
import { classifyEventTime, type EventTimeOutcome } from './scoring.js';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got '${raw}'`);
  return value;
}

interface Row {
  readonly name: string;
  readonly language: string;
  readonly kind: string;
  readonly tense: string;
  readonly repetition: number;
  readonly expected: string;
  readonly outcome: EventTimeOutcome;
  readonly stored: readonly string[];
}

const outputPath = requiredEnv('EVENT_TIME_OUTPUT');
requiredEnv('OPENAI_API_KEY');
const model = requiredEnv('OPENAI_CHAT_MODEL');
const repetitions = positiveInteger('EVENT_TIME_REPETITIONS', 3);
const concurrency = positiveInteger('EVENT_TIME_CONCURRENCY', 4);
const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(resolve(here, 'cases.json'), 'utf8')) as EventTimeCase[];

async function runOne(fixture: EventTimeCase, repetition: number): Promise<Row> {
  const memory = await createLocalMemory({
    vectorStore: new InMemoryVectorStore(),
    embedder: { embed: async () => [1, 0, 0], embedBatch: async (texts) => texts.map(() => [1, 0, 0]) },
    llm: new OpenAILLM(),
    embeddingDim: 3,
    entityBoost: false,
  });
  try {
    const items = await memory.user(`event-time-${fixture.name}-${repetition}`).remember(fixture.text, { observedAt: new Date(fixture.observedAt) });
    const stored = items.map((item) => item.text);
    return {
      name: fixture.name, language: fixture.language, kind: fixture.kind, tense: fixture.tense,
      repetition, expected: fixture.expected, outcome: classifyEventTime(stored, fixture.expected), stored,
    };
  } finally {
    await memory.dispose();
  }
}

const jobs = cases.flatMap((fixture) => Array.from({ length: repetitions }, (_, repetition) => ({ fixture, repetition })));
const rows: Row[] = [];
let cursor = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (let index = cursor++; index < jobs.length; index = cursor++) {
    const job = jobs[index] as (typeof jobs)[number];
    rows.push(await runOne(job.fixture, job.repetition));
  }
}));
rows.sort((a, b) => a.name.localeCompare(b.name) || a.repetition - b.repetition);

function tally(key: (row: Row) => string): Record<string, Record<EventTimeOutcome, number>> {
  const result: Record<string, Record<EventTimeOutcome, number>> = {};
  for (const row of rows) {
    const bucket = (result[key(row)] ??= { correct: 0, 'wrong-date': 0, undated: 0, 'not-stored': 0 });
    bucket[row.outcome] += 1;
  }
  return result;
}

const report = {
  model, repetitions, cases: cases.length,
  overall: tally(() => 'all')['all'],
  byKind: tally((row) => row.kind),
  byLanguage: tally((row) => row.language),
  byTense: tally((row) => row.tense),
  rows,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ overall: report.overall, byTense: report.byTense, output: outputPath }));
