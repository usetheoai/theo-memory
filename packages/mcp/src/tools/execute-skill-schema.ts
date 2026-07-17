/**
 * `execute_skill` tool — input schema, metadata, description.
 *
 * Runs a stored skill inside the hardened sandbox (agentic-skill-execution-sandbox
 * T2.4). Opt-in/gated: when the server's memory has no `SkillExecutor` wired, the
 * call returns a Tool Execution Error ("not configured"). Scope is the `repoId`
 * ARGUMENT (Repo tier), not the AsyncLocalStorage user/session/agent scope.
 *
 */
import { z } from 'zod';

export const TOOL_NAME = 'execute_skill' as const;

export const DESCRIPTION =
  'Execute a stored skill inside a hardened sandbox and return its captured output. Opt-in: only available when the deployment wired a skill executor (otherwise returns a not-configured error). Use to run a routine you previously authored with add_skill. args are passed as structured values; malicious code (Node/fs access, infinite loops, output floods) is denied.';

export const INPUT_SCHEMA = z.object({
  /** Repo the skill belongs to (Repo-tier scope). */
  repoId: z.string().min(1),
  /** Id of the stored skill to execute. */
  skillId: z.string().min(1),
  /** Structured args injected into the skill (never string-concatenated into source). */
  args: z.record(z.unknown()).default({}),
  /** Per-call execution bounds (bounded ceilings per review 2026-06-22 F-dom-conc-2). */
  opts: z
    .object({
      timeoutMs: z.number().int().positive().max(30_000).optional(),
      memoryLimitMb: z.number().int().positive().max(256).optional(),
      maxOutputBytes: z.number().int().positive().max(10_000_000).optional(),
    })
    .optional(),
});

export type ExecuteSkillInput = z.infer<typeof INPUT_SCHEMA>;
