import { describe, expect, test } from 'vitest';

import { InvalidScope } from '../../domain/errors.js';

import { scopePartition } from './scope-partition.js';

describe('scopePartition', () => {
  test("the user tier's global hierarchy requires no session and no agent", () => {
    expect(scopePartition({ user_id: 'alice', scopeHierarchy: 'global' }))
      .toEqual({ workspaceId: 'default', userId: 'alice', sessionId: null, agentId: null });
  });

  test('an absent id matches any value', () => {
    expect(scopePartition({ workspace_id: 'w1', session_id: 's1' }))
      .toEqual({ workspaceId: 'w1', userId: undefined, sessionId: 's1', agentId: undefined });
  });

  test('a session hierarchy is rejected, because it reads two partitions', () => {
    expect(() => scopePartition({ user_id: 'alice', session_id: 's1', scopeHierarchy: { session: 's1' } })).toThrow(InvalidScope);
  });
});
