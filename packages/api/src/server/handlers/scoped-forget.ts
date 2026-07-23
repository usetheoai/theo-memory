/**
 * DELETE /v1/scopes/:type/:id/memories/:memId — subject-scoped forget
 * (themory-scoped-forget T1.2, ADR D1/D5).
 *
 * Deletes a memory ONLY if it belongs to the named subject scope (+ the
 * authenticated workspace). Subject comes from the PATH; workspace from the
 * credential — NEVER from the body. A cross-scope / cross-workspace / missing id
 * maps to 404 (via MemoryNotFound / WorkspaceMismatch) — NEVER 403, no existence
 * leak. `?hard=true` performs a GDPR-style physical erasure (default soft).
 *
 * Lets the theo-cloud gateway delete-by-id without an O(scope) `listAll()`
 * ownership pre-check.
 */
import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import { MemoryNotFound, WorkspaceMismatch } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { actingUserId, workspaceBoundMemory } from './_body-parsing.js';

const SCOPE_TYPES = ['user', 'session', 'agent'] as const;
const ScopeTypeSchema = z.enum(SCOPE_TYPES);
type ScopeType = (typeof SCOPE_TYPES)[number];

function pathParamsToScoped(memory: Memory, type: ScopeType, id: string, userId?: string): ScopedMemory {
  switch (type) {
    case 'user':
      // M8 F-arch-1: bind the user tier to the auth Principal (userId) when present
      // so a user-Principal can only address its OWN global scope; null (admin) → path id.
      return memory.user(userId ?? id);
    case 'session':
      return memory.session(id, userId);
    case 'agent':
      return memory.agent(id, userId);
  }
}

export async function scopedForgetHandler(c: Context, memory: Memory): Promise<Response> {
  // type ∈ {user,session,agent}; skill + unknown → 404 (no per-memory DELETE).
  const typeParse = ScopeTypeSchema.safeParse(c.req.param('type'));
  const id = c.req.param('id');
  if (!typeParse.success || id === undefined || id.length === 0) {
    return c.notFound();
  }
  // memId MUST be a UUID — a malformed id is a bad request (422), distinct from
  // a well-formed-but-not-found id (404).
  const memId = c.req.param('memId');
  if (memId === undefined || !z.string().uuid().safeParse(memId).success) {
    return c.json({ code: 'INVALID', message: 'memId must be a UUID' }, 422);
  }
  // `?hard=true` EXACTLY → hard delete; anything else (incl. "false") → soft.
  const hard = c.req.query('hard') === 'true';

  const scoped = pathParamsToScoped(workspaceBoundMemory(c, memory), typeParse.data, id, actingUserId(c));
  try {
    await scoped.forget(memId, hard ? { hard: true } : undefined);
  } catch (err) {
    // Cross-scope (MemoryNotFound) and cross-workspace (WorkspaceMismatch) both
    // → 404 (never 403 — no existence leak), mirroring POST /v1/forget.
    if (err instanceof MemoryNotFound || err instanceof WorkspaceMismatch) {
      return c.json({ code: 'NOT_FOUND', message: 'Memory not found' }, 404);
    }
    throw err;
  }
  return c.body(null, 204);
}
