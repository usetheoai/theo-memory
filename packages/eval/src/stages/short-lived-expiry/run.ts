/**
 * Live short-lived-expiry evaluation: which statements are stored with an end at the close of
 * the day they were said?
 *
 * Each case is one first-person sentence of one kind: a state the sentence ties to the day or
 * the moment, a state with no such word, a habit, or something that goes on for weeks. The run
 * writes each through the real pipeline, three repetitions, and counts the writes that stored a
 * fact and the writes in which a stored fact expires. A habit or an ongoing matter that expires
 * is lost on the next day; a state of the day that does not expire stays as if it still held.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (optional, e.g. a cost proxy),
 * OPENAI_CHAT_MODEL (default gpt-4o-mini), SHORT_LIVED_EXPIRY_OUTPUT (report path).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalMemory, InMemoryVectorStore, MemoryStoreError } from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';
import { z } from 'zod';

const FAMILIES = ['state-with-day-marker', 'state-without-marker', 'habit', 'ongoing-for-weeks'] as const;
const CaseSchema = z.object({ id: z.string().min(1), language: z.enum(['en', 'pt']), family: z.enum(FAMILIES), text: z.string().min(1) }).strict();
type Case = z.infer<typeof CaseSchema>;

const REPETITIONS = 3;
const CONCURRENCY = 6;
const here = dirname(fileURLToPath(import.meta.url));
const cases = z.array(CaseSchema).parse(JSON.parse(readFileSync(resolve(here, 'cases.json'), 'utf8')));
if (process.env['OPENAI_API_KEY'] === undefined) throw new Error('OPENAI_API_KEY must be set for the live evaluation');

interface Row {
  readonly id: string;
  readonly family: string;
  readonly language: string;
  readonly repetition: number;
  /** The write threw because the extraction response was invalid. */
  readonly failed: boolean;
  readonly facts: number;
  readonly expiring: number;
}

async function write(fixture: Case): Promise<{ facts: number; expiring: number }> {
  const memory = await createLocalMemory({
    vectorStore: new InMemoryVectorStore(),
    embedder: { embed: async () => [1, 0, 0], embedBatch: async (texts) => texts.map(() => [1, 0, 0]) },
    llm: new OpenAILLM(),
    embeddingDim: 3,
    entityBoost: false,
  });
  try {
    const items = await memory.user('short-lived-expiry').rememberMessages([{ role: 'user', content: fixture.text }], { strictExtraction: true });
    return { facts: items.length, expiring: items.filter((item) => item.expiresAt !== undefined && item.expiresAt !== null).length };
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
      const stored = await write(fixture).catch((error: unknown) => {
        if (!(error instanceof MemoryStoreError)) throw error;
        failed = true;
        return { facts: 0, expiring: 0 };
      });
      rows.push({ id: fixture.id, family: fixture.family, language: fixture.language, repetition, failed, ...stored });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[short-lived-expiry] repetition ${String(repetition + 1)}/${String(REPETITIONS)} done`);
}

const byFamily: Record<string, { writes: number; stored: number; expiring: number; failed: number }> = {};
for (const row of rows) {
  const f = (byFamily[row.family] ??= { writes: 0, stored: 0, expiring: 0, failed: 0 });
  f.writes += 1;
  f.stored += row.facts > 0 ? 1 : 0;
  f.expiring += row.expiring > 0 ? 1 : 0;
  f.failed += row.failed ? 1 : 0;
}
const output = resolve(process.env['SHORT_LIVED_EXPIRY_OUTPUT'] ?? resolve(here, '../../../../../benchmarks/results/short-lived-expiry.json'));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ model: process.env['OPENAI_CHAT_MODEL'] ?? 'gpt-4o-mini', repetitions: REPETITIONS, byFamily, rows }, null, 2)}\n`);
console.log(JSON.stringify(byFamily));
