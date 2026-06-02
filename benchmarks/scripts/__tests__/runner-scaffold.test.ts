/**
 * Unit tests for _runner-scaffold.ts — v0-8-fixes-cycle-1 T3.2 (F-arch-2
 * absorption). Asserts the extracted helpers behave correctly so the 3
 * run-*.ts CLI scripts (each now ≤ 90 LoC, down from 153-179) can rely
 * on them without duplicating mock-judge / stub-llm logic.
 *
 * @see plan v0-8-fixes-cycle-1 § T3.2 + ADR D2 + EC-4
 */
import { describe, expect, it } from 'vitest';

import {
  StubAnswerLlm,
  buildLocalTracer,
  buildSmokeJudgePanel,
} from '../_runner-scaffold.js';

describe('_runner-scaffold — StubAnswerLlm', () => {
  it('generateChat returns synthesized prefix of last message', async () => {
    const llm = new StubAnswerLlm();
    const reply = await llm.generateChat([
      { role: 'user', content: 'What is the capital of France?' },
    ]);
    expect(reply.role).toBe('assistant');
    expect(reply.content.startsWith('synthesized:')).toBe(true);
  });

  it('generateResponse returns memory[] with single extracted fact (sequential ids)', async () => {
    const llm = new StubAnswerLlm();
    const r1 = (await llm.generateResponse([{ role: 'user', content: 'fact one' }])) as {
      memory: { id: string; text: string }[];
    };
    const r2 = (await llm.generateResponse([{ role: 'user', content: 'fact two' }])) as {
      memory: { id: string; text: string }[];
    };
    expect(r1.memory[0]?.id).toBe('0');
    expect(r1.memory[0]?.text).toBe('fact one');
    expect(r2.memory[0]?.id).toBe('1');
    expect(r2.memory[0]?.text).toBe('fact two');
  });
});

describe('_runner-scaffold — buildSmokeJudgePanel', () => {
  it('returns a JudgePanel that resolves CORRECT for any input', async () => {
    const panel = buildSmokeJudgePanel();
    const verdict = await panel.judge({
      questionText: 'arbitrary',
      goldAnswer: 'arbitrary',
      generated: 'arbitrary',
    });
    expect(verdict.aggregateLabel).toBe('CORRECT');
  });
});

describe('_runner-scaffold — buildLocalTracer', () => {
  it('returns an OTel Tracer with the requested scope name', () => {
    const tracer = buildLocalTracer('test-scope');
    expect(tracer).toBeDefined();
    // Tracer exposes startActiveSpan per OTel API
    expect(typeof tracer.startActiveSpan).toBe('function');
  });
});
