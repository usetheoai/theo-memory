/**
 * Hybrid category taxonomy for default-on auto-categorization.
 *
 * The write pipeline instructs the LLM to prefer a label from a fixed list; when
 * nothing fits it emits a short free-form label. `classifyCategorySource` records
 * which of the two happened (observability only — the persisted value is a plain
 * string either way; no new column).
 *
 */

/** The default fixed taxonomy (lowercase; the prompt lists these as preferred labels). */
export const DEFAULT_CATEGORY_TAXONOMY: readonly string[] = [
  'personal',
  'preferences',
  'work',
  'relationships',
  'location',
  'health',
  'technical',
  'financial',
  'other',
];

/** Where an assigned category label came from (recorded on the observability event). */
export type CategorySource = 'taxonomy' | 'suggested';

/**
 * Config knob for default-on auto-categorization, threaded into `ExtractionDeps`.
 * `enabled` defaults to `true` (ADR D3 — a caller category still always wins);
 * `taxonomy` defaults to {@link DEFAULT_CATEGORY_TAXONOMY}.
 */
export interface AutoCategorizeConfig {
  readonly enabled?: boolean;
  readonly taxonomy?: readonly string[];
}

/**
 * Classify an assigned label as a fixed-taxonomy pick or a free-form suggestion.
 * Case-insensitive; an empty taxonomy always yields `'suggested'` (pure free-form mode).
 */
export function classifyCategorySource(label: string, taxonomy: readonly string[]): CategorySource {
  const normalized = label.trim().toLowerCase();
  return taxonomy.some((entry) => entry.toLowerCase() === normalized) ? 'taxonomy' : 'suggested';
}
