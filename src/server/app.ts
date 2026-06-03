/**
 * Hono app composer: mounts the 4 verbs under `/v1`, applies optional
 * bearer middleware, and ships a catch-all `app.onError` that returns the
 * sanitized 500 envelope (EC-10). Domain-error mapping (InvalidScope,
 * MemoryNotFound, etc.) lands in T1.6 — this task keeps the catch-all tight.
 *
 * @see Plan theo-memory-standalone-p0 § T1.2 + ADR D11 (DI factory shape)
 */
import { Hono } from 'hono';

import type { AuthVerifier } from '../core/dip/auth-verifier.js';
import type { Memory } from '../core/memory-store.js';

import { bearerAuth } from './auth/middleware.js';
import { forgetHandler } from './handlers/forget.js';
import { recallHandler } from './handlers/recall.js';
import { reflectHandler } from './handlers/reflect.js';
import { rememberHandler } from './handlers/remember.js';

export interface CreateServerOptions {
  readonly memory: Memory;
  readonly authVerifier?: AuthVerifier;
}

export function createApp(options: CreateServerOptions): Hono {
  const { memory, authVerifier } = options;
  const app = new Hono();

  app.use('/v1/*', bearerAuth(authVerifier));

  app.post('/v1/remember', (c) => rememberHandler(c, memory));
  app.post('/v1/recall', (c) => recallHandler(c, memory));
  app.post('/v1/forget', (c) => forgetHandler(c, memory));
  app.post('/v1/reflect', (c) => reflectHandler(c, memory));

  app.onError((_err, c) => {
    // EC-10 absorption — sanitized 500 envelope; never leak raw error.message
    // or stack. T1.6 will EXPAND this to map domain errors (InvalidScope,
    // MemoryNotFound, etc.) BEFORE this catch-all.
    return c.json({ code: 'INTERNAL_ERROR', message: 'Internal server error' }, 500);
  });

  return app;
}
