/**
 * Manual OpenAPI path registration — keeps T1.2/T1.3 handlers untouched
 * (vanilla Hono routes preserve EC-6/7/9/14/15 envelope shapes) while
 * still feeding `OpenAPIHono.openAPIRegistry` for spec auto-derivation.
 *
 * Per SEPA pre-RED iter 5 CRITICAL — Path A full RouteConfig migration risks
 * defaultHook envelope drift across 6 handlers. Hybrid registration honors
 * the plan's "single source of truth (zod schemas) → no spec drift" rationale
 * (ADR D1 Consequences) without re-implementing the safeJson + scopeOrValidationError
 * pipeline that the T1.2/T1.3 RED tests pin.
 *
 * @see Plan theo-memory-standalone-p0 § T1.4 + ADR D1 + EC-19
 */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import {
  AddMemberBody,
  ForgetBody,
  RecallBody,
  ReflectBody,
  RememberBody,
  SetMemberRoleBody,
} from './schemas.js';

const MemberSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.enum(['owner', 'admin', 'member']),
  createdAt: z.string().datetime(),
});

const ScopeTypeEnum = z
  .enum(['user', 'session', 'agent', 'skill'])
  .describe(
    "Scope type for path params. Values 'user'|'session'|'agent' list memories under the corresponding tier. Value 'skill' returns 501 SKILL_LISTING_NOT_IMPLEMENTED — skill listing is SDK-only via Memory.skills(...) per ADR-0010.",
  );

const MemoryItemSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  hash: z.string(),
  scope: z.record(z.string(), z.unknown()),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const MemoryItemWithScoreSchema = MemoryItemSchema.extend({
  score: z.number(),
});

const ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
});

export function registerAllPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/v1/remember',
    operationId: 'remember',
    summary: 'Persist a memory under exactly one scope tier.',
    request: {
      body: { content: { 'application/json': { schema: RememberBody } } },
    },
    responses: {
      201: {
        description: 'Memory persisted.',
        content: { 'application/json': { schema: z.object({ items: z.array(MemoryItemSchema) }) } },
      },
      400: { description: 'Malformed JSON body.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      413: {
        description:
          'Request body exceeds 1 MB cap (T2.1 / F-rev-4 absorption; mapped from ContentTooLargeError via mapDomainErrorToResponse).',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      422: { description: 'Validation failure.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      500: { description: 'Internal error.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/recall',
    operationId: 'recall',
    summary: 'Semantic recall under exactly one scope tier.',
    request: { body: { content: { 'application/json': { schema: RecallBody } } } },
    responses: {
      200: {
        description: 'Ranked results.',
        content: { 'application/json': { schema: z.object({ results: z.array(MemoryItemWithScoreSchema) }) } },
      },
      400: { description: 'Malformed JSON body.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      413: {
        description:
          'Request body exceeds 1 MB cap (T2.1 / F-rev-4 absorption; mapped from ContentTooLargeError via mapDomainErrorToResponse).',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      422: { description: 'Validation failure.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/forget',
    operationId: 'forget',
    summary: 'Forget a memory by id (soft-delete by default; hard via { hard: true }).',
    request: { body: { content: { 'application/json': { schema: ForgetBody } } } },
    responses: {
      204: { description: 'Forgotten.' },
      400: { description: 'Malformed JSON body.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      413: {
        description:
          'Request body exceeds 1 MB cap (T2.1 / F-rev-4 absorption; mapped from ContentTooLargeError via mapDomainErrorToResponse).',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      422: { description: 'Validation failure.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/reflect',
    operationId: 'reflect',
    summary: 'Trigger reflection under exactly one scope tier (async/queued).',
    request: { body: { content: { 'application/json': { schema: ReflectBody } } } },
    responses: {
      202: {
        description: 'Reflection job queued.',
        content: { 'application/json': { schema: z.object({ jobId: z.string(), derivedCount: z.number().optional() }) } },
      },
      400: { description: 'Malformed JSON body.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      413: {
        description:
          'Request body exceeds 1 MB cap (T2.1 / F-rev-4 absorption; mapped from ContentTooLargeError via mapDomainErrorToResponse).',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      422: { description: 'Validation failure.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/health',
    operationId: 'getHealth',
    summary: 'Readiness probe — process alive.',
    responses: {
      200: {
        description: 'Ready.',
        content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/health/db',
    operationId: 'getHealthDb',
    summary: 'Liveness probe — DB reachable within 2s.',
    responses: {
      200: { description: 'DB OK.', content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } } },
      503: {
        description: 'DB unreachable, timed out, or no probe configured.',
        content: { 'application/json': { schema: z.object({ status: z.literal('unavailable'), reason: z.string().optional() }) } },
      },
    },
  });

  // theo-memory-dashboard-full-integration T2.1/T2.2 — subject-scoped KPIs +
  // entity aggregation (ADR D2 amendment).
  registry.registerPath({
    method: 'get',
    path: '/v1/scopes/{type}/{id}/metrics',
    operationId: 'scopeMetrics',
    summary: 'Subject-scoped memory KPIs (total, entity_count, add_events).',
    request: { params: z.object({ type: ScopeTypeEnum, id: z.string().min(1) }) },
    responses: {
      200: {
        description: 'Scope KPIs.',
        content: {
          'application/json': {
            schema: z.object({
              total_memories: z.number().int(),
              entity_count: z.number().int(),
              add_events: z.number().int(),
              retrieval_api_usage: z.number().int(),
            }),
          },
        },
      },
      404: { description: 'Unknown scope type or empty id.' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/scopes/{type}/{id}/entities',
    operationId: 'scopeEntities',
    summary: 'Subject-scoped entity aggregation (distinct attributed_to peers).',
    request: { params: z.object({ type: ScopeTypeEnum, id: z.string().min(1) }) },
    responses: {
      200: {
        description: 'Aggregated entities.',
        content: {
          'application/json': {
            schema: z.object({
              entities: z.array(
                z.object({
                  id: z.string(),
                  scope_type: z.string(),
                  memory_count: z.number().int(),
                  last_seen_at: z.string().optional(),
                }),
              ),
            }),
          },
        },
      },
      404: { description: 'Unknown scope type or empty id.' },
    },
  });

  // dashboard-phase2b-skills-browse T2.1 — read-only Repo-tier skills listing.
  registry.registerPath({
    method: 'get',
    path: '/v1/scopes/skill/{repoId}/skills',
    operationId: 'scopeSkills',
    summary: 'Read-only listing of a repo\'s skills (Repo tier / REDACTED skill library).',
    request: {
      params: z.object({ repoId: z.string().min(1) }),
      query: z.object({
        includeSuperseded: z.boolean().optional(),
        topK: z.number().int().min(1).max(100).optional(),
      }),
    },
    responses: {
      200: {
        description: 'The repo skills (head-of-chain by default). `truncated` is true when the topK cap was hit.',
        content: {
          'application/json': {
            schema: z.object({
              skills: z.array(
                z.object({
                  id: z.string(),
                  hash: z.string(),
                  description: z.string(),
                  code: z.string().nullable(),
                  codeLanguage: z.string().nullable(),
                  createdAt: z.string(),
                  derivedFrom: z.array(z.string()),
                  supersededBy: z.string().nullable(),
                }),
              ),
              truncated: z.boolean(),
            }),
          },
        },
      },
      400: { description: 'Empty repoId.' },
      422: { description: 'Invalid query (topK out of range).' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/scopes/{type}/{id}/memories',
    operationId: 'listScopeMemories',
    summary: 'Paginated listing of memories under a scope.',
    request: {
      params: z.object({ type: ScopeTypeEnum, id: z.string().min(1) }),
      query: z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        category: z.string().min(1).max(64).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Page of memories.',
        content: {
          'application/json': {
            schema: z.object({ items: z.array(MemoryItemSchema), nextCursor: z.string().optional() }),
          },
        },
      },
      400: { description: 'Invalid cursor.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      404: { description: 'Unknown scope type or empty id.' },
      422: { description: 'Invalid query parameters.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      501: {
        description:
          "Listing memories on 'skill' scope is not implemented at P0 (SDK-only via Memory.skills(...) per ADR-0010; closes F-rev-1 from theo-memory-standalone-p0 review).",
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
    },
  });

  // multi-tenant-rbac-and-slice1-completion (F-dom-api-1): the RBAC membership
  // surface. Workspace is derived from the authenticated Principal (never the
  // body); routes are gated by requireRole('admin').
  registry.registerPath({
    method: 'get',
    path: '/v1/members',
    operationId: 'listMembers',
    summary: "List the authenticated workspace's members (role: admin).",
    responses: {
      200: {
        description: 'Members of the caller workspace.',
        content: { 'application/json': { schema: z.object({ members: z.array(MemberSchema) }) } },
      },
      401: { description: 'Missing/invalid credential.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      403: { description: 'Caller role below admin.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      503: { description: 'Auth backend unavailable (fail-closed).', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/members',
    operationId: 'addMember',
    summary: 'Add a member by email (role: admin). Creates the global user if new.',
    request: { body: { content: { 'application/json': { schema: AddMemberBody } } } },
    responses: {
      201: { description: 'Member added.', content: { 'application/json': { schema: z.object({ member: MemberSchema }) } } },
      401: { description: 'Missing/invalid credential.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      403: { description: 'Caller role below admin.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      409: { description: 'User already a member.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      422: { description: 'Invalid body (e.g. forged workspaceId rejected).', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/members/{userId}',
    operationId: 'setMemberRole',
    summary: "Change a member's role (role: admin). Cannot demote the last owner.",
    request: {
      params: z.object({ userId: z.string().min(1) }),
      body: { content: { 'application/json': { schema: SetMemberRoleBody } } },
    },
    responses: {
      200: { description: 'Role updated.', content: { 'application/json': { schema: z.object({ member: MemberSchema }) } } },
      403: { description: 'Caller role below admin.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      404: { description: 'Member not found (or in another workspace — no existence leak).', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      409: { description: 'Would leave the workspace without an owner.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      422: { description: 'Invalid body.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/v1/members/{userId}',
    operationId: 'removeMember',
    summary: 'Remove a member (role: admin). Cannot remove the last owner.',
    request: { params: z.object({ userId: z.string().min(1) }) },
    responses: {
      204: { description: 'Member removed.' },
      403: { description: 'Caller role below admin.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      404: { description: 'Member not found (or in another workspace — no existence leak).', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      409: { description: 'Would leave the workspace without an owner.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    },
  });
}
