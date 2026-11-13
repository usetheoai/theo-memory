/**
 * Live baseline of the update decision: for each pair of `pairs.json`, the first note is written
 * at its date and the second at its later date, through the real write path (`remember`,
 * `infer: true`), in a scope of its own. The decision under test is whatever the write path does:
 * the first note counts as ended when the second write reports that it replaced a memory of the first.
 *
 * The store is in memory and the embedder is a constant stub, so the one existing memory is always
 * shown to the extractor; nothing here measures retrieval.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (optional), OPENAI_CHAT_MODEL,
 * UPDATE_DECISION_OUTPUT (report path), UPDATE_DECISION_REPETITIONS (default 3),
 * UPDATE_DECISION_CONCURRENCY (default 4).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalMemory, InMemoryVectorStore } from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import { summarizeDecisions, type UpdatePair } from './scoring.js';

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
  readonly id: string;
  readonly label: string;
  readonly language: string;
  readonly repetition: number;
  /** Memories the first note produced, and how many of them were no longer current after the second note. */
  readonly storedA: number;
  readonly endedA: number;
  /** Memories of the first note stored with an expiry, as a passing state. */
  readonly expiringA: number;
  readonly storedB: number;
  readonly ended: boolean;
}

const outputPath = requiredEnv('UPDATE_DECISION_OUTPUT');
requiredEnv('OPENAI_API_KEY');
const model = requiredEnv('OPENAI_CHAT_MODEL');
const repetitions = positiveInteger('UPDATE_DECISION_REPETITIONS', 3);
const concurrency = positiveInteger('UPDATE_DECISION_CONCURRENCY', 4);
const here = dirname(fileURLToPath(import.meta.url));
const pairs = JSON.parse(readFileSync(resolve(here, 'pairs.json'), 'utf8')) as UpdatePair[];

async function runOne(pair: UpdatePair, repetition: number): Promise<Row> {
  const memory = await createLocalMemory({
    vectorStore: new InMemoryVectorStore(),
    embedder: { embed: async () => [1, 0, 0], embedBatch: async (texts) => texts.map(() => [1, 0, 0]) },
    llm: new OpenAILLM(),
    embeddingDim: 3,
    entityBoost: false,
  });
  try {
    const scope = memory.user(`update-decision-${pair.id}-${repetition}`);
    const first = await scope.remember(pair.textA, { observedAt: new Date(`${pair.dateA}T12:00:00Z`) });
    const second = await scope.remember(pair.textB, { observedAt: new Date(`${pair.dateB}T12:00:00Z`) });
    // Ended means superseded: the second write reports the memories it replaced. Reading the
    // first memory back does not work for this, because a superseded memory is no longer returned.
    // A note stored as a passing state has an expiry of its own and is counted apart, since no
    // decision about the pair produced it.
    const firstIds = new Set(first.map((item) => item.id));
    const replaced = new Set(second.flatMap((item) => item.supersedes ?? []).filter((id) => firstIds.has(id)));
    const endedA = replaced.size;
    const expiringA = first.filter((item) => item.expiresAt !== undefined && item.expiresAt !== null).length;
    return {
      id: pair.id, label: pair.label, language: pair.language, repetition,
      storedA: first.length, endedA, expiringA, storedB: second.length, ended: endedA > 0,
    };
  } finally {
    await memory.dispose();
  }
}

const jobs = pairs.flatMap((pair) => Array.from({ length: repetitions }, (_, repetition) => ({ pair, repetition })));
const rows: Row[] = [];
let cursor = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (let index = cursor++; index < jobs.length; index = cursor++) {
    const job = jobs[index] as (typeof jobs)[number];
    rows.push(await runOne(job.pair, job.repetition));
  }
}));
rows.sort((a, b) => a.id.localeCompare(b.id) || a.repetition - b.repetition);

const summaries = Array.from({ length: repetitions }, (_, repetition) =>
  summarizeDecisions(pairs, new Map(rows.filter((row) => row.repetition === repetition).map((row) => [row.id, row.ended]))));
const report = { model, repetitions, pairs: pairs.length, summaries, rows };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({
  found: summaries.map((s) => `${s.found.count}/${s.found.of}`),
  wronglyEnded: summaries.map((s) => `${s.wronglyEnded.count}/${s.wronglyEnded.of}`),
  output: outputPath,
}));
