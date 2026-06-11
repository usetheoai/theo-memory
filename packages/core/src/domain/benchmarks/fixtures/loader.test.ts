/**
 * T2.1 RED tests for fixture loaders.
 *
 * EC-1 absorption: LongMemEval HF dataset mixes integer + object types in
 * the `answer` field; normalizeLongMemEvalAnswer collapses to string.
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T2.1
 * @see .claude/knowledge-base/reviews/v0-8-independent-benchmark-reproduction-edge-cases-2026-06-02.md § EC-1
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadDmrFixture,
  loadLoCoMoFixture,
  loadLongMemEvalFixture,
  normalizeLongMemEvalAnswer,
} from './index.js';

const SAMPLES_DIR = resolve(import.meta.dirname, '../../../../../../tests/fixtures/benchmarks');

describe('normalizeLongMemEvalAnswer (EC-1)', () => {
  it('passes through a string answer', () => {
    expect(normalizeLongMemEvalAnswer('coffee')).toBe('coffee');
  });

  it('converts a number answer to its string form', () => {
    expect(normalizeLongMemEvalAnswer(3)).toBe('3');
  });

  it('extracts the text field from an object answer', () => {
    expect(normalizeLongMemEvalAnswer({ text: 'Lisbon, Portugal' })).toBe('Lisbon, Portugal');
  });

  it('returns JSON string fallback for unexpected shapes (honest, not silent)', () => {
    expect(normalizeLongMemEvalAnswer({ unexpected: true })).toBe('{"unexpected":true}');
  });
});

describe('loadLongMemEvalFixture', () => {
  it('parses the committed sample with 3 questions', async () => {
    const items = await loadLongMemEvalFixture(`${SAMPLES_DIR}/longmemeval-sample.json`);
    expect(items).toHaveLength(3);
    expect(items[0]?.questionId).toBe('lme-001');
  });

  it('normalizes mixed-type answer fields to strings (EC-1 end-to-end)', async () => {
    const items = await loadLongMemEvalFixture(`${SAMPLES_DIR}/longmemeval-sample.json`);
    // sample seeds string + number + {text} variants
    expect(items[0]?.answer).toBe('coffee');
    expect(items[1]?.answer).toBe('3');
    expect(items[2]?.answer).toBe('Lisbon, Portugal');
  });
});

describe('loadLoCoMoFixture', () => {
  it('parses the committed sample preserving speaker boundaries', async () => {
    const conversations = await loadLoCoMoFixture(`${SAMPLES_DIR}/locomo-sample.json`);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.speakerA).toBe('Alice');
    expect(conversations[0]?.speakerB).toBe('Bob');
  });
});

describe('loadDmrFixture', () => {
  it('parses the committed sample with 2 conversations', async () => {
    const items = await loadDmrFixture(`${SAMPLES_DIR}/dmr-sample.json`);
    expect(items).toHaveLength(2);
    expect(items[0]?.conversationId).toBe('dmr-001');
    expect(items[1]?.answer).toBe('Mango');
  });
});
