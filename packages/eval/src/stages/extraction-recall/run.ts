/**
 * Live extraction-recall evaluation: runs the real write pipeline on one message per case,
 * three repetitions, and scores with `scoring.ts` whether each value the author states about
 * themself was stored.
 *
 * The cases were drawn by a seeded generator and written for this evaluation. Embeddings are a
 * constant stub and each case gets an empty in-memory store.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (optional, e.g. a cost proxy),
 * OPENAI_CHAT_MODEL (default gpt-4o-mini), EXTRACTION_RECALL_OUTPUT (report path),
 * EXTRACTION_RECALL_CASES (`cases.json`, the development set, or `cases-held-out.json`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalMemory, InMemoryVectorStore, MemoryStoreError } from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';
import { z } from 'zod';

import { ExtractionRecallCaseSchema, scoreExtractionRecallCase, type ExtractionRecallCase, type ValueScore } from './scoring.js';

const REPETITIONS = 3;
const CONCURRENCY = 6;
const here = dirname(fileURLToPath(import.meta.url));
const cases = z.array(ExtractionRecallCaseSchema).parse(JSON.parse(readFileSync(resolve(here, process.env['EXTRACTION_RECALL_CASES'] ?? 'cases.json'), 'utf8')));
if (process.env['OPENAI_API_KEY'] === undefined) throw new Error('OPENAI_API_KEY must be set for the live evaluation');

interface Row {
  readonly id: string;
  readonly shape: string;
  readonly language: string;
  readonly repetition: number;
  /** The write threw because the extraction response was invalid. */
  readonly failed: boolean;
  readonly facts: readonly string[];
  /** The stored facts that end with the day they were said. */
  readonly expiring: readonly string[];
  readonly values: readonly ValueScore[];
}

async function write(fixture: ExtractionRecallCase): Promise<{ facts: readonly string[]; expiring: readonly string[] }> {
  const memory = await createLocalMemory({
    vectorStore: new InMemoryVectorStore(),
    embedder: { embed: async () => [1, 0, 0], embedBatch: async (texts) => texts.map(() => [1, 0, 0]) },
    llm: new OpenAILLM(),
    embeddingDim: 3,
    entityBoost: false,
  });
  try {
    const items = await memory.user('extraction-recall').rememberMessages([{ role: 'user', content: fixture.text }], { strictExtraction: true });
    return { facts: items.map((item) => item.text), expiring: items.filter((item) => item.expiresAt !== undefined && item.expiresAt !== null).map((item) => item.text) };
  } finally {
    await memory.dispose();
  }
}

const rows: Row[] = [];
for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
  const queue = [...cases];
  const worker = async (): Promise<void> => {
    for (let fixture = queue.shift(); fixture !== undefined; fixture = queue.shift()) {
      let failed = false;
      const { facts, expiring } = await write(fixture).catch((error: unknown) => {
        if (!(error instanceof MemoryStoreError)) throw error;
        failed = true;
        return { facts: [], expiring: [] };
      });
      rows.push({ id: fixture.id, shape: fixture.shape, language: fixture.language, repetition, failed, facts, expiring, values: scoreExtractionRecallCase(fixture, facts) });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[extraction-recall] repetition ${String(repetition + 1)}/${String(REPETITIONS)} done`);
}

const byShape: Record<string, { values: number; correct: number; writes: number; empty: number; failed: number }> = {};
for (const row of rows) {
  const s = (byShape[row.shape] ??= { values: 0, correct: 0, writes: 0, empty: 0, failed: 0 });
  s.values += row.values.length;
  s.correct += row.values.filter((value) => value.correct).length;
  s.writes += 1;
  s.empty += row.facts.length === 0 ? 1 : 0;
  s.failed += row.failed ? 1 : 0;
}
const output = resolve(process.env['EXTRACTION_RECALL_OUTPUT'] ?? resolve(here, '../../../../../benchmarks/results/extraction-recall.json'));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ model: process.env['OPENAI_CHAT_MODEL'] ?? 'gpt-4o-mini', repetitions: REPETITIONS, byShape, rows }, null, 2)}\n`);
console.log(JSON.stringify(byShape));
