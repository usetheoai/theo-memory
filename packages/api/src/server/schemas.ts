/**
 * Shared zod schemas for the 4 REST verb bodies.
 *
 * **ADR D12 / EC-9 absorption** — single scope tier per request enforced via
 * `superRefine` counting present tier keys. Exactly one of `userId`,
 * `sessionId`, `agentId` MUST be present; 0 or ≥2 raise an `INVALID_SCOPE`
 * issue. zod's plain `.union()` cannot enforce this reliably because no
 * discriminator key exists — see SEPA pre-RED iter 3 finding.
 *
 * **fixes-cycle-1 T1.1 / F-rev-1 absorption (2026-06-03):** `skillRepoId`
 * removed from `SCOPE_KEYS` + `ScopeFields` + `resolveScope` + `MemoryLike`.
 * Skill scope is exposed ONLY via the SDK `Memory.skills(repoId)` per
 * CLAUDE.md ADR-0010; the prior `skillRepoId` REST surface routed to
 * `ScopedSkillMemory` which has `add`/`recall`/`consolidate`/`forget`,
 * NOT `remember`/`reflect`/`getAll` — the handlers crashed at runtime
 * with TypeError. Production blast radius eliminated.
 *
 * @see Plan theo-memory-standalone-p0 § ADR D12
 * @see Plan theo-memory-standalone-p0-fixes-cycle-1 § ADR D1 + EC-2
 */
import { z } from 'zod';

const SCOPE_KEYS = ['userId', 'sessionId', 'agentId'] as const;

const SingleScopeRefine = (
  data: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void => {
  const present = SCOPE_KEYS.filter((k) => data[k] !== undefined && data[k] !== null);
  if (present.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        present.length === 0
          ? 'INVALID_SCOPE: exactly one scope tier required (userId, sessionId, or agentId)'
          : `INVALID_SCOPE: exactly one scope tier required; received ${present.length} (${present.join(', ')})`,
      path: ['scope'],
    });
  }
};

const ScopeFields = {
  userId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
};

export const RememberBody = z
  .object({
    ...ScopeFields,
    text: z.string().min(1),
    infer: z.boolean().optional(),
    attributedTo: z.string().optional(),
    metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    /**
     * themory-category-filter-server-side T4.2 / ADR D3 — operator-supplied
     * category tag (1-64 chars). REST mirror of the SDK RememberOptions.category.
     * Empty string rejected at the boundary; > 64 chars rejected.
     */
    category: z.string().min(1).max(64).optional(),
  })
  .strict()
  .superRefine(SingleScopeRefine);

export const RecallBody = z
  .object({
    ...ScopeFields,
    query: z.string().min(1),
    topK: z.number().int().min(1).max(100).optional(),
    threshold: z.number().min(0).max(1).optional(),
    attributedTo: z.string().optional(),
    asOf: z.string().datetime().optional(),
  })
  .strict()
  .superRefine(SingleScopeRefine);

export const ReflectBody = z
  .object({
    ...ScopeFields,
    maxIterations: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .superRefine(SingleScopeRefine);

export const ForgetBody = z
  .object({
    memoryId: z.string().uuid(),
    hard: z.boolean().optional(),
  })
  .strict();

export type RememberBody = z.infer<typeof RememberBody>;
export type RecallBody = z.infer<typeof RecallBody>;
export type ReflectBody = z.infer<typeof ReflectBody>;
export type ForgetBody = z.infer<typeof ForgetBody>;

/**
 * Dispatch a parsed body to the correct `ScopedMemory` instance based on
 * which scope tier is present. Per ADR D12, exactly one tier is guaranteed
 * present at this point — the superRefine above has already filtered.
 */
export interface ScopedMemoryLike {
  remember: (text: string, options?: object) => Promise<unknown>;
  recall: (query: string, options?: object) => Promise<unknown>;
  reflect: (options?: object) => Promise<unknown>;
}

export interface MemoryLike {
  user: (userId: string) => ScopedMemoryLike;
  session: (sessionId: string) => ScopedMemoryLike;
  agent: (agentId: string) => ScopedMemoryLike;
}

export function resolveScope<T extends Record<string, unknown>>(
  memory: MemoryLike,
  body: T,
): ScopedMemoryLike {
  if (typeof body['userId'] === 'string') return memory.user(body['userId']);
  if (typeof body['sessionId'] === 'string') return memory.session(body['sessionId']);
  if (typeof body['agentId'] === 'string') return memory.agent(body['agentId']);
  throw new Error('resolveScope: no scope tier present; should be filtered by superRefine');
}
