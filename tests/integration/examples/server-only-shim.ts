/**
 * Noop shim for the `server-only` Next.js module — referenced via
 * `vitest.integration.config.ts` resolve alias. Integration tests run
 * outside Next.js + need to import `examples/chat-with-memory/lib/memory.ts`
 * which uses `import "server-only"` as a build-time client-side guard. In
 * the test environment that guard is meaningless; this shim makes the
 * import resolve to nothing.
 *
 * @see vitest.integration.config.ts resolve.alias
 */
export {};
