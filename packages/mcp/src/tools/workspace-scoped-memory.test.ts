/**
 * Tests for `workspaceScopedMemory` — plan `mcp-workspace-binding-isolation` T1.2.
 *
 * The helper is the single workspace-binding seam (ADR D1). Its contract:
 *  - binds `memory.withWorkspace(ws)` when the active scope carries a workspaceId;
 *  - passes memory through unchanged when no workspaceId (single-tenant default);
 *  - FAILS CLOSED (throws) when a workspaceId is set but `withWorkspace` is absent
 *    (ADR D3 / EC-1 — never serve unbound in multi-tenant mode, theo-memory#82);
 *  - relies on an active `withScope` (EC-3 precondition — throws MissingScopeError
 *    outside one, like every existing handler).
 */

import { MissingScopeError } from '@usetheo/memory/contract';
import type { Memory } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

describe('workspaceScopedMemory (T1.2 — single workspace-binding seam)', () => {
  it('binds withWorkspace(ws) when the active scope carries a workspaceId', async () => {
    const { workspaceScopedMemory } = await import('./workspace-scoped-memory.js');
    const bound = mock<Memory>();
    const memory = mock<Memory>();
    vi.mocked(memory.withWorkspace!).mockReturnValue(bound);

    const result = withScope({ workspaceId: 'tn-A', session: { userId: 'u' } }, () =>
      workspaceScopedMemory(memory),
    );

    expect(vi.mocked(memory.withWorkspace!)).toHaveBeenCalledWith('tn-A');
    expect(result).toBe(bound);
  });

  it('passes memory through unchanged when the scope has no workspaceId (single-tenant default)', async () => {
    const { workspaceScopedMemory } = await import('./workspace-scoped-memory.js');
    const memory = mock<Memory>();

    const result = withScope({ session: { userId: 'u' } }, () => workspaceScopedMemory(memory));

    expect(result).toBe(memory);
    expect(vi.mocked(memory.withWorkspace!)).not.toHaveBeenCalled();
  });

  it('treats an empty / whitespace workspaceId as absent (passthrough — single-tenant)', async () => {
    const { workspaceScopedMemory } = await import('./workspace-scoped-memory.js');
    const memory = mock<Memory>();

    for (const ws of ['', '   ']) {
      const result = withScope({ workspaceId: ws, session: { userId: 'u' } }, () =>
        workspaceScopedMemory(memory),
      );
      expect(result).toBe(memory);
    }
    expect(vi.mocked(memory.withWorkspace!)).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED (throws) when a workspaceId is set but Memory has no withWorkspace (ADR D3 / EC-1)', async () => {
    const { workspaceScopedMemory } = await import('./workspace-scoped-memory.js');
    // A Memory impl that predates workspace isolation: no withWorkspace method.
    const memory = { user: vi.fn(), forget: vi.fn() } as unknown as Memory;

    expect(() =>
      withScope({ workspaceId: 'tn-A', session: { userId: 'u' } }, () =>
        workspaceScopedMemory(memory),
      ),
    ).toThrow(/withWorkspace/);
  });

  it('throws MissingScopeError when called outside any withScope (EC-3 precondition)', async () => {
    const { workspaceScopedMemory } = await import('./workspace-scoped-memory.js');
    const memory = mock<Memory>();

    expect(() => workspaceScopedMemory(memory)).toThrow(MissingScopeError);
  });
});
