/**
 * `add_skill` tool — input schema, metadata, description.
 *
 * Authors a reusable code-as-skill under a Repo-tier scope (skills-write-surface
 * T2.3 / D3). The skill is stored verbatim — TheMemory NEVER executes it
 * (store-only, D2). Scope is the `repoId` ARGUMENT (Repo tier), not the
 * AsyncLocalStorage user/session/agent scope.
 *
 * @see .claude/knowledge-base/plans/skills-write-surface-plan.md § T2.3
 */
import { z } from 'zod';

export const TOOL_NAME = 'add_skill' as const;

/** Code payload byte cap (DOS guard); mirrors the REST handler's cap. */
export const MAX_SKILL_CODE_BYTES = 64 * 1024;

export const DESCRIPTION =
  'Author a reusable skill (executable code-as-skill) under a repo. Stored verbatim — never executed by the memory layer. Use when you derive a routine worth recalling and reusing later. Skills are ADD-only: a duplicate description returns an error (revise the description or forget the existing skill first).';

export const INPUT_SCHEMA = z.object({
  /** Repo the skill belongs to (Repo-tier scope). */
  repoId: z.string().min(1),
  /** Executable code payload, stored verbatim. Capped at MAX_SKILL_CODE_BYTES. */
  code: z.string().min(1).max(MAX_SKILL_CODE_BYTES),
  /** Natural-language description — the embedding target AND the dedup identity. */
  description: z.string().min(1),
  /** Language tag of the code payload. */
  codeLanguage: z.enum(['typescript', 'javascript']),
});

export type AddSkillInput = z.infer<typeof INPUT_SCHEMA>;
