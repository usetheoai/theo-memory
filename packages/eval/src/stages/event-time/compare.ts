/**
 * Compares two reports of `run.ts` case by case: a case counts as answered in a repetition when
 * its outcome is `correct`.
 *
 * Usage: tsx src/stages/event-time/compare.ts --base base.json --arm arm.json
 */
import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { comparePaired, type RunAnswers } from '../../metrics/paired-comparison.js';

const ReportSchema = z.object({
  rows: z.array(z.object({ name: z.string(), repetition: z.number().int(), outcome: z.string() })),
});

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value === '') throw new Error(`--${name} is required: the path of an event-time report`);
  return value;
}

function load(path: string): RunAnswers[] {
  const report = ReportSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const runs = new Map<number, Map<string, boolean>>();
  for (const row of report.rows) {
    const run = runs.get(row.repetition) ?? new Map<string, boolean>();
    run.set(row.name, row.outcome === 'correct');
    runs.set(row.repetition, run);
  }
  return [...runs.values()];
}

console.log(JSON.stringify(comparePaired(load(argument('base')), load(argument('arm')))));
