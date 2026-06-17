/**
 * POST /v1/forget handler.
 *
 * `Memory.forget(memoryId, options?)` is TOP-LEVEL on Memory (no scope) per
 * v0.4b T7.1 PUBLIC API. Body shape: `{ memoryId, hard? }`.
 */
import type { Memory } from '@usetheo/memory/contract';
import { MemoryNotFound, WorkspaceMismatch } from '@usetheo/memory/contract';
import type { Context } from 'hono';

import { ForgetBody } from '../schemas.js';

import { EMPTY_BODY, MALFORMED_BODY, safeJson, workspaceBoundMemory } from './_body-parsing.js';

export async function forgetHandler(c: Context, memory: Memory): Promise<Response> {
  const json = await safeJson(c);
  if (json === MALFORMED_BODY) {
    return c.json({ code: 'BAD_REQUEST', message: 'Malformed JSON body' }, 400);
  }
  if (json === EMPTY_BODY) {
    return c.json(
      { code: 'INVALID_BODY', message: 'Request body required' },
      422,
    );
  }
  const parsed = ForgetBody.safeParse(json);
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Body invalid' },
      422,
    );
  }
  const { memoryId, hard } = parsed.data;
  // multi-tenant-workspace-isolation T3.1 / EC-5 + D6: forget within the
  // Principal's workspace. A cross-workspace (or missing) id throws
  // MemoryNotFound → 404 (NOT 403 — no existence leak), and the other
  // workspace's row is never touched.
  const scopedMemory = workspaceBoundMemory(c, memory);
  try {
    await scopedMemory.forget(memoryId, hard !== undefined ? { hard } : undefined);
  } catch (err) {
    // Both a missing id (MemoryNotFound) and a cross-workspace id
    // (WorkspaceMismatch) map to 404 — never 403, no existence leak (ADR D6).
    if (err instanceof MemoryNotFound || err instanceof WorkspaceMismatch) {
      return c.json({ code: 'NOT_FOUND', message: 'Memory not found' }, 404);
    }
    throw err;
  }
  return c.body(null, 204);
}
