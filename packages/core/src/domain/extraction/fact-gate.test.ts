/**
 * M27 T2.1 — deterministic backstop gate unit tests.
 * Conservative: drop CLEAR non-facts (pure question, first-person opener); keep everything else.
 */
import { describe, expect, test } from 'vitest';

import { factGate, isNonDurableFact } from './fact-gate.js';

describe('factGate — durable-fact backstop (M27)', () => {
  test('drops a pure interrogative turn', () => {
    const r = factGate([{ text: 'Quer que eu prossiga com o escopo estreito…?' }]);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped).toHaveLength(1);
  });

  test('keeps a declarative third-person fact', () => {
    const r = factGate([{ text: 'user prefers dark roast coffee' }]);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
  });

  test('drops a first-person recommendation opener', () => {
    const r = factGate([{ text: 'Minha recomendação: allowlist com sunset <= 90 dias' }]);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped).toHaveLength(1);
  });

  test('keeps a declarative fact that merely contains a question word mid-sentence', () => {
    // Conservative: only a TRAILING question mark drops — "what" mid-sentence is fine.
    const r = factGate([{ text: 'The plan decides what the retry policy loses per call' }]);
    expect(r.kept).toHaveLength(1);
  });

  test('partitions a mixed batch correctly (kills an extracted[0]-only implementation)', () => {
    const r = factGate([
      { text: 'user migrated auth to JWT' }, // keep
      { text: 'Shall I proceed?' }, // drop
      { text: 'hono updated 4.12.25 -> 4.12.31' }, // keep
      { text: '   ' }, // drop (empty)
    ]);
    expect(r.kept).toHaveLength(2);
    expect(r.dropped).toHaveLength(2);
    expect(r.kept.map((k) => k.text)).toEqual([
      'user migrated auth to JWT',
      'hono updated 4.12.25 -> 4.12.31',
    ]);
  });

  test('isNonDurableFact predicate matches the gate', () => {
    expect(isNonDurableFact('Ok, vou continuar.')).toBe(true);
    expect(isNonDurableFact('The deploy target is a Linux container')).toBe(false);
  });

  test('drops a 400-word transcript dump on the write path (deterministic — HIGH#1)', () => {
    const dump =
      'Ciclo PLAN do M3 rodando. Passei ao agente quatro travas que sairam da descoberta. ' +
      'A primeira inverte um bullet do DoD. A segunda trata do circuit breaker e seus limiares. ' +
      'A terceira cobre o retry, e a quarta a disciplina de escopo do milestone inteiro que e grande.';
    const r = factGate([{ text: dump }]);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0]?.reason).toBe('dump');
  });

  test('language: a Portuguese declarative fact is kept unchanged; a PT first-person opener drops', () => {
    // Guards R2 — the gate must not mangle/over-filter non-English facts.
    const r = factGate([
      { text: 'user é engenheiro mecânico na São Paulo Corp' }, // keep (PT declarative)
      { text: 'Eu recomendo usar uma allowlist com sunset' }, // drop (PT first-person)
      { text: 'Acho que o deploy deve ser em container Linux' }, // drop (PT opinion)
    ]);
    expect(r.kept.map((k) => k.text)).toEqual(['user é engenheiro mecânico na São Paulo Corp']);
    expect(r.dropped).toHaveLength(2);
  });

  test('does NOT drop a single long declarative fact (one sentence, no newline)', () => {
    // Over 200 chars but ONE sentence — conservative dump heuristic keeps it (no over-filter).
    const longFact =
      'user configurou o pipeline de deploy para promover automaticamente do ambiente de staging ' +
      'para produção sempre que a suite de testes de integração passar completamente sem nenhuma falha';
    const r = factGate([{ text: longFact }]);
    expect(r.kept).toHaveLength(1);
  });
});
