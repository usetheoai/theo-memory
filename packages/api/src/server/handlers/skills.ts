/**
 * GET /v1/scopes/skill/:repoId/skills — read-only skills listing.
 *
 * dashboard-phase2b-skills-browse T2.1 (blueprint ADR D2). A dedicated
 * sub-resource for the Repo-tier skill library — distinct from the generic
 * `/v1/scopes/:type/:id/memories` endpoint, which keeps returning
 * `501 SKILL_LISTING_NOT_IMPLEMENTED` for `type=skill` (ADR D5). Skills carry a
 * code payload + provenance the memories projection does not surface, so they
 * get their own shape.
 *
 * EC-1 (workspace parity): resolves `memory.skills(repoId)` through the
 * workspace-bound Memory (`workspaceBoundMemory`), exactly like the memories /
 * metrics / entities handlers — otherwise a multi-workspace deployment would
 * list the wrong workspace OR return empty for a non-default one.
 *
 * EC-4 (truncation honesty): `getAll` is capped at `topK`; when the returned
 * count equals the cap, the response sets `truncated:true` so the dashboard can
 * disclose "showing first N" (Inquebrável Rule 3) rather than silently hiding
 * the tail.
 *
 * SCOPE = the repoId (Repo tier). Multi-tenant isolation across customers is the
 * gateway's job (it namespaces repoId by the authenticated subject, plan D3);
 * this endpoint lists whatever repoId is requested within the key's workspace,
 * consistent with the memories endpoint (EC-6).
 */
import type { Memory, Skill } from '@usetheo/memory/contract';
import { InvalidSkillError, MemoryNotFound, SkillAlreadyExists } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { EMPTY_BODY, MALFORMED_BODY, safeJson, workspaceBoundMemory } from './_body-parsing.js';

/** Listing cap (DOS guard + consistent with the memories endpoint's max). */
const MAX_TOP_K = 100;
const DEFAULT_TOP_K = 100;

/**
 * skills-write-surface T2.1 — code payload byte cap (DOS guard, tighter than the
 * 1 MiB remember body limit since a single skill should be modest). Oversize →
 * 413. Adjustable (Unresolved Q1).
 */
const MAX_SKILL_CODE_BYTES = 64 * 1024;

const PostSkillSchema = z
  .object({
    code: z.string().min(1),
    description: z.string().min(1),
    codeLanguage: z.enum(['typescript', 'javascript']),
  })
  .strict();

const QuerySchema = z.object({
  includeSuperseded: z.coerce.boolean().optional(),
  topK: z.coerce.number().int().min(1).max(MAX_TOP_K).default(DEFAULT_TOP_K),
});

interface SkillDto {
  readonly id: string;
  readonly hash: string;
  readonly description: string;
  readonly code: string | null;
  readonly codeLanguage: string | null;
  readonly createdAt: string;
  readonly derivedFrom: readonly string[];
  readonly supersededBy: string | null;
}

function toDto(s: Skill): SkillDto {
  return {
    id: s.id,
    hash: s.hash,
    description: s.description,
    code: s.code,
    codeLanguage: s.codeLanguage,
    createdAt: s.createdAt.toISOString(),
    derivedFrom: s.derivedFrom,
    supersededBy: s.supersededBy,
  };
}

export async function skillsHandler(c: Context, memory: Memory): Promise<Response> {
  const repoId = c.req.param('repoId');
  if (repoId === undefined || repoId.length === 0) {
    return c.json(
      { code: 'INVALID_SCOPE', message: 'repoId path segment is required and must be non-empty.' },
      400,
    );
  }

  const queryParse = QuerySchema.safeParse({
    includeSuperseded: c.req.query('includeSuperseded'),
    topK: c.req.query('topK'),
  });
  if (!queryParse.success) {
    return c.json(
      {
        code: 'INVALID_QUERY',
        message: queryParse.error.issues[0]?.message ?? 'Invalid query string',
      },
      422,
    );
  }
  const { includeSuperseded, topK } = queryParse.data;

  // EC-1 — resolve via the workspace-bound Memory (parity with memories/metrics).
  const scoped = workspaceBoundMemory(c, memory).skills(repoId);
  // EC-4 — over-fetch ONE past the cap so truncation disclosure is exact: a repo
  // with EXACTLY `topK` skills must report `truncated:false` (not a false
  // positive). We request topK+1, then truncate to topK for the response.
  const fetched = await scoped.getAll(
    includeSuperseded === true ? { includeSuperseded: true, topK: topK + 1 } : { topK: topK + 1 },
  );
  const truncated = fetched.length > topK;
  const page = truncated ? fetched.slice(0, topK) : fetched;

  return c.json({ skills: page.map(toDto), truncated }, 200);
}

/**
 * POST /v1/scopes/skill/:repoId/skills — create a skill (skills-write-surface T2.1).
 * Body = SkillDraft {code, description, codeLanguage}. 201 on success; 409 on
 * dedup-collision (D1); 422 on invalid body / language / empty fields; 413 on
 * oversized code; 400 on empty repoId. Workspace-bound (EC-1 parity); store-only.
 */
export async function postSkillHandler(c: Context, memory: Memory): Promise<Response> {
  const repoId = c.req.param('repoId');
  if (repoId === undefined || repoId.length === 0) {
    return c.json(
      { code: 'INVALID_SCOPE', message: 'repoId path segment is required and must be non-empty.' },
      400,
    );
  }

  const json = await safeJson(c);
  if (json === MALFORMED_BODY) {
    return c.json({ code: 'BAD_REQUEST', message: 'Malformed JSON body' }, 400);
  }
  if (json === EMPTY_BODY) {
    return c.json({ code: 'INVALID_BODY', message: 'Request body required' }, 422);
  }
  const parsed = PostSkillSchema.safeParse(json);
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid skill body' },
      422,
    );
  }
  // EC: code size cap (DOS guard) — 413 Payload Too Large.
  if (Buffer.byteLength(parsed.data.code, 'utf8') > MAX_SKILL_CODE_BYTES) {
    return c.json(
      { code: 'PAYLOAD_TOO_LARGE', message: `code exceeds ${String(MAX_SKILL_CODE_BYTES)} bytes` },
      413,
    );
  }

  const scoped = workspaceBoundMemory(c, memory).skills(repoId);
  try {
    const skill = await scoped.add(parsed.data);
    return c.json({ id: skill.id, hash: skill.hash }, 201);
  } catch (err) {
    if (err instanceof SkillAlreadyExists) {
      return c.json({ code: 'SKILL_ALREADY_EXISTS', message: err.message }, 409);
    }
    if (err instanceof InvalidSkillError) {
      return c.json({ code: 'INVALID_BODY', message: err.message }, 422);
    }
    throw err;
  }
}

/**
 * DELETE /v1/scopes/skill/:repoId/skills/:skillId — forget (curate) a skill
 * (skills-write-surface T2.2, D4). 204 on success; 404 when the id is not a skill
 * in this repo's scope (`MemoryNotFound`, scope-isolated). Workspace-bound.
 */
export async function deleteSkillHandler(c: Context, memory: Memory): Promise<Response> {
  const repoId = c.req.param('repoId');
  const skillId = c.req.param('skillId');
  if (repoId === undefined || repoId.length === 0 || skillId === undefined || skillId.length === 0) {
    return c.json(
      { code: 'INVALID_SCOPE', message: 'repoId and skillId path segments are required.' },
      400,
    );
  }
  const scoped = workspaceBoundMemory(c, memory).skills(repoId);
  try {
    await scoped.forget(skillId);
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof MemoryNotFound) {
      return c.json({ code: 'NOT_FOUND', message: err.message }, 404);
    }
    throw err;
  }
}
