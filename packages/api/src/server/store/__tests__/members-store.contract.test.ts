/**
 * T2.1 — MembersRepository contract (in-memory; DB-less).
 *
 * Exercises the last-owner invariant + addByEmail duplicate detection +
 * cross-workspace not_found on the in-memory impl. The same contract is
 * enforced (with row-locking) by the pg impl in the integration suite.
 *
 */
import { describe, expect, it } from 'vitest';

import { createInMemoryMembersRepository } from '../members-store.js';

describe('MembersRepository (in-memory) — last-owner invariant', () => {
  it('refuses to demote the only owner (last_owner)', async () => {
    const repo = createInMemoryMembersRepository([
      { workspaceId: 'ws', userId: 'u-owner', email: 'o@x', role: 'owner' },
    ]);
    const res = await repo.setRole('ws', 'u-owner', 'member');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('last_owner');
  });

  it('allows demoting the first owner once a second owner exists', async () => {
    const repo = createInMemoryMembersRepository([
      { workspaceId: 'ws', userId: 'u1', email: 'a@x', role: 'owner' },
      { workspaceId: 'ws', userId: 'u2', email: 'b@x', role: 'owner' },
    ]);
    const res = await repo.setRole('ws', 'u1', 'member');
    expect(res.ok).toBe(true);
  });

  it('refuses to remove the only owner (last_owner)', async () => {
    const repo = createInMemoryMembersRepository([
      { workspaceId: 'ws', userId: 'u-owner', email: 'o@x', role: 'owner' },
    ]);
    const res = await repo.remove('ws', 'u-owner');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('last_owner');
  });

  it('allows removing a non-owner', async () => {
    const repo = createInMemoryMembersRepository([
      { workspaceId: 'ws', userId: 'u-owner', email: 'o@x', role: 'owner' },
      { workspaceId: 'ws', userId: 'u-mem', email: 'm@x', role: 'member' },
    ]);
    const res = await repo.remove('ws', 'u-mem');
    expect(res.ok).toBe(true);
  });
});

describe('MembersRepository (in-memory) — addByEmail + scoping', () => {
  it('adds a member, then reports duplicate on the same email in the same workspace', async () => {
    const repo = createInMemoryMembersRepository();
    const first = await repo.addByEmail('ws', { email: 'new@x', role: 'member' });
    expect(first.ok).toBe(true);
    const second = await repo.addByEmail('ws', { email: 'new@x', role: 'admin' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('duplicate');
  });

  it('the same email can be a member of two different workspaces', async () => {
    const repo = createInMemoryMembersRepository();
    expect((await repo.addByEmail('ws-a', { email: 'shared@x', role: 'member' })).ok).toBe(true);
    expect((await repo.addByEmail('ws-b', { email: 'shared@x', role: 'owner' })).ok).toBe(true);
  });

  it('setRole on a member of another workspace is not_found (no cross-workspace mutation)', async () => {
    const repo = createInMemoryMembersRepository([
      { workspaceId: 'ws-a', userId: 'u-a', email: 'a@x', role: 'member' },
    ]);
    const res = await repo.setRole('ws-b', 'u-a', 'admin');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not_found');
  });

  it('getMemberRole returns the role, or null for a non-member', async () => {
    const repo = createInMemoryMembersRepository([
      { workspaceId: 'ws', userId: 'u-admin', email: 'a@x', role: 'admin' },
    ]);
    expect(await repo.getMemberRole('ws', 'u-admin')).toBe('admin');
    expect(await repo.getMemberRole('ws', 'ghost')).toBeNull();
  });
});
