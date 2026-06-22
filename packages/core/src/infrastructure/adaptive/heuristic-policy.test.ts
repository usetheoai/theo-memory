/**
 * Unit tests for HeuristicAdaptiveRetrievalPolicy (adaptive-retrieval T4.1).
 * Pure in-memory; no I/O.
 */
import { describe, expect, test } from 'vitest';

import type { MemoryItemWithScore } from '../../domain/memory-item.js';

import { HeuristicAdaptiveRetrievalPolicy } from './heuristic-policy.js';

function item(score: number): MemoryItemWithScore {
  return {
    id: 'x',
    text: 't',
    hash: 'h',
    scope: { kind: 'user', userId: 'u' },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    metadata: {},
    tValid: new Date(0),
    tInvalid: null,
    score,
  };
}

describe('HeuristicAdaptiveRetrievalPolicy.shouldRetrieve', () => {
  test('default (no markers) ⇒ always retrieve', async () => {
    const p = new HeuristicAdaptiveRetrievalPolicy();
    expect(await p.shouldRetrieve('what is my name', { kind: 'user', userId: 'u' })).toEqual({
      retrieve: true,
    });
  });

  test('matches a configured no-retrieve marker (case/space-insensitive) ⇒ skip', async () => {
    const p = new HeuristicAdaptiveRetrievalPolicy({ noRetrieveMarkers: ['hello'] });
    const d = await p.shouldRetrieve('  HELLO  ', { kind: 'user', userId: 'u' });
    expect(d.retrieve).toBe(false);
    expect(d.reason).toMatch(/marker/);
  });
});

describe('HeuristicAdaptiveRetrievalPolicy.assess', () => {
  test('top score >= floor ⇒ accept', async () => {
    const p = new HeuristicAdaptiveRetrievalPolicy({ correctiveFloor: 0.5 });
    expect(await p.assess('q', [item(0.8)])).toEqual({ sufficient: true, action: 'accept' });
  });

  test('top score < floor ⇒ relax with configured relaxedThreshold', async () => {
    const p = new HeuristicAdaptiveRetrievalPolicy({ correctiveFloor: 0.5, relaxedThreshold: 0.05 });
    const a = await p.assess('q', [item(0.2)]);
    expect(a.action).toBe('relax');
    expect(a.relaxedThreshold).toBe(0.05);
  });

  test('empty result set ⇒ relax (may surface sub-threshold rows)', async () => {
    const p = new HeuristicAdaptiveRetrievalPolicy();
    const a = await p.assess('q', []);
    expect(a.action).toBe('relax');
  });

  test('per-call tuning overrides construction config', async () => {
    const p = new HeuristicAdaptiveRetrievalPolicy({ correctiveFloor: 0.5, relaxedThreshold: 0.05 });
    // raise floor via tuning so a 0.6 top now triggers relax; override relaxedThreshold
    const a = await p.assess('q', [item(0.6)], { correctiveFloor: 0.7, relaxedThreshold: 0.02 });
    expect(a.action).toBe('relax');
    expect(a.relaxedThreshold).toBe(0.02);
  });
});
