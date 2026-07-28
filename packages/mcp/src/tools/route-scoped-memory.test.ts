/**
 * M8 routing (F-xval-1) — `routeScopedMemory` lets the AGENT choose global
 * `(workspace, user)` vs session `(workspace, user, session)` per call, while the
 * user identity ALWAYS comes from the auth-trusted `ScopedContext` (never the agent),
 * so the routing choice can never cross the (workspace, user) isolation boundary — the
 * agent only picks a session sub-partition of its OWN user space.
 */
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, it, vi } from 'vitest';


import { routeScopedMemory } from './route-scoped-memory.js';

function mockMemory(): { memory: unknown; userFn: ReturnType<typeof vi.fn>; sessionFn: ReturnType<typeof vi.fn> } {
  const scoped = { remember: vi.fn(), recall: vi.fn(), reflect: vi.fn(), getAll: vi.fn() };
  const userFn = vi.fn().mockReturnValue(scoped);
  const sessionFn = vi.fn().mockReturnValue(scoped);
  const wsMemory = {
    user: userFn,
    session: sessionFn,
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn().mockReturnValue(scoped),
    forget: vi.fn(),
    get: vi.fn(),
    history: vi.fn(),
    reset: vi.fn(),
    flushReflections: vi.fn(),
    listSkillsBySubject: vi.fn(),
  };
  const memory = { ...wsMemory, withWorkspace: vi.fn().mockReturnValue(wsMemory) };
  return { memory, userFn, sessionFn };
}

const CTX = { workspaceId: 'ws', session: { userId: 'alice' } };

describe('routeScopedMemory — agent chooses global vs session (M8 routing)', () => {
  it('test_routes_to_global_user_tier_when_no_sessionId', () => {
    const { memory, userFn, sessionFn } = mockMemory();
    withScope(CTX, () => routeScopedMemory(memory as never));
    expect(userFn).toHaveBeenCalledWith('alice');
    expect(sessionFn).not.toHaveBeenCalled();
  });

  it('test_routes_to_session_tier_bound_to_auth_userId_when_sessionId_present', () => {
    const { memory, userFn, sessionFn } = mockMemory();
    withScope(CTX, () => routeScopedMemory(memory as never, 's1'));
    // userId is the auth-trusted ctx.session.userId, NOT anything the agent supplied.
    expect(sessionFn).toHaveBeenCalledWith('s1', 'alice');
    expect(userFn).not.toHaveBeenCalled();
  });

  it('test_empty_sessionId_falls_back_to_global', () => {
    const { memory, userFn, sessionFn } = mockMemory();
    withScope(CTX, () => routeScopedMemory(memory as never, '   '));
    expect(userFn).toHaveBeenCalledWith('alice');
    expect(sessionFn).not.toHaveBeenCalled();
  });
});
