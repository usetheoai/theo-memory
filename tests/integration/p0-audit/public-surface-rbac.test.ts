/**
 * T4.1 — public-surface contract test for the RBAC role primitives.
 *
 * Asserts the role types/helpers ship through the PUBLIC barrels a third-party
 * consumer imports — the P0 sub-goal-1 "APIs correct" contract:
 *   - `WorkspaceRole`, `roleSatisfies`, `DEFAULT_OWNER_USER_ID` reachable via
 *     `@usetheo/memory/contract` (core domain barrel).
 *   - `requireRole`, `MembersRepository`, `createInMemoryMembersRepository`,
 *     `WorkspaceRole`, `roleSatisfies` reachable via `@usetheo/memory-api`
 *     (server barrel) — so a custom server composition can role-gate routes.
 *
 * Pure import + behavior test (no pgvector) — runs regardless of THEOMEM_PG_URI.
 *
 * @see .claude/knowledge-base/plans/multi-tenant-rbac-and-slice1-completion-plan.md § T4.1
 */
import { describe, expect, test } from 'vitest';

import {
  roleSatisfies,
  DEFAULT_OWNER_USER_ID,
  type WorkspaceRole,
} from '@usetheo/memory/contract';
import {
  requireRole,
  roleSatisfies as roleSatisfiesFromServer,
  createInMemoryMembersRepository,
  isWorkspaceRole,
  type MembersRepository,
} from '@usetheo/memory-api';

describe('public surface — RBAC role primitives (T4.1)', () => {
  test('roleSatisfies enforces the owner ⊇ admin ⊇ member ordinal order', () => {
    expect(roleSatisfies('owner', 'admin')).toBe(true);
    expect(roleSatisfies('admin', 'admin')).toBe(true);
    expect(roleSatisfies('member', 'admin')).toBe(false);
    expect(roleSatisfies('member', 'owner')).toBe(false);
    expect(roleSatisfies('owner', 'member')).toBe(true);
  });

  test('DEFAULT_OWNER_USER_ID is the stable seeded-owner id', () => {
    expect(DEFAULT_OWNER_USER_ID).toBe('default-owner');
  });

  test('the role primitives are reachable via @usetheo/memory/server too', () => {
    expect(typeof requireRole).toBe('function');
    expect(roleSatisfiesFromServer('owner', 'member')).toBe(true);
    expect(isWorkspaceRole('admin')).toBe(true);
    expect(isWorkspaceRole('superuser')).toBe(false);
  });

  test('createInMemoryMembersRepository returns a contract-shaped MembersRepository', async () => {
    const repo: MembersRepository = createInMemoryMembersRepository();
    const added = await repo.addByEmail('ws-a', { email: 'alice@example.com', role: 'admin' });
    expect(added.ok).toBe(true);
    const role: WorkspaceRole | null = await repo.getMemberRole('ws-a', added.ok ? added.member.userId : '');
    expect(role).toBe('admin');
    // Cross-workspace lookup is isolated (the same user id is unknown in ws-b).
    const crossWs = await repo.getMemberRole('ws-b', added.ok ? added.member.userId : '');
    expect(crossWs).toBeNull();
  });
});
