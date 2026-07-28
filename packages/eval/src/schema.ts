/**
 * T1.2 — Zod unified result + baseline schema for the eval harness.
 *
 * A `StageScore` is one LLM-touching stage's measured quality over its golden
 * set. A `Baseline` is a committed snapshot of per-stage scores from a
 * known-good run; the regression gate (T1.3) compares candidate scores against
 * it. Every field is bounded and validated at read time so a corrupt baseline
 * JSON fails-closed with a typed ZodError, never a silent pass (Princípio 3 —
 * auditable; ADR D3). Mirrors the established `EvalItem`/`UnifiedResult` shape and our
 * own `tests/fixtures/distillation/loader.ts` Zod-at-read precedent.
 */
import { z } from 'zod';

/** A metric bounded to the [0, 1] closed interval. */
const UnitInterval = z.number().min(0).max(1);

export const StageScoreSchema = z.object({
  /** Stage name — e.g. 'extraction', 'consolidation'. Non-empty. */
  stage: z.string().min(1),
  /** Set-overlap precision over the golden set. */
  precision: UnitInterval,
  /** Set-overlap recall over the golden set. */
  recall: UnitInterval,
  /**
   * Optional stage-specific accuracy (e.g. extraction noise-rejection accuracy
   * over negative cases, or conflict-resolution accuracy for consolidation).
   */
  accuracy: UnitInterval.optional(),
  /** Number of golden cases the score was computed over. */
  n: z.number().int().min(0),
  /** Wall-clock runtime of the stage run, milliseconds. */
  runtimeMs: z.number().min(0),
});

export type StageScore = z.infer<typeof StageScoreSchema>;

export const BaselineSchema = z.object({
  /** ISO-8601 timestamp the baseline was seeded. */
  generatedAt: z.string().min(1),
  /** Model / tier label — e.g. 'llm-free', 'openai/gpt-4o-mini'. */
  model: z.string().min(1),
  /** Per-stage scores; at least one stage. */
  stages: z.array(StageScoreSchema).min(1),
});

export type Baseline = z.infer<typeof BaselineSchema>;

/** The metrics a StageScore carries that the regression gate compares. */
export const COMPARED_METRICS = ['precision', 'recall', 'accuracy'] as const;
export type ComparedMetric = (typeof COMPARED_METRICS)[number];
