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
import { MemoryEvidenceSchema } from '@usetheo/memory/contract';
import { z } from 'zod';

import { MessageSearchQuerySchema } from './handlers/messages-search.js';
import { registerMemoryJobPaths } from './openapi-memory-jobs.js';
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
  evidence: MemoryEvidenceSchema.optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  distinctSourceCount: z.number().int().nonnegative().nullable().optional(),
  idempotentReplay: z.boolean().optional(),
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
  registerMemoryJobPaths(registry);
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
        content: {
          'application/json': {
            schema: z.object({
              results: z.array(MemoryItemWithScoreSchema),
              // explainable-recall S2 (D2) — server-minted id for GET /v1/recall-traces/:recallId
              recallId: z
                .string()
                .describe(
                  'Server-minted correlation id. Its dropped-candidate trace is readable at ' +
                    'GET /v1/recall-traces/{recallId} ONLY when the deployment enabled recall ' +
                    'tracing (THEOMEM_RECALL_TRACE); otherwise the lookup returns 404.',
                ),
            }),
          },
        },
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
    summary: 'Liveness — the process is up.',
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
    summary: 'The database check that backs readiness — reachable within 2s.',
    responses: {
      200: { description: 'DB OK.', content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } } },
      503: {
        description: 'DB unreachable, timed out, or no probe configured.',
        content: { 'application/json': { schema: z.object({ status: z.literal('unavailable'), reason: z.string().optional() }) } },
      },
    },
  });

  // B-118 — the canonical readiness and provenance names. Both were SERVED and absent from this
  // document, and the ecosystem contract checker only reads the document: a route it cannot see is
  // a route it never checks.
  //
  // The two summaries above were also swapped — `/v1/health` was labelled "readiness" and
  // `/v1/health/db` "liveness", which is the inverse of what each answers.
  registry.registerPath({
    method: 'get',
    path: '/v1/health/ready',
    operationId: 'getHealthReady',
    summary: 'Readiness — the service can serve, database included.',
    responses: {
      200: { description: 'Ready.', content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } } },
      503: {
        description: 'A dependency is unavailable; do not send traffic here.',
        content: { 'application/json': { schema: z.object({ status: z.literal('unavailable'), reason: z.string().optional() }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/version',
    operationId: 'getVersion',
    summary: 'Which build is answering.',
    responses: {
      200: {
        description: 'Build provenance.',
        content: {
          'application/json': {
            schema: z.object({
              name: z.string(),
              version: z.string(),
              git_sha: z.string().optional(),
              built_at: z.string().optional(),
            }),
          },
        },
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

  // first-class-episodes M2 T3.1 — subject-scoped episodic/message-log read.
  registry.registerPath({
    method: 'get',
    path: '/v1/scopes/{type}/{id}/episodes',
    operationId: 'scopeEpisodes',
    summary:
      'Subject-scoped episodic / message-log read: cursor-paginated, bi-temporal-aware temporal list of memories (NOT semantic).',
    request: {
      params: z.object({ type: ScopeTypeEnum, id: z.string().min(1) }),
      query: z.object({
        after: z.string().min(1).optional(),
        before: z.string().min(1).optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
        order: z.enum(['asc', 'desc']).optional(),
        asOf: z.string().min(1).optional(),
        q: z.string().min(1).optional(),
      }),
    },
    responses: {
      200: {
        description: 'A page of episode items, newest-first by default, with an optional forward cursor.',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(
                z.object({
                  id: z.string(),
                  text: z.string(),
                  scope_type: ScopeTypeEnum,
                  created_at: z.string(),
                  metadata: z.record(z.unknown()),
                }),
              ),
              nextCursor: z.string().optional(),
            }),
          },
        },
      },
      404: { description: 'Unknown scope type or empty id.' },
      422: { description: 'Invalid query (bad limit / cursor / asOf, or both after+before).' },
    },
  });

  // ADR-0031 — BM25 search over the raw message log, separate from recall.
  registry.registerPath({
    method: 'get',
    path: '/v1/scopes/{type}/{id}/messages/search',
    operationId: 'searchScopeMessages',
    summary:
      'Lexical (BM25) search over the raw messages the scope can see, best first. Reaches a turn extraction kept no fact of; matches words, not meaning.',
    request: {
      params: z.object({ type: ScopeTypeEnum, id: z.string().min(1) }),
      query: MessageSearchQuerySchema,
    },
    responses: {
      200: {
        description: 'Matching messages, best score first. A foreign or empty scope returns no items.',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(
                z.object({
                  id: z.string(),
                  role: z.enum(['system', 'user', 'assistant']),
                  content: z.string(),
                  score: z.number(),
                  observed_at: z.string().nullable(),
                  logged_at: z.string(),
                }),
              ),
            }),
          },
        },
      },
      404: { description: 'Unknown scope type or empty id.' },
      422: { description: 'Invalid query (missing q, limit outside 1..100, unknown parameter, or invalid asOf).' },
      501: { description: 'The server runs without the raw message log (MESSAGE_LOG_DISABLED).' },
    },
  });

  // themory-scoped-forget T1.2 — subject-scoped DELETE (404-not-403; no leak).
  registry.registerPath({
    method: 'delete',
    path: '/v1/scopes/{type}/{id}/memories/{memId}',
    operationId: 'scopedForget',
    summary: 'Delete a memory by id within the named subject scope (soft; ?hard=true for GDPR erasure).',
    request: {
      params: z.object({ type: ScopeTypeEnum, id: z.string().min(1), memId: z.string().uuid() }),
      query: z.object({ hard: z.enum(['true', 'false']).optional() }),
    },
    responses: {
      204: { description: 'Deleted (or already absent in scope).' },
      404: { description: 'Not found in this scope / workspace (no existence leak).' },
      422: { description: 'memId is not a UUID.' },
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

  // entity-relation-extraction-slice2 T3.1 — {nodes, edges} relation graph.
  registry.registerPath({
    method: 'get',
    path: '/v1/scopes/{type}/{id}/graph',
    operationId: 'scopeGraph',
    summary: 'Subject-scoped entity relation graph ({nodes, edges}; no graph DB).',
    request: { params: z.object({ type: ScopeTypeEnum, id: z.string().min(1) }) },
    responses: {
      200: {
        description: 'Entity graph: nodes (entities) + edges (relations).',
        content: {
          'application/json': {
            schema: z.object({
              nodes: z.array(
                z.object({
                  id: z.string(),
                  scope_type: z.string(),
                  memory_count: z.number().int(),
                  last_seen_at: z.string().optional(),
                }),
              ),
              edges: z.array(
                z.object({
                  source: z.string(),
                  relation: z.string(),
                  target: z.string(),
                  memory_count: z.number().int(),
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
    summary: 'Read-only listing of a repo\'s skills (Repo tier skill library).',
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

  // skills-cross-repo-flat-list (ADR D2) — tenant-safe cross-repo skills listing.
  registry.registerPath({
    method: 'get',
    path: '/v1/scopes/skill/{subject}/all',
    operationId: 'scopeSkillsAll',
    summary: 'Flat cross-repo listing of ALL skills for a subject (each carrying its repoId).',
    request: {
      params: z.object({ subject: z.string().min(1) }),
      query: z.object({
        includeSuperseded: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        q: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Skills across every repo for the subject. `total` is the full match count; `truncated` is true when more rows exist beyond this page.',
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
                  repoId: z.string(),
                }),
              ),
              total: z.number().int(),
              truncated: z.boolean(),
            }),
          },
        },
      },
      400: { description: 'Empty subject or subject containing ":".' },
      422: { description: 'Invalid query (limit/offset out of range).' },
    },
  });

  // skills-write-surface T2.1 — create a skill.
  registry.registerPath({
    method: 'post',
    path: '/v1/scopes/skill/{repoId}/skills',
    operationId: 'createSkill',
    summary: 'Create a skill under a repo (store-only; code is never executed).',
    request: {
      params: z.object({ repoId: z.string().min(1) }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              code: z.string().min(1),
              description: z.string().min(1),
              codeLanguage: z.enum(['typescript', 'javascript']),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Created.',
        content: { 'application/json': { schema: z.object({ id: z.string(), hash: z.string() }) } },
      },
      400: { description: 'Empty repoId or malformed JSON.' },
      409: { description: 'A skill with this description already exists (dedup-collision).' },
      413: { description: 'code payload too large.' },
      422: { description: 'Invalid body (empty fields / invalid codeLanguage).' },
    },
  });

  // skills-write-surface T2.2 — forget (curate) a skill.
  registry.registerPath({
    method: 'delete',
    path: '/v1/scopes/skill/{repoId}/skills/{skillId}',
    operationId: 'forgetSkill',
    summary: 'Forget (delete) a skill — scope-isolated curation.',
    request: {
      params: z.object({ repoId: z.string().min(1), skillId: z.string().min(1) }),
    },
    responses: {
      204: { description: 'Deleted.' },
      400: { description: 'Empty repoId or skillId.' },
      404: { description: 'Not a skill in this repo scope.' },
    },
  });

  // agentic-skill-execution-sandbox T2.3 — opt-in/gated skill execution.
  registry.registerPath({
    method: 'post',
    path: '/v1/scopes/skill/{repoId}/skills/{skillId}/execute',
    operationId: 'executeSkill',
    summary: 'Execute a stored skill inside the hardened sandbox (opt-in; STORE-only by default).',
    request: {
      params: z.object({ repoId: z.string().min(1), skillId: z.string().min(1) }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              args: z.record(z.unknown()).optional(),
              opts: z
                .object({
                  timeoutMs: z.number().int().positive().max(30_000).optional(),
                  memoryLimitMb: z.number().int().positive().max(256).optional(),
                  maxOutputBytes: z.number().int().positive().max(10_000_000).optional(),
                })
                .optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: 'Captured skill result { output, truncated, elapsedMs }.' },
      400: { description: 'Empty repoId/skillId or malformed JSON.' },
      403: { description: 'A sandbox guard denied the execution (reason in body).' },
      404: { description: 'Not a current skill in this repo scope (no existence leak).' },
      422: { description: 'Invalid execute body.' },
      501: { description: 'No SkillExecutor wired — execution not configured.' },
      503: { description: 'Sandbox backend (isolated-vm) not installed.' },
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

  // explainable-recall-read S2 (T4.1) — the accountable-forgetting READ surface.
  registry.registerPath({
    method: 'get',
    path: '/v1/recall-traces/{recallId}',
    operationId: 'getRecallTrace',
    summary:
      'Read the candidates a recall DROPPED (workspace-scoped). recallId comes from the POST /v1/recall envelope. Populated only when the deployment enabled recall tracing.',
    request: { params: z.object({ recallId: z.string().min(1) }) },
    responses: {
      200: {
        description: 'The dropped candidates with their score breakdown + drop-reason.',
        content: {
          'application/json': {
            schema: z.object({
              recallId: z.string(),
              drops: z.array(
                z.object({
                  memoryId: z.string(),
                  semantic: z.number(),
                  bm25: z.number(),
                  entity: z.number(),
                  composite: z.number().nullable(),
                  threshold: z.number(),
                  dropReason: z.string(),
                }),
              ),
            }),
          },
        },
      },
      403: { description: 'Missing memory:read scope.', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      404: { description: 'Unknown recall_id, or one in another workspace (no cross-tenant leak).', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    },
  });
}
