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
import type { Context } from 'hono';
import { z } from 'zod';

import { workspaceBoundMemory } from './_body-parsing.js';

/** Listing cap (DOS guard + consistent with the memories endpoint's max). */
const MAX_TOP_K = 100;
const DEFAULT_TOP_K = 100;

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
  const skills = await scoped.getAll(
    includeSuperseded === true ? { includeSuperseded: true, topK } : { topK },
  );

  // EC-4 — honest truncation disclosure when the cap was hit.
  const truncated = skills.length >= topK;

  return c.json({ skills: skills.map(toDto), truncated }, 200);
}
