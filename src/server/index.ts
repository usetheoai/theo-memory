/**
 * Public factory for `@usetheo/memory/server`.
 *
 * Per ADR D11: `createServer({ memory, authVerifier? })` consumes the
 * `Memory` interface via DI. Caller wires `createMemory({ ... })` →
 * `createServer({ memory })`. No `createServerWithMemory` shortcut.
 *
 * @see Plan theo-memory-standalone-p0 § ADR D11
 */
export { createApp as createServer } from './app.js';
export type { CreateServerOptions } from './app.js';

export { BearerAuthVerifier, readApiKey } from './auth/bearer-verifier.js';
export { bearerAuth } from './auth/middleware.js';
