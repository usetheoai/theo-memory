/**
 * Unit tests for Step 6 (`computeEntityBoost`) — T1.2 of M18 (#125).
 *
 * The pure-function monotonicity of `entityBoost` is proven in `scoring.test.ts`. This
 * proves the property SURVIVES the step composition: a memory matching MORE distinct query
 * entities receives at least as much boost as one matching fewer — end-to-end through
 * `countMatchedEntitiesPerMemory` + `entityBoost`, with a fake store (no I/O).
 */
import { describe, expect, test } from 'vitest';

import { entityBoost } from '../scoring.js';
import type { Filters } from '../scope.js';

import { computeEntityBoost, type EntityBoostDeps } from './entity-boost-step.js';

const NO_FILTERS: Filters = {};

/** Fake store returning a fixed linked-keys map — no DB, no network. */
function fakeStore(linked: Record<string, readonly string[]>): EntityBoostDeps['entityBoostStore'] {
  return {
    linkedKeysForMemories: async () => new Map(Object.entries(linked)),
  };
}

describe('computeEntityBoost (Step 6 monotonicity end-to-end — #125)', () => {
  test('a memory matching more query entities is boosted at least as much', async () => {
    // query mentions three entities; "three" links all three, "one" links a single one.
    const query = 'alpha beta gamma';
    const deps: EntityBoostDeps = {
      entityBoostStore: fakeStore({
        one: ['alpha'],
        three: ['alpha', 'beta', 'gamma'],
      }),
    };

    const boostById = await computeEntityBoost(query, ['one', 'three'], NO_FILTERS, deps);

    const boostOne = boostById.get('one');
    const boostThree = boostById.get('three');
    expect(boostOne).toBeGreaterThan(0);
    expect(boostThree).toBeGreaterThan(0);
    // #125: more matched entities must never score LESS through the step.
    expect(boostThree as number).toBeGreaterThanOrEqual(boostOne as number);
    // And strictly more here (3 vs 1 matched entities).
    expect(boostThree as number).toBeGreaterThan(boostOne as number);
  });

  test('entityBoost keeps a single-argument numeric signature (ADR D1)', () => {
    // The step calls entityBoost(numLinked) with one argument; the signature must not widen.
    expect(typeof entityBoost(1)).toBe('number');
    expect(entityBoost(0)).toBe(0);
  });
});
