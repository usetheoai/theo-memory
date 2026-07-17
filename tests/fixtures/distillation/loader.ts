/**
 * Gold-set loader for v0.7 distillation pipeline THE GOAL TEST (T3.3) +
 * eval script (T3.2). Per ADR D4 hybrid path (user decision 2026-06-01):
 *
 *   - 50 HAND-AUTHORED fixtures (10 per category) carry `source: 'hand'`.
 *     T3.3 measures precision/recall on THIS subset only — real semantic
 *     diversity, real ground truth.
 *   - 150 PROCEDURAL fixtures carry `source: 'procedural-seed'`. Used for
 *     shape/scale validation; NOT measured by THE GOAL TEST.
 *
 * Loader returns 200 typed `GoldSetFixture` rows; Zod validates each at
 * read time. T3.3 helpers filter by `source === 'hand'` to keep the
 * quality signal honest.
 *
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

const CATEGORIES = [
  'single-fact',
  'multi-fact',
  'contradiction-pair',
  'entity-overlap',
  'simulated-dialog',
] as const;
export type GoldSetCategory = (typeof CATEGORIES)[number];

const EXPECTED_COUNTS: Readonly<Record<GoldSetCategory, number>> = {
  'single-fact': 50,
  'multi-fact': 50,
  'contradiction-pair': 25,
  'entity-overlap': 25,
  'simulated-dialog': 50,
};

const ExpectedFactSchema = z.object({
  text: z.string().min(1),
  attributedTo: z.string().optional(),
  linkedToIds: z.array(z.string()).optional(),
});

const ExpectedConflictPairSchema = z
  .object({ kept: z.string().min(1), rejected: z.string().min(1) })
  .optional();

const FixtureSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CATEGORIES),
  source: z.enum(['hand', 'procedural-seed']),
  episodeText: z.string().min(1),
  expectedFacts: z.array(ExpectedFactSchema).min(1),
  expectedConflictPair: ExpectedConflictPairSchema,
});

export type GoldSetFixture = z.infer<typeof FixtureSchema>;

export function loadGoldSet(): readonly GoldSetFixture[] {
  const all: GoldSetFixture[] = [];
  for (const category of CATEGORIES) {
    const dir = join(FIXTURE_DIR, category);
    const files = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
    for (const name of files) {
      const raw = readFileSync(join(dir, name), 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const fixture = FixtureSchema.parse(parsed);
      all.push(fixture);
    }
  }
  return all;
}

export function expectedCountFor(category: GoldSetCategory): number {
  return EXPECTED_COUNTS[category];
}

export const GOLD_SET_TOTAL = Object.values(EXPECTED_COUNTS).reduce(
  (a, b) => a + b,
  0,
);
