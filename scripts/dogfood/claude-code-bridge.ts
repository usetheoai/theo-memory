/**
 * Claude Code dogfood bridge — wires Claude Code's auto-memory writes
 * through TheMemory's MCP surface per ADR D1 hybrid strategy.
 *
 * T1.1 of dogfood-anchor-scenario-launch plan v1.1. Each function spawns
 * `themory mcp` per-invocation (ADR D1 v1.1 EC-2 lifecycle) and routes
 * the operation through the existing `@usetheo/memory/agent-tools` MCP
 * surface. NO new DIP per Inquebrável Rule 11 (YAGNI).
 *
 * Two consumers:
 *    on Write/Edit of memory files
 *    explicit Claude Code commands
 *
 * Both pass `projectSlug` EXPLICITLY (EC-3 absorption per ADR D2 v1.1).
 *
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Typed transport-failure error. Distinct from successful empty response
 * per EC-1 absorption. Bridge consumers MUST catch and surface to user
 * (skill renders message; hook exits non-zero).
 */
export class MCPUnreachable extends Error {
  override readonly name = 'MCPUnreachable';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Typed invalid-input error for missing required `projectSlug` argument
 * per EC-3 absorption. Implicit `process.cwd()` fallback is FORBIDDEN.
 */
export class InvalidProjectSlug extends Error {
  override readonly name = 'InvalidProjectSlug';
  constructor(message: string) {
    super(message);
  }
}

export interface BridgeContext {
  readonly projectSlug: string;
}

export interface BridgeResultBase {
  readonly skipped?: true;
  readonly reason?: string;
}

const BRIDGE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(BRIDGE_DIR, '..', '..');
const DEFAULT_THEMORY_CLI = resolve(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');
const DEGRADATIONS_DIR = resolve(REPO_ROOT, '.claude', 'knowledge-base', 'dogfood', 'degradations');

/**
 * Sanitize a Claude Code project slug per ADR D2: strip leading hyphens,
 * collapse non-alphanumeric (except `_` and `-`) to `_`. Used to derive
 * the TheMemory `userId` as `claude-code-${sanitized}`.
 */
export function sanitizeProjectSlug(raw: string): string {
  return raw.replace(/^-+/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function requireProjectSlug(ctx: BridgeContext | undefined): string {
  if (ctx === undefined || ctx.projectSlug === undefined || ctx.projectSlug === '') {
    throw new InvalidProjectSlug(
      'bridge: projectSlug is REQUIRED per ADR D2 v1.1 EC-3; no implicit process.cwd() fallback',
    );
  }
  return sanitizeProjectSlug(ctx.projectSlug);
}

function isEmptyContent(text: string): boolean {
  return text.trim().length === 0;
}

function degradationPath(event: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const hhmmss = now.toISOString().slice(11, 19).replace(/:/g, '');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  const pid = process.pid;
  return join(DEGRADATIONS_DIR, `${date}-${hhmmss}-${ms}-pid${pid}-${event}.md`);
}

function logDegradation(event: string, body: string): string {
  mkdirSync(DEGRADATIONS_DIR, { recursive: true });
  const path = degradationPath(event);
  const header = `---\ndate: ${new Date().toISOString()}\nscenario: claude-code-auto-memory\nevent: ${event}\n---\n\n`;
  writeFileSync(path, header + body, 'utf8');
  return path;
}

/**
 * MCP `_meta` key for per-call user-scope override. Reverse-DNS namespaced per
 * MCP spec convention. Mirrors `META_USER_ID_KEY` in `src/agent-tools/server.ts`.
 * Server reads `request.params._meta[this key]` and wraps dispatch in withScope.
 */
const META_USER_ID_KEY = 'io.usetheo.themory/user_id';

async function callMcpTool<T>(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<T> {
  const cliPath = process.env['THEMORY_BRIDGE_CLI'] ?? DEFAULT_THEMORY_CLI;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, 'mcp'],
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: 'claude-code-bridge', version: '0.1.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: toolName,
      arguments: args,
      _meta: { [META_USER_ID_KEY]: userId },
    });
    return result as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const path = logDegradation(`mcp_unreachable_${toolName}`, `tool=${toolName}\nerror=${message}\nargs=${JSON.stringify(args)}\n`);
    throw new MCPUnreachable(`bridge: MCP call ${toolName} failed; degradation logged at ${path}`, { cause: err });
  } finally {
    try {
      await client.close();
    } catch {
      // best-effort cleanup; do not mask the original error
    }
  }
}

export interface BridgeRememberResult extends BridgeResultBase {
  readonly memoryId?: string;
  readonly raw?: unknown;
}

export async function bridgeRemember(text: string, ctx: BridgeContext): Promise<BridgeRememberResult> {
  const userId = requireProjectSlug(ctx);
  if (isEmptyContent(text)) {
    return { skipped: true, reason: 'empty_content' };
  }
  // MCP schema field: `content` (NOT `text`); scope flows via `_meta` per Option C.
  const raw = await callMcpTool<unknown>('remember', { content: text }, `claude-code-${userId}`);
  return { raw };
}

export interface BridgeRecallResult extends BridgeResultBase {
  readonly results?: readonly unknown[];
  readonly raw?: unknown;
}

export async function bridgeRecall(query: string, ctx: BridgeContext): Promise<BridgeRecallResult> {
  const userId = requireProjectSlug(ctx);
  if (isEmptyContent(query)) {
    return { skipped: true, reason: 'empty_content' };
  }
  const raw = await callMcpTool<unknown>('recall', { query }, `claude-code-${userId}`);
  return { raw };
}

export async function bridgeForget(memoryId: string, ctx: BridgeContext): Promise<{ raw: unknown }> {
  const userId = requireProjectSlug(ctx);
  if (isEmptyContent(memoryId)) {
    throw new Error('bridge: memoryId is required for forget()');
  }
  // MCP forget schema uses `id` field for memory id selection.
  const raw = await callMcpTool<unknown>('forget', { id: memoryId }, `claude-code-${userId}`);
  return { raw };
}

export async function bridgeReflect(ctx: BridgeContext): Promise<{ raw: unknown }> {
  const userId = requireProjectSlug(ctx);
  // MCP reflect schema is strict empty `{}`; scope flows via `_meta`.
  const raw = await callMcpTool<unknown>('reflect', {}, `claude-code-${userId}`);
  return { raw };
}
