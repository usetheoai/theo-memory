# SEPA — Iteration 9 / Task T2.1 / Phase Pre-RED

## Plan recap
T2.1 = SCAFFOLD `cli.ts` as commander router + EC-27/28/29 absorption; 6 RED tests; cli.ts ≤ 200 LoC; v0.3 round-trip MUST still PASS.

## Findings

- **[CRITICAL] Q1 wiring strategy**: T2.1 MUST wire `themory mcp` to existing main() body (NOT stub) because Acceptance #2 demands v0.3 round-trip PASS. Stub `server`/`migrate`/`health` with `stderr "not yet implemented in T2.X" + exit 1`. T2.2 then becomes thin (add `--transport`/`--port` options + 2 RED tests).
- **[MAJOR] Q2 alias-detection sequence**: warning FIRST (stderr deprecation), splice SECOND (`process.argv.splice(2, 0, 'mcp')`), parse THIRD. Splice MUST be idempotent-guarded — if `process.argv[2] === 'mcp'` already, skip splice.
- **[MAJOR] Q3 test mechanism**: in-process for #1/#2/#3/#6, execa child process for #4/#5 (deprecation warning + v0.3 regression). Gate child-process tests with `describe.skipIf(!existsSync('dist/agent-tools/cli.js'))` to avoid CI false-fails.
- **[INFO] Q4 dual-bin**: both `themory` and `themory-mcp` → `./dist/agent-tools/cli.js`. EC-28 RED #6 asserts via `require('./package.json').bin` shape.
- **[INFO] Q5 size budget — EXTRACT**: move cli.ts:28-79 (main() body) → `src/agent-tools/run-mcp-server.ts` exporting `runMcpServer()`. cli.ts ends at ~120-150 LoC scaffold. Honors SRP (cli=routing, run-mcp-server=MCP composition root). ADR D8 composition root invariant preserved.
- **[INFO]** No paper-names violations in suggested test descriptors.

## Recommended sequence

1. Extract `src/agent-tools/cli.ts` lines 28-79 → `src/agent-tools/run-mcp-server.ts` (export `runMcpServer`).
2. Rewrite `cli.ts`: alias detect (warn → splice idempotent) → `new Command()` → `.command('mcp').action(runMcpServer)` + 3 stubs → `parseAsync(process.argv)`.
3. `package.json#bin`: dual entry.
4. 6 RED tests: unit at `src/agent-tools/__tests__/cli.test.ts` (#1/#2/#3/#6 in-process); integration at `tests/integration/cli-consolidated.test.ts` (#4/#5 execa-gated).
5. cli.ts ≤ 200 LoC; v0.3 e2e round-trip PASS.

No CRITICAL halt. Proceed to RED.
