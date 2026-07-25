/**
 * T3.1 — extraction golden loader. Zod-validated at read (loader.ts precedent).
 *
 * Three kinds (ADR D5 + F-M5 mitigation):
 *  - `hard`      — clear ground-truth entities; scored for precision/recall.
 *  - `negative`  — noise-only text that MUST yield zero entities (the #111
 *                  function-word case); scored as noise-rejection accuracy.
 *  - `ambiguous` — genuinely uncertain extraction. NOT scored by any tier today
 *                  (documentation-only): reserved as ground truth for a future
 *                  LLM-measured consumer. The deterministic gate's non-vacuity
 *                  comes from `hard` + `negative`, not `ambiguous`.
 *
 * The schema enforces the negative contract (a negative fixture declaring
 * expected entities is a malformed fixture) so vacuous fixtures cannot slip in.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const DATASET_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'datasets',
  'extraction',
);

export const EXTRACTION_KINDS = ['hard', 'negative', 'ambiguous'] as const;
export type ExtractionKind = (typeof EXTRACTION_KINDS)[number];

export const ExtractionFixtureSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(EXTRACTION_KINDS),
    text: z.string().min(1),
    expectedEntities: z.array(z.string()),
    note: z.string().optional(),
  })
  .superRefine((f, ctx) => {
    if (f.kind === 'negative' && f.expectedEntities.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `negative fixture ${f.id} must declare zero expected entities`,
        path: ['expectedEntities'],
      });
    }
  });

export type ExtractionFixture = z.infer<typeof ExtractionFixtureSchema>;

export function loadExtractionGolden(): readonly ExtractionFixture[] {
  const all: ExtractionFixture[] = [];
  const files = readdirSync(DATASET_DIR)
    .filter((n) => n.endsWith('.json'))
    .sort();
  for (const name of files) {
    const raw: unknown = JSON.parse(readFileSync(join(DATASET_DIR, name), 'utf-8'));
    const rows = z.array(ExtractionFixtureSchema).parse(raw);
    all.push(...rows);
  }
  return all;
}

export function countByKind(
  rows: readonly ExtractionFixture[],
): Readonly<Record<ExtractionKind, number>> {
  const counts: Record<ExtractionKind, number> = { hard: 0, negative: 0, ambiguous: 0 };
  for (const r of rows) counts[r.kind] += 1;
  return counts;
}
