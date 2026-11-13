/**
 * Postgres MembersRepository — the RBAC membership store against real pg.
 *
 * The last-owner invariant (a workspace never loses its only owner) is enforced
 * ATOMICALLY: `setRole`/`remove` open a transaction, `SELECT ... FOR UPDATE` the
 * workspace's membership rows to serialize concurrent demotions, run the
 * owner-count guard, then mutate in the SAME transaction. Without the row-lock,
 * two concurrent demotions both read `owners=2` and both demote → zero owners
 * (permanent lockout). Mirrors the theo-rag `members-store-pg.ts` reference.
 *
 * Raw SQL via {@link AuthPool} (consistent with `admin-keys.ts`) so `src/server`
 * stays free of a drizzle runtime dependency.
 *
 */
import { randomBytes } from 'node:crypto';

import type { WorkspaceRole } from '@usetheo/memory/contract';

import type { AuthPool } from '../auth/api-key-verifier.js';
import { withWorkspaceContext } from '../auth/workspace-context.js';

import {
  isWorkspaceRole,
  type AddMemberResult,
  type Member,
  type MembersRepository,
  type RemoveMemberResult,
  type SetRoleResult,
} from './members-store.js';

interface QueryRunner {
  query<T>(sql: string, params: readonly unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

function newUserId(): string {
  return `usr-${randomBytes(8).toString('hex')}`;
}

function rowToMember(r: {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: Date | string;
}): Member {
  return {
    userId: r.user_id,
    email: r.email,
    name: r.name,
    role: isWorkspaceRole(r.role) ? r.role : 'member',
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

const LIST_SQL = `\
SELECT m.user_id, u.email, u.name, m.role, m.created_at
  FROM workspace_users m
  JOIN users u ON u.id = m.user_id
 WHERE m.workspace_id = $1
 ORDER BY m.created_at ASC`;

export function createPostgresMembersRepository(pool: AuthPool): MembersRepository {
  /**
   * One transaction on one pinned connection (FOR UPDATE needs it), with
   * `app.workspace_id` set for its duration: `workspace_users` is under FORCE ROW
   * LEVEL SECURITY, and this repository runs on the raw pool with no request scope,
   * so without the context every read is empty and every write fails its WITH
   * CHECK (#227). The workspace is the one the caller's own key belongs to.
   */
  function runInTx<T>(workspaceId: string, fn: (tx: QueryRunner) => Promise<T>): Promise<T> {
    return withWorkspaceContext(pool, workspaceId, fn);
  }

  /**
   * Lock the ENTIRE workspace's membership rows in one FOR UPDATE acquisition
   * and return them. multi-tenant-rbac-and-slice1-completion (F-dom-db-3): a
   * single deterministic lock acquisition (all rows, by physical order) — both
   * setRole and remove derive the target + owner-count from this locked set
   * instead of taking a per-target lock THEN the all-rows lock, which inverted
   * the lock order between two concurrent demotions of DIFFERENT targets and
   * could deadlock (40P01 → 500). The last-owner invariant + the same-target
   * serialization are preserved.
   */
  async function lockMembership(
    tx: QueryRunner,
    workspaceId: string,
  ): Promise<{ user_id: string; role: string }[]> {
    const { rows } = await tx.query<{ user_id: string; role: string }>(
      `SELECT user_id, role FROM workspace_users WHERE workspace_id = $1 FOR UPDATE`,
      [workspaceId],
    );
    return rows;
  }

  return {
    async list(workspaceId: string): Promise<Member[]> {
      const { rows } = await runInTx(workspaceId, (tx) =>
        tx.query<{
          user_id: string;
          email: string;
          name: string | null;
          role: string;
          created_at: Date | string;
        }>(LIST_SQL, [workspaceId]),
      );
      return rows.map(rowToMember);
    },

    async addByEmail(workspaceId, input): Promise<AddMemberResult> {
      // Resolve-or-create the global user by email.
      const found = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
        input.email,
      ]);
      let userId = found.rows[0]?.id;
      if (userId === undefined) {
        userId = newUserId();
        await pool.query(
          `INSERT INTO users (id, email, name) VALUES ($1, $2, $3)
           ON CONFLICT (email) DO NOTHING`,
          [userId, input.email, input.name ?? null],
        );
        // Race: another writer inserted the same email between SELECT and INSERT.
        const reread = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
          input.email,
        ]);
        userId = reread.rows[0]?.id ?? userId;
      }
      const memberUserId = userId;
      const ins = await runInTx(workspaceId, (tx) =>
        tx.query<{ created_at: Date | string }>(
          `INSERT INTO workspace_users (workspace_id, user_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, user_id) DO NOTHING
           RETURNING created_at`,
          [workspaceId, memberUserId, input.role],
        ),
      );
      if (ins.rows.length === 0) {
        return { ok: false, reason: 'duplicate' };
      }
      const created = ins.rows[0]?.created_at ?? new Date();
      return {
        ok: true,
        member: {
          userId,
          email: input.email,
          name: input.name ?? null,
          role: input.role,
          createdAt: created instanceof Date ? created.toISOString() : created,
        },
      };
    },

    async setRole(workspaceId, userId, role): Promise<SetRoleResult> {
      return runInTx(workspaceId, async (tx) => {
        const locked = await lockMembership(tx, workspaceId);
        const current = locked.find((r) => r.user_id === userId);
        if (current === undefined) return { ok: false, reason: 'not_found' };
        const owners = locked.filter((r) => r.role === 'owner').length;
        if (current.role === 'owner' && role !== 'owner' && owners === 1) {
          return { ok: false, reason: 'last_owner' };
        }
        await tx.query(
          `UPDATE workspace_users SET role = $3 WHERE workspace_id = $1 AND user_id = $2`,
          [workspaceId, userId, role],
        );
        const view = await tx.query<{
          user_id: string;
          email: string;
          name: string | null;
          role: string;
          created_at: Date | string;
        }>(
          `SELECT m.user_id, u.email, u.name, m.role, m.created_at
             FROM workspace_users m JOIN users u ON u.id = m.user_id
            WHERE m.workspace_id = $1 AND m.user_id = $2`,
          [workspaceId, userId],
        );
        const row = view.rows[0];
        if (row === undefined) return { ok: false, reason: 'not_found' };
        return { ok: true, member: rowToMember(row) };
      });
    },

    async remove(workspaceId, userId): Promise<RemoveMemberResult> {
      return runInTx(workspaceId, async (tx) => {
        const locked = await lockMembership(tx, workspaceId);
        const current = locked.find((r) => r.user_id === userId);
        if (current === undefined) return { ok: false, reason: 'not_found' };
        const owners = locked.filter((r) => r.role === 'owner').length;
        if (current.role === 'owner' && owners === 1) {
          return { ok: false, reason: 'last_owner' };
        }
        await tx.query(`DELETE FROM workspace_users WHERE workspace_id = $1 AND user_id = $2`, [
          workspaceId,
          userId,
        ]);
        return { ok: true };
      });
    },

    async getMemberRole(workspaceId, userId): Promise<WorkspaceRole | null> {
      const { rows } = await runInTx(workspaceId, (tx) =>
        tx.query<{ role: string }>(
          `SELECT role FROM workspace_users WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
          [workspaceId, userId],
        ),
      );
      const role = rows[0]?.role;
      return role !== undefined && isWorkspaceRole(role) ? role : null;
    },
  };
}
