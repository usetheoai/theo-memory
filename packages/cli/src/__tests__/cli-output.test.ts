/**
 * T1.2 contract — renderCliOutput helper.
 *
 */
import { describe, expect, test } from 'vitest';

import { renderCliOutput } from '../cli-output.js';
import type { CliRenderableResult } from '../cli-output.js';

import type { MemoryItem, MemoryItemWithScore } from '@usetheo/memory/contract';

const FROZEN = new Date('2026-01-01T00:00:00.000Z');

function makeItem(id: string, text: string): MemoryItem {
  return {
    id,
    text,
    hash: 'hash-' + id,
    scope: { kind: 'user', userId: 'alice' },
    createdAt: FROZEN,
    updatedAt: FROZEN,
    metadata: {},
    tValid: FROZEN,
    tInvalid: null,
  };
}

function makeScored(id: string, text: string, score: number): MemoryItemWithScore {
  return { ...makeItem(id, text), score };
}

describe('T1.2 — renderCliOutput', () => {
  test('1. JSON serializes remember items with 2-space indent', () => {
    const payload: CliRenderableResult = {
      verb: 'remember',
      items: [makeItem('11111111-1111-1111-1111-111111111111', 'fact')],
    };
    const out = renderCliOutput(payload, 'json');
    expect(out).toContain('"id": "11111111-1111-1111-1111-111111111111"');
    expect(out).toContain('  "id"'); // 2-space indent
  });

  test('2. text remember matches `Wrote <count> memories:` pattern', () => {
    const payload: CliRenderableResult = {
      verb: 'remember',
      items: [makeItem('id-1', 'x'), makeItem('id-2', 'y')],
    };
    const out = renderCliOutput(payload, 'text');
    expect(out).toMatch(/Wrote 2 memories: id-1, id-2/);
  });

  test('3. text recall with items lists each with score', () => {
    const payload: CliRenderableResult = {
      verb: 'recall',
      items: [makeScored('id-1', 'first', 0.91), makeScored('id-2', 'second', 0.82)],
    };
    const out = renderCliOutput(payload, 'text');
    expect(out).toMatch(/Found 2 memories:/);
    expect(out).toMatch(/\[0\.910\] id-1: first/);
    expect(out).toMatch(/\[0\.820\] id-2: second/);
  });

  test('4. text recall with empty items outputs zero count', () => {
    const payload: CliRenderableResult = { verb: 'recall', items: [] };
    const out = renderCliOutput(payload, 'text');
    expect(out).toMatch(/Found 0 memories:/);
  });

  test('5. text forget includes id and hard flag', () => {
    const payload: CliRenderableResult = {
      verb: 'forget',
      result: { id: 'id-1', hard: true },
    };
    const out = renderCliOutput(payload, 'text');
    expect(out).toMatch(/Forgot id-1 \(hard=true\)/);
  });

  test('6. text reflect includes source and derived counts from raw ReflectionResult', () => {
    // verbs-as-cli-fixes-cycle-1 T1.2 / ADR D2: payload now carries the
    // RAW ReflectionResult shape (sourceIds + derivedMemoriesCreated +
    // higherOrderMemories) — 3-way parity with REST + MCP surfaces.
    const payload: CliRenderableResult = {
      verb: 'reflect',
      result: {
        higherOrderMemories: [],
        sourceIds: ['s1', 's2', 's3', 's4', 's5'],
        derivedMemoriesCreated: 2,
      },
    };
    const out = renderCliOutput(payload, 'text');
    expect(out).toMatch(/Reflected 5 → 2 insights/);
  });
});
