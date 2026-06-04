/**
 * T3.3 helper — MCP stdio JSON-RPC client.
 *
 * EC-9 absorption (SHOULD TEST): uses `readline.createInterface({ input:
 * child.stdout })` for line-delimited parsing. Raw `child.stdout.on('data',
 * buf => ...)` concatenation could split JSON-RPC messages across buffer
 * boundaries.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T3.3 + EC-9
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: { code: number; message: string };
}

interface SpawnMcpResult {
  readonly tools: ReadonlyArray<{ name: string }>;
}

/**
 * Spawn `node {cliPath} mcp`, perform the MCP initialize handshake, send
 * `tools/list`, and return the parsed tool list. Kills the child after
 * receiving the response (no graceful shutdown — the test is a smoke gate).
 */
export async function spawnMcpAndListTools(
  cliPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<SpawnMcpResult> {
  const child = spawn(process.execPath, [cliPath, 'mcp'], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    const rl = createInterface({ input: child.stdout! });
    const responses = new Map<number, JsonRpcResponse>();
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      try {
        const parsed = JSON.parse(trimmed) as JsonRpcResponse;
        if (typeof parsed.id === 'number') responses.set(parsed.id, parsed);
      } catch {
        // stdout may carry diagnostic stderr-spillover; ignore non-JSON.
      }
    });

    function send(payload: unknown): void {
      child.stdin!.write(JSON.stringify(payload) + '\n');
    }

    async function awaitResponse(id: number, label: string): Promise<JsonRpcResponse> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const r = responses.get(id);
        if (r !== undefined) return r;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`MCP ${label} timed out after ${String(timeoutMs)}ms`);
    }

    // Initialize handshake
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'p0-audit-mcp-cli-boot', version: '0.1.0' },
      },
    });
    await awaitResponse(1, 'initialize');

    // Initialized notification (no response expected)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    // tools/list
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const toolsResp = await awaitResponse(2, 'tools/list');

    if (toolsResp.error !== undefined) {
      throw new Error(`MCP tools/list error: ${toolsResp.error.message}`);
    }
    const result = toolsResp.result as { tools?: ReadonlyArray<{ name: string }> } | undefined;
    if (result === undefined || result.tools === undefined) {
      throw new Error('MCP tools/list response missing result.tools field');
    }
    return { tools: result.tools };
  } finally {
    if (!child.killed) child.kill('SIGKILL');
  }
}
