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
  it('returns a JudgePanel that resolves CORRECT for any input (default)', async () => {
    const panel = buildSmokeJudgePanel();
    const verdict = await panel.judge({
      questionText: 'arbitrary',
      goldAnswer: 'arbitrary',
      generated: 'arbitrary',
    });
    expect(verdict.aggregateLabel).toBe('CORRECT');
  });

  // v0-8-fixes-cycle-1 T1.2 (closes F-tests-2 MAJOR): parameterizable
  // stub responses so smoke runs can exercise BOTH CORRECT and WRONG
  // paths. Previously the panel was hardcoded to CORRECT, masking any
  // regression in the WRONG handling path.
  it('returns WRONG when stubResponses is ["WRONG"] (T1.2 + F-tests-2)', async () => {
    const panel = buildSmokeJudgePanel(['WRONG']);
    const verdict = await panel.judge({
      questionText: 'q?',
      goldAnswer: 'a',
      generated: 'b',
    });
    expect(verdict.aggregateLabel).toBe('WRONG');
  });

  // EC-6 cycling contract: when stubResponses.length < question count,
  // responses cycle modulo length so smoke fixtures of arbitrary size
  // remain deterministic. Test by invoking judge() 3 times against a
  // panel built with ['CORRECT', 'WRONG'] — expected sequence
  // [CORRECT, WRONG, CORRECT] (i % 2).
  it('cycles responses modulo length when invoked more times than stubResponses (EC-6)', async () => {
    const panel = buildSmokeJudgePanel(['CORRECT', 'WRONG']);
    const verdicts: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const v = await panel.judge({
        questionText: `q${String(i)}`,
        goldAnswer: 'a',
        generated: 'b',
      });
      verdicts.push(v.aggregateLabel ?? 'null');
    }
    expect(verdicts).toEqual(['CORRECT', 'WRONG', 'CORRECT']);
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
