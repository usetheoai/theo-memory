import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FidelityCaseSchema, scoreFidelityCase, type FidelityCase } from './scoring.js';

const base: FidelityCase = {
  name: 'case',
  family: 'title-or-name',
  messages: [{ role: 'user', content: 'Ana: We named the boat Marigold.' }],
  required: ['Marigold', 'boat'],
  subject: 'Ana',
};

describe('scoreFidelityCase', () => {
  it('passes when every required pattern is in some fact', () => {
    expect(scoreFidelityCase(base, ['Ana named her boat Marigold']).passed).toBe(true);
  });

  it('reports the pattern no fact contains', () => {
    const score = scoreFidelityCase(base, ['Ana has a boat']);
    expect(score.passed).toBe(false);
    expect(score.missing).toEqual(['Marigold']);
  });

  it('fails a named-author case whose fact uses the bare user token as subject', () => {
    const score = scoreFidelityCase(base, ["user's boat is named Marigold"]);
    expect(score.passed).toBe(false);
    expect(score.bareUserSubject).toHaveLength(1);
  });

  it('does not flag a name that merely starts with the letters user', () => {
    expect(scoreFidelityCase(base, ['Username Marigold is the boat of Ana']).bareUserSubject).toHaveLength(0);
  });

  it('fails a control case that emits more facts than allowed', () => {
    const control: FidelityCase = { name: 'c', family: 'control', messages: base.messages, required: [], maxFacts: 0 };
    expect(scoreFidelityCase(control, ['Ana said hello']).overLimit).toBe(true);
    expect(scoreFidelityCase(control, []).passed).toBe(true);
  });
});

describe('golden.json', () => {
  it('golden fixtures parse with unique names over every family', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const cases = z.array(FidelityCaseSchema).parse(JSON.parse(readFileSync(resolve(here, 'golden.json'), 'utf8')));
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
    expect(new Set(cases.map((c) => c.family))).toEqual(
      new Set(['passing-plan', 'title-or-name', 'suggestion', 'secondary-detail', 'named-subject', 'control']),
    );
  });
});
