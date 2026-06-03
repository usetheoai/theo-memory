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
  ForgetBody,
  RecallBody,
  ReflectBody,
  RememberBody,
} from './schemas.js';

const ScopeTypeEnum = z.enum(['user', 'session', 'agent', 'skill']);

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
}
