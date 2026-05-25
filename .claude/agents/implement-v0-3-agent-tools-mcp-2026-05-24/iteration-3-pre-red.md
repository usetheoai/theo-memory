# SEPA — Iteration 3 / Task T1.1 / Phase 1 (pre-RED consultation 1/3)

## Plan recap
T1.1 creates `McpServer` wrapper class around SDK's low-level `Server` (constructor: `name`/`version` from `McpServerOptions` with defaults `'themory'` / `'0.3.0'`), declaring `capabilities.tools.listChanged: false` per ADR D2. Replaces throw-stub `createMcpServer` factory with real instance returner. No tools registered (T2.1+), no transport wired (T6.1+).

## Findings (concise)

- **INFO** SDK shape: use **low-level** `Server` from `@modelcontextprotocol/sdk/server/index.js`. High-level `McpServer` exists in v1.29.0 at `dist/esm/server/mcp.d.ts` BUT our wrapper class shadows it — import SDK class `as SdkServer` to avoid collision.
- **INFO** Lifecycle: `connect(transport): Promise<void>` + `close(): Promise<void>` inherited from `Protocol` (verified at `dist/esm/shared/protocol.d.ts:Protocol class`). Plan's spec is sound.
- **INFO** Test introspection — **Option A (Direct expose)** recommended: wrapper adds `readonly capabilities` field returning the literal passed to SDK. Tests assert `server.capabilities.tools?.listChanged === false` via public getter. Aligns with testing.md § "What to test — public API". Rejects Option B (bracket-access SDK private) per anti-pattern.
- **INFO** Defaults: `name='themory'`, `version='0.3.0'` (literal — `process.env.npm_package_version` ?? fallback would be over-engineering for v0.3).
- **INFO** Test naming: BDD/behavioral form (`it('declares tools.listChanged: false ...')`) per testing.md § anti-patterns.
- **INFO** DIP boundary: `src/agent-tools/server.ts` MUST NOT import `src/local|cloud|core/`. T1.1 has no domain dep yet (memoryFactory wires at Phase 5).
- **INFO** D8 isolation: McpServer + createMcpServer exported ONLY from `src/agent-tools/index.ts`. Main `src/index.ts` MUST NOT re-export — tripwire test from T0.2 enforces.
- **INFO** createMcpServer factory: replace throw-stub with `export function createMcpServer(options?: McpServerOptions): McpServer { return new McpServer(options ?? {}); }`. Add `export { McpServer } from './server.js'`. Drop T0.2 `@throws` block.
- **INFO** ADR refs in JSDoc + commit: D2 (capability), D4 (SDK integration), D8 (isolation).

## Recommended action

1. Read `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.d.ts` for exact `connect()` + `close()` signatures.
2. Adopt Option A (public readonly getters for clean RED introspection).
3. Write 3 RED tests in `src/agent-tools/__tests__/server.test.ts` with BDD names.
4. GREEN: implement `McpServer` class with frozen `STATIC_CAPABILITIES`, defaults via constants, async lifecycle methods.
5. Update `src/agent-tools/index.ts`: remove throw stub, add real factory + `export { McpServer }`.
6. REFACTOR: confirm DRY (no magic strings outside defaults), DIP clean, BDD test names.
