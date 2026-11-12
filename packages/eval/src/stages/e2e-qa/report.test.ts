import { describe, expect, it } from 'vitest';

import { assessRunIntegrity, describeIngestError, failedResult } from './report.js';

const example = {
  question_id: 'q1',
  question_type: 'multi-session',
  question: 'question',
  answer: 'answer',
};

describe('assessRunIntegrity', () => {
  it('accepts completed examples without stage failures', () => {
    const clean = { ...failedResult(example, 'placeholder') };
    delete clean.error;
    expect(assessRunIntegrity([clean])).toEqual({
      valid: true,
      invalidExamples: 0,
    });
  });

  it('invalidates a run with ingestion, reflection, or pipeline errors', () => {
    const clean = { ...failedResult(example, 'placeholder') };
    delete clean.error;
    const ingestFailed = { ...clean, ingestErrors: 1 };
    const reflectionFailed = { ...clean, reflectionError: 'provider failed' };
    const pipelineFailed = { ...clean, error: 'recall failed' };

    expect(assessRunIntegrity([clean, ingestFailed, reflectionFailed, pipelineFailed])).toEqual({
      valid: false,
      invalidExamples: 3,
    });
  });

  it('invalidates an otherwise clean run when source turns were truncated', () => {
    const truncated = { ...failedResult(example, 'placeholder'), availableTurns: 400, ingestedTurns: 40 };
    delete truncated.error;
    expect(assessRunIntegrity([truncated])).toEqual({ valid: false, invalidExamples: 1 });
  });
});

describe('describeIngestError', () => {
  it('names the error and each cause with its SQLSTATE and constraint, never a message', () => {
    const dbError = Object.assign(new Error('Key (id)=(secret) exists'), { code: '23505', constraint: 'memories_pkey' });
    const described = describeIngestError(new Error('persistence was incomplete', { cause: dbError }));
    expect(described).toBe('Error <- Error code=23505 constraint=memories_pkey');
    expect(described).not.toContain('secret');
  });

  it('describes a non-error throw as UnknownError', () => {
    expect(describeIngestError('boom')).toBe('UnknownError');
  });
});
