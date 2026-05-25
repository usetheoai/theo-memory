/**
 * CLI entry point for `npx @usetheo/memory/agent-tools` invocation.
 *
 * Stub at T0.2 — real implementation lands at T6.1 (stdio transport) + T6.2
 * (streamable-HTTP transport). For now, exists so the `bin: { themory-mcp:
 * ./dist/agent-tools/cli.js }` entry resolves post-build (EC-1 absorption gate).
 *
 * @see ADR D1 — Transport: stdio + streamable-HTTP
 * @see ADR D8 — Package surface (bin entry)
 * @see EC-1 (plan v1.1) — build pipeline verified upfront
 */

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  // T0.2 stub: prints invocation banner and exits cleanly.
  // Real env-var validation (THEOMEM_PG_URI hard-fail per EC-7) + transport
  // selection (THEOMEM_MCP_TRANSPORT per ADR D1) + signal handlers (SIGINT+SIGTERM
  // per EC-7) land at T6.1.
  void argv;
  process.stdout.write('@usetheo/memory/agent-tools: stub CLI (T0.2). Real impl lands at T6.1.\n');
  return Promise.resolve();
}

// Invoke when executed directly as the bin entry (`node dist/agent-tools/cli.js`).
// Skip when imported as a module (e.g., from unit tests).
const isDirectInvocation =
  typeof process !== 'undefined' &&
  typeof process.argv[1] === 'string' &&
  /agent-tools[\/\\]cli\.(?:js|ts)$/.test(process.argv[1]);

if (isDirectInvocation) {
  main().catch((err: unknown) => {
    process.stderr.write(`agent-tools CLI failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
