import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateEventTimeCases } from './cases.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateEventTimeCases', () => {
  it('matches the committed case file', () => {
    const committed = JSON.parse(readFileSync(resolve(here, 'cases.json'), 'utf8')) as unknown;

    expect(generateEventTimeCases()).toEqual(committed);
  });

  it('yields another set for another seed', () => {
    expect(generateEventTimeCases(1)).not.toEqual(generateEventTimeCases());
  });

  it('has 26 cases in each of the six languages', () => {
    const counts = new Map<string, number>();
    for (const c of generateEventTimeCases()) counts.set(c.language, (counts.get(c.language) ?? 0) + 1);

    expect([...counts.entries()]).toEqual([['en', 26], ['pt', 26], ['es', 26], ['fr', 26], ['de', 26], ['it', 26]]);
  });

  it('expects a day after the sentence for a plan and before it for a past event', () => {
    const misplaced = generateEventTimeCases().filter((c) => {
      const said = c.observedAt.slice(0, c.expected.length);
      return c.tense === 'plan' ? c.expected <= said : c.expected >= said;
    });

    expect(misplaced).toEqual([]);
  });

  it('never leaves the placeholder in a sentence', () => {
    expect(generateEventTimeCases().filter((c) => c.text.includes('{E}'))).toEqual([]);
  });
});
