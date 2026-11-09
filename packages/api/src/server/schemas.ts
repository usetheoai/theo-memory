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
import { MemoryEvidenceSchema } from '@usetheo/memory/contract';
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
    evidence: MemoryEvidenceSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(256).optional(),
    expiresAt: z.string().datetime({offset:true}).optional(),
    /** When the text was said or written (ISO-8601), if not now. SDK RememberOptions.observedAt. */
    observedAt: z.string().datetime({offset:true}).optional(),
    strictExtraction: z.boolean().optional(),
    attributedTo: z.string().min(1).optional(),
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
    attributedTo: z.string().min(1).optional(),
    asOf: z.string().datetime().optional(),
    // ADR-0027 — return each result's raw source messages (`results[].sources`). Default off.
    includeSources: z.boolean().optional(),
    // rest-graph-aware-recall — expose RecallOptions.graphExpand (v0.19.0 SDK
    // capability) over REST. Bounded: hops literal 1|2 (mirror the SDK type),
    // limit <= 100 (DoS-guard parity with topK). `.strict()` rejects unknown
    // inner keys; optional keeps it default-OFF (byte-unchanged when omitted).
    graphExpand: z
      .object({
        hops: z.union([z.literal(1), z.literal(2)]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
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

/**
 * M6 claude-code-memory-integration T1.2 — batch remember body. One HTTP request
 * carrying an array of the SAME per-item shape as {@link RememberBody} (so each
 * item is fully validated + single-scope-refined; DRY). Bounded by
 * {@link MAX_BATCH_ITEMS} to cap request size (the 1 MB bodyLimit middleware +
 * DoS). A batch is ONE write-limiter slot (N facts, 1 request) — the migration
 * of thousands of pre-written facts becomes feasible against the 30-writes/60s limit.
 */
export const MAX_BATCH_ITEMS = 1000;

export const BatchRememberBody = z
  .object({
    items: z.array(RememberBody).min(1).max(MAX_BATCH_ITEMS),
  })
  .strict();

export type BatchRememberBody = z.infer<typeof BatchRememberBody>;
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
  session: (sessionId: string, userId?: string) => ScopedMemoryLike;
  agent: (agentId: string, userId?: string) => ScopedMemoryLike;
}

export function resolveScope<T extends Record<string, unknown>>(
  memory: MemoryLike,
  body: T,
  userId?: string,
): ScopedMemoryLike {
  // M8 review F-arch-1 (cross-user IDOR fix): the user tier binds to the AUTH-TRUSTED
  // Principal userId when present — a body-supplied userId can NEVER address another
  // user's global scope. `userId` is undefined only for a workspace-admin credential
  // (no acting user) OR an unauthenticated harness, where the body userId is the sole
  // signal. Mirrors the read-path bind in pathParamsToScoped (`userId ?? id`).
  if (typeof body['userId'] === 'string') return memory.user(userId ?? body['userId']);
  // M8 (ADR D6): a body-named session/agent write is bound to the acting user
  // (the Principal's userId) → scope (workspace, user, session). Omitted for a
  // workspace-admin credential (userId null) → workspace-scoped.
  if (typeof body['sessionId'] === 'string') return memory.session(body['sessionId'], userId);
  if (typeof body['agentId'] === 'string') return memory.agent(body['agentId'], userId);
  throw new Error('resolveScope: no scope tier present; should be filtered by superRefine');
}

// ============================================================================
// RBAC member-management bodies (multi-tenant-rbac-and-slice1-completion T2.1)
// ============================================================================

/** The three workspace roles, as a zod enum (mirrors the DB CHECK constraint). */
export const WorkspaceRoleSchema = z.enum(['owner', 'admin', 'member']);

/**
 * `POST /v1/members` body — add a member by email with a role. `.strict()` so
 * an unknown key (e.g. a forged `workspaceId`) is rejected with 400, never
 * silently dropped (workspace is derived from the Principal, never the body).
 */
export const AddMemberBody = z
  .object({
    email: z.string().email(),
    name: z.string().min(1).max(200).optional(),
    role: WorkspaceRoleSchema,
  })
  .strict();

/** `PATCH /v1/members/:userId` body — change a member's role. `.strict()`. */
export const SetMemberRoleBody = z
  .object({
    role: WorkspaceRoleSchema,
  })
  .strict();
