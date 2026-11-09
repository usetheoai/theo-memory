/**
 * Agent Memory Leaderboard Textual Add/Search adapter.
 *
 * This is a dedicated integration surface. It never trusts a request body to
 * select a workspace, and it does not expose answer generation.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import type { Memory } from '@usetheo/memory/contract';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  timestamp: z.number().int().nonnegative().optional(),
  content: z.string().min(1),
}).strict();

const AddSchema = z.object({
  request_id: z.string().min(1),
  // The official AML textual adapter chunks requests at 20 messages. Honor
  // that frozen contract instead of inventing a global content character cap.
  messages: z.array(MessageSchema).min(1).max(20),
  user_id: z.string().min(1),
  session_id: z.string().min(1),
}).strict();

const SearchSchema = z.object({
  query: z.string().min(1),
  options: z.array(z.string().min(1)).optional(),
  user_id: z.string().min(1),
  top_k: z.number().int().min(1).max(100),
}).strict();

export interface AmlAdapterOptions {
  readonly memory: Memory;
  /** Dedicated, fixed evaluation workspace. Never read from an AML request. */
  readonly workspaceId: string;
  /** Memory System Key; separate from the AML evaluation key. */
  readonly apiKey: string;
}

function authenticate(header: string | undefined, apiKeyHeader: string | undefined, expected: string): boolean {
  const authorizationMatch = header?.match(/^(?:Bearer|Token)\s+(.+)$/i);
  const candidate = authorizationMatch?.[1] ?? apiKeyHeader;
  if (candidate === undefined) return false;
  const actual = Buffer.from(candidate);
  const secret = Buffer.from(expected);
  return actual.length === secret.length && timingSafeEqual(actual, secret);
}

function validationError(issues: readonly { path: PropertyKey[]; message: string }[]): Response {
  return Response.json({
    detail: {
      reason: 'invalid_request',
      fields: issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
    },
  }, { status: 422 });
}

function sourceDate(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined) return undefined;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function createAmlAdapter(options: AmlAdapterOptions): Hono {
  if (options.apiKey.length < 32) throw new Error('AML Memory System Key must be at least 32 characters');
  if (options.workspaceId.trim() === '') throw new Error('AML workspaceId must be non-empty');
  if (options.memory.withWorkspace === undefined) {
    throw new Error('AML adapter requires a workspace-capable Memory implementation');
  }

  const memory = options.memory.withWorkspace(options.workspaceId);
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  const requireKey = async (c: Context, next: () => Promise<void>) => {
    if (!authenticate(c.req.header('authorization'), c.req.header('x-api-key'), options.apiKey)) {
      return c.json({ detail: { reason: 'unauthorized' } }, 401);
    }
    return await next();
  };
  app.use('/add', requireKey);
  app.use('/search', requireKey);

  app.post('/add', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ detail: { reason: 'invalid_json' } }, 400);
    }
    const parsed = AddSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error.issues);

    const request = parsed.data;
    const scoped = memory.user(request.user_id);
    try {
      // Ordered, synchronous writes preserve message chronology. A retry safely
      // replays completed messages because each write has a stable idempotency key.
      for (let index = 0; index < request.messages.length; index += 1) {
        const message = request.messages[index];
        if (message === undefined) continue;
        const timestampIso = sourceDate(message.timestamp);
        await scoped.remember(message.content, {
          infer: true,
          strictExtraction: true,
          attributedTo: message.role,
          idempotencyKey: createHash('sha256')
            .update(`${request.request_id}\0${String(index)}`)
            .digest('hex'),
          metadata: {
            aml_request_id: request.request_id,
            aml_session_id: request.session_id,
            aml_message_index: index,
            ...(message.timestamp === undefined ? {} : { source_timestamp_ms: message.timestamp }),
            ...(timestampIso === undefined ? {} : { source_date: timestampIso }),
          },
        });
      }
    } catch (error) {
      // Do not leak provider, storage, prompts, or message content. The same
      // request_id is safe to retry after a partial write. The server log gets the
      // error's name, SQLSTATE and constraint along its cause chain, never a message (#231).
      // eslint-disable-next-line no-console -- server-side record of a failure the response hides
      console.error(`[themory] aml add_failed request_id=${request.request_id} ${describeFailure(error)}`);
      return c.json({ detail: { reason: 'add_failed' } }, 503);
    }

    return c.json({
      success: true,
      request_id: request.request_id,
      user_id: request.user_id,
      session_id: request.session_id,
    });
  });

  app.post('/search', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ detail: { reason: 'invalid_json' } }, 400);
    }
    const parsed = SearchSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error.issues);

    const request = parsed.data;
    const query = request.options === undefined || request.options.length === 0
      ? request.query
      : `${request.query}\nOptions:\n${request.options.join('\n')}`;
    try {
      const results = await memory.user(request.user_id).recall(query, { topK: request.top_k });
      return c.json({
        data: results.slice(0, request.top_k).map((item) => ({
          id: item.id,
          content: item.text,
          score: item.score,
          created_at: item.createdAt.toISOString(),
        })),
      });
    } catch {
      return c.json({ detail: { reason: 'search_failed' } }, 503);
    }
  });

  return app;
}

/** Name, SQLSTATE and constraint of each error along the cause chain; messages can quote row values. */
function describeFailure(error: unknown): string {
  const parts: string[] = [];
  for (let current = error, depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    const { code, constraint, cause } = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    parts.push([
      current instanceof Error ? current.name : 'UnknownError',
      typeof code === 'string' ? `code=${code}` : '',
      typeof constraint === 'string' ? `constraint=${constraint}` : '',
    ].filter((part) => part !== '').join(' '));
    current = cause;
  }
  return parts.join(' <- ');
}
