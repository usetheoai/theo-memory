# SEPA — Iteration 10 / Task T2.2 / Phase Pre-RED

## Plan recap
T2.2 fleshes out `themory mcp` with `--transport` / `--port` / `--host` options. Preserves env-var path + EC-7 hard-fail + v0.3 backward-compat (`themory-mcp` alias).

## Findings
- **INFO Q1**: subcommand-level `.command('mcp').option(...)` is canonical commander.
- **INFO Q2**: precedence CLI > env > default. Resolve ONCE in runMcpServer via `options.transport ?? process.env.THEOMEM_MCP_TRANSPORT ?? 'stdio'`. Do NOT mutate process.env. Use `commander.Option(...).choices(['stdio','streamable-http'])` for built-in validation.
- **MAJOR Q3**: Extend `runMcpServer(options?: { transport?, port?, host? })`. Drop argv param (was unused). port MUST be number — pass `Number.parseInt` as commander parser. Guard `Number.isInteger(port) && port > 0 && port < 65536` else throw `InvalidPort` (boundary validation per architecture.md § 8).
- **MAJOR Q4**: Unit tests with mocked transports — cheap, fast, deterministic. Test through CLI commander → runMcpServer plumbing; mock transports (boundary I/O). execa/spawn approach belongs in later GOAL TEST integration.
- **INFO** Backward compat: verify v0.3 e2e round-trip still PASS post-signature-change (defaults apply when no options passed).
- **INFO** no-paper-names check: test descriptors stay behavior-shape.

## Recommended sequence
1. Add commander options on `.command('mcp')`: `--transport` (choices enum), `--port` (parseInt + bounds), `--host` (string).
2. Extend `runMcpServer({ transport?, port?, host? })`; resolve precedence ONCE at entry.
3. RED tests: extend `cli.test.ts` with vi.mock on `@modelcontextprotocol/sdk` transports. Given-When-Then.
4. Post-GREEN: run e2e round-trip + typecheck (transitive expansion gotcha).
5. EC-30 Windows stdio: JSDoc `@see` only; no code change.

No CRITICAL. Proceed to RED.
