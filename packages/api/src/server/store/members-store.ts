/**
 * MembersRepository — the workspace-membership (RBAC) DIP.
 *
 * Interface + in-memory impl colocate here (per `architecture.md § 3` DIP
 * pattern; the pg impl is the sibling `members-store-pg.ts`). The in-memory
 * impl makes the role×route + last-owner contract testable WITHOUT a DB; the
 * pg impl is exercised by the integration suite.
 *
 * Every method takes `workspaceId` as its FIRST parameter — a member op for a
 * workspace the caller does not belong to resolves to `not_found` (→ 404
 * upstream), the same owned()-scoping discipline the data repositories use.
 *
 * @see .claude/knowledge-base/plans/multi-tenant-rbac-and-slice1-completion-plan.md § T2.1
 */
import { randomBytes } from 'node:crypto';

import type { WorkspaceRole } from '@usetheo/memory/contract';

/** A workspace member as surfaced by the `/v1/members` list/mutation handlers. */
export interface Member {
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: WorkspaceRole;
  readonly createdAt: string;
}

export type AddMemberResult =
  | { readonly ok: true; readonly member: Member }
  | { readonly ok: false; readonly reason: 'duplicate' };

export type SetRoleResult =
  | { readonly ok: true; readonly member: Member }
  | { readonly ok: false; readonly reason: 'not_found' | 'last_owner' };

export type RemoveMemberResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_found' | 'last_owner' };

export interface MembersRepository {
  /** All members of the workspace. */
  list(workspaceId: string): Promise<Member[]>;
  /**
   * Add a member by email (creating the global user if new). Returns
   * `duplicate` when the email is already a member of THIS workspace.
   */
  addByEmail(
    workspaceId: string,
    input: { email: string; name?: string; role: WorkspaceRole },
  ): Promise<AddMemberResult>;
  /**
   * Change a member's role. Returns `last_owner` when the change would demote
   * the only remaining owner (the last-owner invariant), `not_found` when the
   * user is not a member of this workspace.
   */
  setRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<SetRoleResult>;
  /**
   * Remove a member. Returns `last_owner` when the removal would leave the
   * workspace with zero owners, `not_found` when the user is not a member.
   */
  remove(workspaceId: string, userId: string): Promise<RemoveMemberResult>;
  /** The member's role, or `null` when the user is not a member of this workspace. */
  getMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null>;
}

const VALID_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'member']);

/** True when `role` is one of the three enum values. */
export function isWorkspaceRole(role: unknown): role is WorkspaceRole {
  return typeof role === 'string' && VALID_ROLES.has(role);
}

function newUserId(): string {
  return `usr-${randomBytes(8).toString('hex')}`;
}

interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
  createdAt: string;
}

/**
 * In-memory MembersRepository — DB-less contract testing. The last-owner guard
 * is a plain count (no row-lock needed: single-threaded JS has no TOCTOU
 * window). The pg impl serializes the same guard with `SELECT ... FOR UPDATE`.
 */
export function createInMemoryMembersRepository(
  seed?: readonly { workspaceId: string; userId: string; email: string; name?: string; role: WorkspaceRole }[],
): MembersRepository {
  // workspaceId -> userId -> row
  const byWorkspace = new Map<string, Map<string, MemberRow>>();
  // global email -> userId (users span workspaces)
  const emailToUser = new Map<string, string>();

  function ws(workspaceId: string): Map<string, MemberRow> {
    let m = byWorkspace.get(workspaceId);
    if (m === undefined) {
      m = new Map();
      byWorkspace.set(workspaceId, m);
    }
    return m;
  }

  for (const s of seed ?? []) {
    emailToUser.set(s.email, s.userId);
    ws(s.workspaceId).set(s.userId, {
      userId: s.userId,
      email: s.email,
      name: s.name ?? null,
      role: s.role,
      createdAt: new Date(0).toISOString(),
    });
  }

  function ownerCount(workspaceId: string): number {
    let n = 0;
    for (const row of ws(workspaceId).values()) if (row.role === 'owner') n += 1;
    return n;
  }

  return {
    list(workspaceId: string): Promise<Member[]> {
      return Promise.resolve([...ws(workspaceId).values()].map((r) => ({ ...r })));
    },

    addByEmail(workspaceId, input): Promise<AddMemberResult> {
      const members = ws(workspaceId);
      const existingId = emailToUser.get(input.email);
      if (existingId !== undefined && members.has(existingId)) {
        return Promise.resolve({ ok: false, reason: 'duplicate' });
      }
      const userId = existingId ?? newUserId();
      emailToUser.set(input.email, userId);
      const row: MemberRow = {
        userId,
        email: input.email,
        name: input.name ?? null,
        role: input.role,
        createdAt: new Date(0).toISOString(),
      };
      members.set(userId, row);
      return Promise.resolve({ ok: true, member: { ...row } });
    },

    setRole(workspaceId, userId, role): Promise<SetRoleResult> {
      const members = ws(workspaceId);
      const row = members.get(userId);
      if (row === undefined) return Promise.resolve({ ok: false, reason: 'not_found' });
      if (row.role === 'owner' && role !== 'owner' && ownerCount(workspaceId) === 1) {
        return Promise.resolve({ ok: false, reason: 'last_owner' });
      }
      const updated: MemberRow = { ...row, role };
      members.set(userId, updated);
      return Promise.resolve({ ok: true, member: { ...updated } });
    },

    remove(workspaceId, userId): Promise<RemoveMemberResult> {
      const members = ws(workspaceId);
      const row = members.get(userId);
      if (row === undefined) return Promise.resolve({ ok: false, reason: 'not_found' });
      if (row.role === 'owner' && ownerCount(workspaceId) === 1) {
        return Promise.resolve({ ok: false, reason: 'last_owner' });
      }
      members.delete(userId);
      return Promise.resolve({ ok: true });
    },

    getMemberRole(workspaceId, userId): Promise<WorkspaceRole | null> {
      return Promise.resolve(ws(workspaceId).get(userId)?.role ?? null);
    },
  };
}
