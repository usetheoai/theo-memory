/**
 * Compares two arms of the write path on the outputs of `write-run.ts`, question by question.
 *
 * Usage: tsx src/stages/consolidation/compare-write-runs.ts --base a1.json,a2.json --arm b1.json,b2.json
 * Each file is one run. Both arms must come from the same case file, run in the same batch.
 */
import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { comparePaired, type RunAnswers } from '../../metrics/paired-comparison.js';

const RunSchema = z.object({
  questions: z.array(z.object({ user: z.string(), query: z.string(), answer: z.boolean() })),
});

function argument(name: string): string[] {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value === '') throw new Error(`--${name} is required: a comma-separated list of write-run outputs`);
  return value.split(',');
}

function load(path: string): RunAnswers {
  const run = RunSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  return new Map(run.questions.map((q) => [`${q.user}\u0000${q.query}`, q.answer]));
}

const result = comparePaired(argument('base').map(load), argument('arm').map(load));
console.log(JSON.stringify(result));
