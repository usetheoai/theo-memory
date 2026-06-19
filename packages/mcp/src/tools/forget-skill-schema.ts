/**
 * `forget_skill` tool — input schema, metadata, description.
 *
 * Curation: delete a skill from a repo (skills-write-surface T2.3 / D4).
 * Scope-isolated — only a skill in the given repo can be forgotten.
 *
 * @see .claude/knowledge-base/plans/skills-write-surface-plan.md § T2.3
 */
import { z } from 'zod';

export const TOOL_NAME = 'forget_skill' as const;

export const DESCRIPTION =
  'Forget (delete) a skill from a repo by id — scope-isolated curation. Use to remove a bad or obsolete skill. Idempotent: forgetting an id that is not a skill in this repo succeeds silently.';

export const INPUT_SCHEMA = z.object({
  /** Repo the skill belongs to (Repo-tier scope). */
  repoId: z.string().min(1),
  /** The skill id to forget. */
  skillId: z.string().min(1),
});

export type ForgetSkillInput = z.infer<typeof INPUT_SCHEMA>;
