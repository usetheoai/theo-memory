/**
 * GET /v1/scopes/user/:id/sessions — session enumeration (session-separation
 * fix, 2026-07-23). The M8 model partitions memory into global `(workspace,
 * user)` and per-session `(workspace, user, session)` working memory, but the
 * sessions themselves were unenumerable — the dashboard SESSION tabs had no
 * instance selector. This surface lists the distinct sessions with live counts
 * + newest activity so a UI can offer a session picker.
 *
 * Member Principal binds to its own userId (cross-user IDOR guard — mirrors
 * `pathParamsToScoped`); workspace-admin honors the path id.
 */
import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import type { Context } from 'hono';

import { actingUserId, workspaceBoundMemory } from './_body-parsing.js';

export async function sessionsHandler(c: Context, memory: Memory): Promise<Response> {
  const type = c.req.param('type');
  const id = c.req.param('id');
  // Sessions belong to a USER anchor — any other scope type is not a resource.
  if (type !== 'user' || id === undefined || id.length === 0) {
    return c.notFound();
  }

  const userId = actingUserId(c);
  const scoped: ScopedMemory = workspaceBoundMemory(c, memory).user(userId ?? id);

  // Feature-detect: a legacy/cloud scoped memory without the capability is an
  // honest 501, never a silent empty list (Rule 8 + Princípio 3).
  if (typeof scoped.listSessions !== 'function') {
    return c.json(
      {
        code: 'SESSIONS_LISTING_NOT_SUPPORTED',
        message: 'The wired memory runtime does not support session enumeration.',
      },
      501,
    );
  }

  const sessions = await scoped.listSessions();
  return c.json({ sessions }, 200);
}
