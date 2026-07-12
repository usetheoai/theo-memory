/**
 * RED-phase tests for extraction/taxonomy.ts — auto-categorization-write-pipeline T1.2.
 * The hybrid-taxonomy default list + the source classifier (fixed-list vs free-form).
 *
 * @see .claude/knowledge-base/plans/auto-categorization-write-pipeline-plan.md § Phase 1 / T1.2
 */
import { describe, expect, test } from 'vitest';

import { DEFAULT_CATEGORY_TAXONOMY, classifyCategorySource } from './taxonomy.js';

describe('classifyCategorySource', () => {
  test('test_classify_returns_taxonomy_for_listed_label', () => {
    expect(classifyCategorySource('work', DEFAULT_CATEGORY_TAXONOMY)).toBe('taxonomy');
  });

  test('test_classify_returns_suggested_for_unlisted_label', () => {
    expect(classifyCategorySource('side-hustle', DEFAULT_CATEGORY_TAXONOMY)).toBe('suggested');
  });

  test('test_classify_is_case_insensitive', () => {
    expect(classifyCategorySource('Work', DEFAULT_CATEGORY_TAXONOMY)).toBe('taxonomy');
  });

  test('test_classify_returns_suggested_for_empty_taxonomy', () => {
    expect(classifyCategorySource('anything', [])).toBe('suggested');
  });
});

describe('DEFAULT_CATEGORY_TAXONOMY', () => {
  test('test_default_taxonomy_is_non_empty_and_lowercase', () => {
    expect(DEFAULT_CATEGORY_TAXONOMY.length).toBeGreaterThan(0);
    for (const label of DEFAULT_CATEGORY_TAXONOMY) {
      expect(label).toBe(label.toLowerCase());
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(64);
    }
  });
});
