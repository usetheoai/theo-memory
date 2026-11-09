import { describe, expect, it } from 'vitest';

import type { Scope } from '../../domain/scope.js';

import { rowsToMemoryItems } from './row-mapping.js';

const scope: Scope = { kind: 'user', userId: 'alice' };
const createdAt = new Date('2026-01-01T00:00:00.000Z');

describe('rowsToMemoryItems attribution projection', () => {
  it('projects attributed_to into the first-class MemoryItem field', () => {
    const { items } = rowsToMemoryItems([{
      id: 'm1',
      createdAt,
      payload: { text: 'assistant suggested a goal', hash: 'h1', attributed_to: 'assistant' },
    }], scope);

    expect(items[0]?.attributedTo).toBe('assistant');
  });

  it('leaves attribution absent when the stored row has no speaker', () => {
    const { items } = rowsToMemoryItems([{
      id: 'm2',
      createdAt,
      payload: { text: 'unattributed derived insight', hash: 'h2' },
    }], scope);

    expect(items[0]?.attributedTo).toBeUndefined();
  });
});
