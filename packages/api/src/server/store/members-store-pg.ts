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
 * @see .claude/knowledge-base/plans/multi-tenant-rbac-and-slice1-completion-plan.md § T2.1 + ADR D3
 */
import { randomBytes } from 'node:crypto';

import type { WorkspaceRole } from '@usetheo/memory/contract';

import type { AuthPool, AuthPoolClient } from '../auth/api-key-verifier.js';

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
  async function runInTx<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T> {
    // FOR UPDATE requires a pinned connection; pool.query may pick different
    // connections per statement under pg.Pool.
    if (pool.connect === undefined) {
      // No connection pinning available (stub pool) — best effort without lock.
      return fn(pool);
    }
    const client: AuthPoolClient = await pool.connect();
    try {
      await client.query('BEGIN', []);
      const out = await fn(client);
      await client.query('COMMIT', []);
      return out;
    } catch (err) {
      try {
        await client.query('ROLLBACK', []);
      } catch {
        /* swallow double-rollback */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async function ownerCount(tx: QueryRunner, workspaceId: string): Promise<number> {
    const { rows } = await tx.query<{ role: string }>(
      `SELECT role FROM workspace_users WHERE workspace_id = $1 FOR UPDATE`,
      [workspaceId],
    );
    return rows.filter((r) => r.role === 'owner').length;
  }

  return {
    async list(workspaceId: string): Promise<Member[]> {
      const { rows } = await pool.query<{
        user_id: string;
        email: string;
        name: string | null;
        role: string;
        created_at: Date | string;
      }>(LIST_SQL, [workspaceId]);
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
      const ins = await pool.query<{ created_at: Date | string }>(
        `INSERT INTO workspace_users (workspace_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING
         RETURNING created_at`,
        [workspaceId, userId, input.role],
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
      return runInTx(async (tx) => {
        const target = await tx.query<{ role: string }>(
          `SELECT role FROM workspace_users WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
          [workspaceId, userId],
        );
        const current = target.rows[0];
        if (current === undefined) return { ok: false, reason: 'not_found' };
        const owners = await ownerCount(tx, workspaceId);
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
      return runInTx(async (tx) => {
        const target = await tx.query<{ role: string }>(
          `SELECT role FROM workspace_users WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
          [workspaceId, userId],
        );
        const current = target.rows[0];
        if (current === undefined) return { ok: false, reason: 'not_found' };
        const owners = await ownerCount(tx, workspaceId);
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
      const { rows } = await pool.query<{ role: string }>(
        `SELECT role FROM workspace_users WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
        [workspaceId, userId],
      );
      const role = rows[0]?.role;
      return role !== undefined && isWorkspaceRole(role) ? role : null;
    },
  };
}
