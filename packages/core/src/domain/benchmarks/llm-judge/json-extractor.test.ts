/**
 * T1.2 RED tests for EC-1 json-extractor.
 *
 * Covers: bare JSON / markdown-fenced / prose-prefix / prose-suffix /
 * malformed / wrong-field / case-insensitive label normalization.
 *
 * @see plan v1.2 § T1.2 + EC-1
 */
import { describe, expect, it } from 'vitest';

import { extractJudgeJson } from './json-extractor.js';

describe('extractJudgeJson (EC-1)', () => {
  it('parses a bare JSON object', () => {
    const parsed = extractJudgeJson('{"label":"CORRECT","reasoning":"matches"}');
    expect(parsed).toEqual({ label: 'CORRECT', reasoning: 'matches' });
  });

  it('parses a markdown-fenced JSON object', () => {
    const parsed = extractJudgeJson('```json\n{"label":"WRONG","reasoning":"different topic"}\n```');
    expect(parsed).toEqual({ label: 'WRONG', reasoning: 'different topic' });
  });

  it('parses JSON with a prose prefix', () => {
    const parsed = extractJudgeJson(
      'Sure! Here is the result:\n{"label":"CORRECT","reasoning":"same topic"}',
    );
    expect(parsed?.label).toBe('CORRECT');
  });

  it('parses JSON with a prose suffix', () => {
    const parsed = extractJudgeJson(
      '{"label":"CORRECT","reasoning":"match"}\nLet me know if you need anything else.',
    );
    expect(parsed?.label).toBe('CORRECT');
  });

  it('normalizes lowercase labels to canonical CORRECT/WRONG', () => {
    expect(extractJudgeJson('{"label":"correct","reasoning":"ok"}')?.label).toBe('CORRECT');
    expect(extractJudgeJson('{"label":"wrong","reasoning":"no"}')?.label).toBe('WRONG');
  });

  it('returns null when no JSON object is present', () => {
    expect(extractJudgeJson('I cannot evaluate this question.')).toBeNull();
  });

  it('returns null when the JSON object lacks a "label" field', () => {
    expect(extractJudgeJson('{"verdict":"yes","reasoning":"..."}')).toBeNull();
  });

  it('returns null when the label is neither CORRECT nor WRONG', () => {
    expect(extractJudgeJson('{"label":"MAYBE","reasoning":"..."}')).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(extractJudgeJson('')).toBeNull();
  });
});
