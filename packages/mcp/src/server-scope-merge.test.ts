/**
 * M7 regression — a tool call must NOT drop the auth-trusted workspace.
 *
 * `withScope` REPLACES the AsyncLocalStorage context rather than merging into it.
 * The tools/call handler wrapped every dispatch in `withScope({ session: { userId } })`,
 * which discarded the `workspaceId` the transport had resolved from the Principal.
 *
 * That branch only runs when a userId is resolvable — and the deployed MCP service
 * sets `THEOMEM_MCP_DEFAULT_USER_ID`, so it ALWAYS ran. Every tenant's tool calls
 * executed against unbound memory keyed by one shared userId, collapsing them onto
 * the same rows. Violates theo-data/CLAUDE.md invariants 2 and 3 (workspace_id ==
 * tenant_id; the scope comes from the Principal, never from the request body).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getScope, withScope } from '@usetheo/memory-agent-core';
import type { ScopedContext } from '@usetheo/memory/contract';
import { McpServer } from './server.js';

const OUTER_WORKSPACE = 'wk-tenant-a';

afterEach(() => {
  delete process.env['THEOMEM_MCP_DEFAULT_USER_ID'];
});

type ToolsCallHandler = (req: unknown, extra: unknown) => Promise<unknown>;

/** The SDK keeps registered handlers in a private map; reach it once, here. */
function toolsCallHandler(server: McpServer): ToolsCallHandler {
  const handler = (
    server.sdkServer as unknown as { _requestHandlers: Map<string, ToolsCallHandler> }
  )._requestHandlers.get('tools/call');
  if (handler === undefined) throw new Error('tools/call handler not registered');
  return handler;
}

/**
 * Drives a real tools/call and returns the ambient scope observed at the moment the
 * tool would reach the backend. `memoryFactory` is that moment, so it is the honest
 * observation point — no re-implementation of the handler's scope logic.
 */
async function scopeAtBackend(outer: ScopedContext): Promise<ScopedContext | undefined> {
  let seen: ScopedContext | undefined;
  const server = new McpServer({
    name: 'themory',
    version: 'test',
    memoryFactory: () => {
      seen = getScope();
      throw new Error('observed — the scope is all this test needs');
    },
  });
  const handler = toolsCallHandler(server);

  await withScope(outer, () =>
    handler(
      { method: 'tools/call', params: { name: 'recall', arguments: { query: 'x' } } },
      {},
    ).catch(() => undefined),
  );
  return seen;
}

describe('tools/call scope binding (M7)', () => {
  it('keeps the auth-trusted workspaceId when a default userId is configured', async () => {
    // Reproduces the deployed MCP service configuration exactly.
    process.env['THEOMEM_MCP_DEFAULT_USER_ID'] = 'claude-code';

    const seen = await scopeAtBackend({ workspaceId: OUTER_WORKSPACE });

    // The userId tier is applied...
    expect(seen?.session?.userId).toBe('claude-code');
    // ...WITHOUT discarding the workspace that carries tenancy. This is the assertion
    // that fails on the pre-fix code, where withScope replaced the whole context.
    expect(seen?.workspaceId).toBe(OUTER_WORKSPACE);
  });

  it('does not invent a workspace when the outer scope has none', async () => {
    process.env['THEOMEM_MCP_DEFAULT_USER_ID'] = 'claude-code';

    const seen = await scopeAtBackend({ session: { userId: 'ignored-outer' } });

    expect(seen?.session?.userId).toBe('claude-code');
    // Merging must not fabricate tenancy — an absent workspace stays absent so the
    // downstream guard can fail closed rather than silently binding the wrong tenant.
    expect(seen?.workspaceId).toBeUndefined();
  });
});
