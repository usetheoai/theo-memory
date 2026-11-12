/**
 * Live extraction-fidelity evaluation: runs the real write pipeline (`rememberMessages`,
 * `infer: true`) with the configured OpenAI-compatible model on hand-written conversation
 * turns, three repetitions per case, and scores them with `scoring.ts`.
 *
 * The cases are written for this evaluation and share no text with any benchmark dataset.
 * Embeddings are a constant stub: nothing here measures recall, and each case gets an empty
 * in-memory store, so similarity never selects existing memories.
 *
 * Environment: OPENAI_API_KEY, OPENAI_BASE_URL (optional, e.g. a cost proxy),
 * OPENAI_CHAT_MODEL (default gpt-4o-mini), FIDELITY_OUTPUT (report path).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalMemory, InMemoryVectorStore } from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';
import { z } from 'zod';

import { FidelityCaseSchema, scoreFidelityCase, type FidelityScore } from './scoring.js';

const REPETITIONS = 3;
const here = dirname(fileURLToPath(import.meta.url));
const cases = z.array(FidelityCaseSchema).parse(JSON.parse(readFileSync(resolve(here, 'golden.json'), 'utf8')));
if (process.env['OPENAI_API_KEY'] === undefined) throw new Error('OPENAI_API_KEY must be set for the live evaluation');

interface Row extends FidelityScore {
  readonly name: string;
  readonly family: string;
  readonly repetition: number;
  readonly texts: readonly string[];
}

const rows: Row[] = [];
for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
  for (const fixture of cases) {
    const memory = await createLocalMemory({
      vectorStore: new InMemoryVectorStore(),
      embedder: { embed: async () => [1, 0, 0], embedBatch: async (texts) => texts.map(() => [1, 0, 0]) },
      llm: new OpenAILLM(),
      embeddingDim: 3,
      entityBoost: false,
    });
    try {
      const items = await memory.user('fidelity').rememberMessages(fixture.messages, { strictExtraction: true });
      const texts = items.map((item) => item.text);
      rows.push({ name: fixture.name, family: fixture.family, repetition, texts, ...scoreFidelityCase(fixture, texts) });
    } finally {
      await memory.dispose();
    }
  }
  console.log(`[fidelity] repetition ${String(repetition + 1)}/${String(REPETITIONS)} done`);
}

const byFamily: Record<string, { runs: number; passed: number; facts: number }> = {};
for (const row of rows) {
  const f = (byFamily[row.family] ??= { runs: 0, passed: 0, facts: 0 });
  f.runs += 1;
  f.passed += row.passed ? 1 : 0;
  f.facts += row.facts;
}
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  model: process.env['OPENAI_CHAT_MODEL'] ?? 'gpt-4o-mini',
  repetitions: REPETITIONS,
  passRate: rows.filter((r) => r.passed).length / rows.length,
  byFamily,
  rows,
};
const output = resolve(process.env['FIDELITY_OUTPUT'] ?? resolve(here, '../../../../../benchmarks/results/extraction-fidelity.json'));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
for (const [family, f] of Object.entries(byFamily)) {
  console.log(`[fidelity] ${family}: ${String(f.passed)}/${String(f.runs)} passed, ${String(f.facts)} facts`);
}
console.log(`[fidelity] pass rate ${report.passRate.toFixed(3)} -> ${output}`);
