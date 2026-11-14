/**
 * Live reference-material evaluation: runs the real write pipeline on a request sent together
 * with pasted material, three repetitions per case, and scores what was stored with
 * `scoring.ts`.
 *
 * The cases were drawn by a seeded generator and written for this evaluation. Embeddings are a
 * constant stub and each case gets an empty in-memory store.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (optional, e.g. a cost proxy),
 * OPENAI_CHAT_MODEL (default gpt-4o-mini), REFERENCE_MATERIAL_OUTPUT (report path),
 * REFERENCE_MATERIAL_CASES (`cases.json`, the development set, or `cases-held-out.json`),
 * REFERENCE_MATERIAL_AS (`inline`, the default: request and material in one message, as a
 * caller without the mark sends them; `reference`: the material in its own message, marked).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalMemory, InMemoryVectorStore, MemoryStoreError } from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';
import { z } from 'zod';

import { ReferenceCaseSchema, scoreReferenceCase, type ReferenceCase, type ReferenceScore } from './scoring.js';

const REPETITIONS = 3;
const CONCURRENCY = 6;
const here = dirname(fileURLToPath(import.meta.url));
const cases = z.array(ReferenceCaseSchema).parse(JSON.parse(readFileSync(resolve(here, process.env['REFERENCE_MATERIAL_CASES'] ?? 'cases.json'), 'utf8')));
if (process.env['OPENAI_API_KEY'] === undefined) throw new Error('OPENAI_API_KEY must be set for the live evaluation');
const sendAs = process.env['REFERENCE_MATERIAL_AS'] ?? 'inline';
if (sendAs !== 'inline' && sendAs !== 'reference') throw new Error('REFERENCE_MATERIAL_AS must be `inline` or `reference`');

interface Row extends ReferenceScore {
  readonly id: string;
  readonly family: string;
  readonly language: string;
  readonly repetition: number;
  /** The write threw because the extraction response was invalid. */
  readonly failed: boolean;
  readonly facts: readonly string[];
}

async function write(fixture: ReferenceCase): Promise<readonly string[]> {
  const memory = await createLocalMemory({
    vectorStore: new InMemoryVectorStore(),
    embedder: { embed: async () => [1, 0, 0], embedBatch: async (texts) => texts.map(() => [1, 0, 0]) },
    llm: new OpenAILLM(),
    embeddingDim: 3,
    entityBoost: false,
  });
  try {
    const messages =
      sendAs === 'reference'
        ? [{ role: 'user' as const, content: fixture.request }, { role: 'user' as const, content: fixture.material, reference: true }]
        : [{ role: 'user' as const, content: `${fixture.request}\n${fixture.material}` }];
    const items = await memory.user('reference-material').rememberMessages(messages, { strictExtraction: true });
    return items.map((item) => item.text);
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
      const facts = await write(fixture).catch((error: unknown) => {
        if (!(error instanceof MemoryStoreError)) throw error;
        failed = true;
        return [];
      });
      rows.push({ id: fixture.id, family: fixture.family, language: fixture.language, repetition, failed, facts, ...scoreReferenceCase(fixture, facts) });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[reference-material] repetition ${String(repetition + 1)}/${String(REPETITIONS)} done`);
}

const byFamily: Record<string, { writes: number; stored: number; storedAboutUser: number; facts: number; failed: number }> = {};
for (const row of rows) {
  const f = (byFamily[row.family] ??= { writes: 0, stored: 0, storedAboutUser: 0, facts: 0, failed: 0 });
  f.writes += 1;
  f.stored += row.stored ? 1 : 0;
  f.storedAboutUser += row.storedAboutUser ? 1 : 0;
  f.facts += row.facts.length;
  f.failed += row.failed ? 1 : 0;
}
const output = resolve(process.env['REFERENCE_MATERIAL_OUTPUT'] ?? resolve(here, '../../../../../benchmarks/results/reference-material.json'));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ sendAs, model: process.env['OPENAI_CHAT_MODEL'] ?? 'gpt-4o-mini', repetitions: REPETITIONS, byFamily, rows }, null, 2)}\n`);
console.log(JSON.stringify(byFamily));
