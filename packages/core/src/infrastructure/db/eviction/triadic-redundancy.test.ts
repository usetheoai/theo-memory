/**
 * Redundancy-aware victim selection (#240): a pass never evicts a memory together with its
 * nearest neighbour, so a fact said in several paraphrases loses copies, never every copy.
 */
import { describe, expect, it } from 'vitest';

import type { EvictionResult } from '../../../domain/dip/eviction-policy.js';
import type { MemoryItem } from '../../../domain/memory-item.js';
import type { Scope } from '../../../domain/scope.js';

import type { Evictor } from './pg-evictor.js';
import { TriadicScoringPolicy, type NearestNeighborProvider } from './triadic-scoring-policy.js';

const scope: Scope = { kind: 'user', userId: 'anna' };
const at = new Date('2024-01-01T00:00:00Z');
const memory = (id: string): MemoryItem => ({
  id, text: id, hash: id, scope, createdAt: at, updatedAt: at, metadata: {}, tValid: at, tInvalid: null,
});
const evictor: Evictor = { evict: (): Promise<EvictionResult> => Promise.resolve({ softDeleted: [], alreadyInvalid: [], errors: [] }) };

/** a and b are paraphrases of each other; c and d are far from everything. */
const neighbours: Record<string, { id: string; distance: number }> = {
  a: { id: 'b', distance: 0.02 },
  b: { id: 'a', distance: 0.02 },
  c: { id: 'd', distance: 0.9 },
  d: { id: 'c', distance: 0.9 },
};
const withNearest: NearestNeighborProvider = {
  distance: (id) => Promise.resolve(neighbours[id]!.distance),
  nearest: (id) => Promise.resolve(neighbours[id] ?? null),
};
const distanceOnly: NearestNeighborProvider = { distance: (id) => Promise.resolve(neighbours[id]!.distance) };
const candidates = ['a', 'b', 'c', 'd'].map(memory);
const context = { meanIsolationDistance: 0, now: at };

describe('TriadicScoringPolicy.selectVictims with a provider that names the nearest neighbour', () => {
  it('keeps one memory of a paraphrase pair and fills the quota from the next candidates', async () => {
    const policy = new TriadicScoringPolicy({ neighborProvider: withNearest, evictor });
    const victims = await policy.selectVictims(candidates, 0.5, context);
    expect(victims).toHaveLength(2);
    expect(victims.filter((id) => id === 'a' || id === 'b')).toHaveLength(1);
  });

  it('never selects a memory whose nearest neighbour is also selected, while the quota allows it', async () => {
    const policy = new TriadicScoringPolicy({ neighborProvider: withNearest, evictor });
    const victims = new Set(await policy.selectVictims(candidates, 0.5, context));
    for (const id of victims) expect(victims.has(neighbours[id]!.id)).toBe(false);
  });

  it('a memory with no neighbour in scope can still be evicted', async () => {
    const lonely: NearestNeighborProvider = { distance: () => Promise.resolve(1), nearest: () => Promise.resolve(null) };
    const policy = new TriadicScoringPolicy({ neighborProvider: lonely, evictor });
    expect(await policy.selectVictims([memory('a')], 1, context)).toEqual(['a']);
  });
});

describe('TriadicScoringPolicy.selectVictims on a group of identical copies', () => {
  /** hub is the nearest neighbour of every copy; the hub's own nearest is copy1. */
  const star: Record<string, { id: string; distance: number }> = {
    hub: { id: 'copy1', distance: 0 },
    copy1: { id: 'hub', distance: 0 },
    copy2: { id: 'hub', distance: 0 },
    copy3: { id: 'hub', distance: 0 },
  };
  const provider: NearestNeighborProvider = {
    distance: (id) => Promise.resolve(star[id]!.distance),
    nearest: (id) => Promise.resolve(star[id] ?? null),
  };
  const group = ['hub', 'copy1', 'copy2', 'copy3'].map(memory);

  it('evicts the copies and keeps the memory the others are nearest to', async () => {
    const policy = new TriadicScoringPolicy({ neighborProvider: provider, evictor });
    const victims = await policy.selectVictims(group, 0.75, context);
    expect([...victims].sort()).toEqual(['copy1', 'copy2', 'copy3']);
  });

  it('no victim is the nearest neighbour of another victim', async () => {
    const policy = new TriadicScoringPolicy({ neighborProvider: provider, evictor });
    const victims = new Set(await policy.selectVictims(group, 0.75, context));
    for (const id of victims) expect(victims.has(star[id]!.id)).toBe(false);
  });

  it('still meets the capacity quota when the rule cannot, by score order', async () => {
    const policy = new TriadicScoringPolicy({ neighborProvider: provider, evictor });
    expect(await policy.selectVictims(group, 1, context)).toHaveLength(4);
  });
});

describe('TriadicScoringPolicy.selectVictims with a distance-only provider', () => {
  it('keeps the previous behaviour: the bottom fraction by score, paraphrases included', async () => {
    const policy = new TriadicScoringPolicy({ neighborProvider: distanceOnly, evictor });
    const victims = await policy.selectVictims(candidates, 0.5, context);
    expect([...victims].sort()).toEqual(['a', 'b']);
  });
});
