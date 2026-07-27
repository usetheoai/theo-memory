/**
 * M27 T4.1 — one-shot write-quality cleanup: dry-run reports without mutation; apply
 * soft-deletes only the polluted rows (reversible), keeps clean facts, degrades gracefully.
 */
import { describe, expect, test, vi } from 'vitest';

import { classifyNonFact, isDump } from '../domain/extraction/fact-gate.js';
import type { MemoryItem } from '../domain/memory-item.js';
import { cleanupWriteQuality, findPollutedMemories } from './cleanup-write-quality.js';

function item(id: string, text: string): MemoryItem {
  return {
    id,
    text,
    metadata: {},
    tValid: new Date('2026-01-01'),
    tInvalid: null,
  } as unknown as MemoryItem;
}

const DUMP =
  'Ciclo PLAN do M3 rodando. Passei ao agente quatro travas que saíram da descoberta, e uma delas ' +
  'inverte um bullet do DoD original: o maxRetries 0 não pode ser receita, porque desligar o retry ' +
  'dos SDKs de vendor desliga a idempotency key do stripe em silêncio e faz a camada externa repetir ' +
  'POSTs de forma não-idempotente. A segunda trava trata do circuit breaker: nenhum limiar do corpus ' +
  'tem justificativa escrita, então o que se transfere é a forma, valores sobrescrevíveis por env. ' +
  'A terceira cobre o retry e a quarta a disciplina de escopo do milestone inteiro, que é o risco real ' +
  'de um trabalho deste tamanho quando as seis primeiras tarefas precisam todas aterrissar juntas.';

describe('cleanup-write-quality classification (M27 T4.1)', () => {
  test('classifies a question, a dump, and a clean fact via the shared predicate', () => {
    expect(classifyNonFact('Quer que eu prossiga…?')).toBe('question');
    expect(classifyNonFact(DUMP)).toBe('dump');
    expect(classifyNonFact('user prefers dark roast')).toBeNull();
  });

  test('isDump only fires on long multi-sentence narration', () => {
    expect(isDump('short fact')).toBe(false);
    expect(isDump(DUMP)).toBe(true);
  });

  test('findPollutedMemories returns only the polluted ids', () => {
    const found = findPollutedMemories([
      item('a', 'user migrated auth to JWT'),
      item('b', 'Shall I proceed?'),
      item('c', DUMP),
    ]);
    expect(found.map((f) => f.id).sort()).toEqual(['b', 'c']);
  });
});

describe('cleanupWriteQuality driver (M27 T4.1)', () => {
  const rows = [item('clean1', 'user uses pnpm'), item('q', 'Quer prosseguir?'), item('dump', DUMP)];

  test('dry-run reports candidates WITHOUT mutating', async () => {
    const forget = vi.fn(async () => {});
    const res = await cleanupWriteQuality({ list: async () => rows, forget }, { dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.candidates.map((c) => c.id).sort()).toEqual(['dump', 'q']);
    expect(res.forgotten).toHaveLength(0);
    expect(forget).not.toHaveBeenCalled();
  });

  test('apply soft-deletes only the polluted rows, keeps the clean one', async () => {
    const forgotten: string[] = [];
    const forget = vi.fn(async (id: string) => {
      forgotten.push(id);
    });
    const res = await cleanupWriteQuality({ list: async () => rows, forget }, { dryRun: false });
    expect([...res.forgotten].sort()).toEqual(['dump', 'q']);
    expect(forgotten).not.toContain('clean1');
  });

  test('a per-row forget failure is skipped, not fatal (graceful degradation)', async () => {
    const forget = vi.fn(async (id: string) => {
      if (id === 'dump') throw new Error('boom');
    });
    const res = await cleanupWriteQuality({ list: async () => rows, forget }, { dryRun: false });
    expect(res.forgotten).toEqual(['q']);
    expect(res.skipped).toEqual(['dump']);
  });
});
