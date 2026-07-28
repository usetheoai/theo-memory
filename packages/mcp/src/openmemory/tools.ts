/**
 * OpenMemory MCP-shape compatibility — tool alias set.
 *
 * Exposes the OpenMemory MCP Server's tool surface (`add_memories` /
 * `search_memory` / `list_memories` / `delete_memories`) as an opt-in alias over
 * TheMemory's native verbs, so MCP clients already wired to OpenMemory work
 * against this server unchanged. Adapter-only (architecture.md § 3): every handler
 * delegates to the `Memory` contract via the same `getScope()` + `memoryFromCtx`
 * pattern as the native handlers; `src/core` is untouched.
 *
 * The four wire-names are the vendor interop CONTRACT (string literals are allowed
 * here per no-paper-names-in-code.md § benchmark/vendor-interop precedent); internal
 * identifiers stay neutral.
 *
 * Return-shape parity (blueprint D5): tools return a single text content block
 * carrying a JSON string on success, or `"Error: …"` on failure — matching what
 * OpenMemory clients parse.
 *
 */
import type { CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { MissingScopeError } from '@usetheo/memory/contract';
import type { Memory, MemoryItem } from '@usetheo/memory/contract';
import { memoryFromCtx } from '@usetheo/memory/theokit';
import { getScope } from '@usetheo/memory-agent-core';
import { z } from 'zod';

import { MAX_CONTENT_BYTES, MAX_QUERY_BYTES } from '../tools/constants.js';
import { emitToolSchema } from '../tools/schema-emit.js';
import { workspaceScopedMemory } from '../tools/workspace-scoped-memory.js';

// ── Tool wire-names (OpenMemory contract) ──────────────────────────────────
export const ADD_MEMORIES = 'add_memories' as const;
export const SEARCH_MEMORY = 'search_memory' as const;
export const LIST_MEMORIES = 'list_memories' as const;
export const DELETE_MEMORIES = 'delete_memories' as const;

// ── Input schemas (mirror OpenMemory mcp_server.py signatures) ─────────────
const AddMemoriesInput = z
  .object({
    text: z.string().min(1).max(MAX_CONTENT_BYTES),
    infer: z.boolean().optional(),
  })
  .strict();

const SearchMemoryInput = z.object({ query: z.string().min(1).max(MAX_QUERY_BYTES) }).strict();

const ListMemoriesInput = z.object({}).strict();

const DeleteMemoriesInput = z
  .object({ memory_ids: z.array(z.string().min(1)).min(1) })
  .strict();

// ── Descriptions (paraphrased from OpenMemory; neutral, no marketing) ──────
const ADD_DESC =
  'Add a new memory. Call whenever the user states a preference, fact, or anything worth recalling later. Set infer to false to store the text verbatim without LLM fact extraction.';
const SEARCH_DESC = 'Search through stored memories. Call when the user asks anything that may need recall.';
const LIST_DESC = "List all memories in the user's memory.";
const DELETE_DESC = 'Delete specific memories by their IDs.';

/**
 * The opt-in OpenMemory `tools/list` payload (exactly the four names, in the
 * order OpenMemory's `tools/list` test asserts).
 */
export function buildOpenMemoryToolsList(): ListToolsResult {
  type SchemaSlot = ListToolsResult['tools'][number]['inputSchema'];
  return {
    tools: [
      { name: ADD_MEMORIES, description: ADD_DESC, inputSchema: emitToolSchema(AddMemoriesInput) as SchemaSlot },
      { name: SEARCH_MEMORY, description: SEARCH_DESC, inputSchema: emitToolSchema(SearchMemoryInput) as SchemaSlot },
      { name: LIST_MEMORIES, description: LIST_DESC, inputSchema: emitToolSchema(ListMemoriesInput) as SchemaSlot },
      { name: DELETE_MEMORIES, description: DELETE_DESC, inputSchema: emitToolSchema(DeleteMemoriesInput) as SchemaSlot },
    ],
  };
}

/** Wrap a JSON-serializable success payload as an OpenMemory-shape text result. */
function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false };
}

/** Wrap a failure as an OpenMemory-shape `"Error: …"` text result. */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

interface Deps { memoryFactory: () => Memory }

export async function addMemoriesHandler(args: unknown, deps: Deps): Promise<CallToolResult> {
  const parsed = AddMemoriesInput.parse(args);
  const scoped = memoryFromCtx(getScope(), workspaceScopedMemory(deps.memoryFactory()));
  const opts = parsed.infer !== undefined ? { infer: parsed.infer } : undefined;
  const items = await scoped.remember(parsed.text, opts);
  return jsonResult({ added: items.length, ids: items.map((i) => i.id) });
}

export async function searchMemoryHandler(args: unknown, deps: Deps): Promise<CallToolResult> {
  const parsed = SearchMemoryInput.parse(args);
  const scoped = memoryFromCtx(getScope(), workspaceScopedMemory(deps.memoryFactory()));
  const hits = await scoped.recall(parsed.query);
  return jsonResult(
    hits.map((h) => ({ id: h.id, memory: h.text, score: h.score, created_at: h.createdAt.toISOString() })),
  );
}

export async function listMemoriesHandler(_args: unknown, deps: Deps): Promise<CallToolResult> {
  ListMemoriesInput.parse(_args ?? {});
  const scoped = memoryFromCtx(getScope(), workspaceScopedMemory(deps.memoryFactory()));
  const all = await scoped.getAll();
  return jsonResult(all.map((m) => ({ id: m.id, memory: m.text, created_at: m.createdAt.toISOString() })));
}

/**
 * Resolve the path-bound user id from the active scope, mirroring the user-tier
 * resolution in `memoryFromCtx`. This is the scope gate the other three handlers
 * get for free via `memoryFromCtx`; `forget` lives on top-level `Memory` (NOT
 * `ScopedMemory`), so the delete path must re-derive the user id explicitly.
 *
 * @throws MissingScopeError when the request carries no user-tier scope.
 */
function requireUserId(): string {
  const userId = getScope().session?.userId;
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new MissingScopeError('delete_memories requires a user-scoped request.');
  }
  return userId;
}

/** A memory is the requesting user's iff it is user-scoped to that exact id. */
function ownedByUser(item: MemoryItem, userId: string): boolean {
  return item.scope.kind === 'user' && item.scope.userId === userId;
}

export async function deleteMemoriesHandler(args: unknown, deps: Deps): Promise<CallToolResult> {
  const parsed = DeleteMemoriesInput.parse(args);
  const userId = requireUserId();
  const memory = workspaceScopedMemory(deps.memoryFactory());
  const deleted: string[] = [];
  for (const id of parsed.memory_ids) {
    // Per-user isolation (the load-bearing IDOR guard on the multi-user SSE path):
    // `Memory.forget` is global-by-id by design, so we MUST confirm ownership
    // before forgetting. An id the user does not own is skipped, never deleted.
    const item = await memory.get(id);
    if (item === null || !ownedByUser(item, userId)) {
      continue; // unknown OR not owned → skip (best-effort OpenMemory parity)
    }
    try {
      await memory.forget(id);
      deleted.push(id);
    } catch {
      // already-forgotten / race → skip
    }
  }
  if (deleted.length === 0) {
    return errorResult('No accessible memories found with provided IDs');
  }
  return jsonResult({ deleted });
}

const HANDLERS = new Map<string, (a: unknown, d: Deps) => Promise<CallToolResult>>([
  [ADD_MEMORIES, addMemoriesHandler],
  [SEARCH_MEMORY, searchMemoryHandler],
  [LIST_MEMORIES, listMemoriesHandler],
  [DELETE_MEMORIES, deleteMemoriesHandler],
]);

/**
 * Dispatch an OpenMemory `tools/call` to its alias handler.
 *
 * Contract divergence from the NATIVE dispatch (ADR D6 throws `McpError`): the
 * OpenMemory wire-shape expects ALL failures — unknown tool, validation, handler
 * error — as a single `isError: true` text result `"Error: …"` that clients
 * parse (blueprint D5). This is the deliberate wire-parity override of the native
 * throw-contract, isolated to this compat adapter so `src/core` is untouched.
 */
export async function openMemoryDispatch(
  toolName: string,
  args: unknown,
  deps: Deps,
): Promise<CallToolResult> {
  const handler = HANDLERS.get(toolName);
  if (handler === undefined) {
    return errorResult(`Unknown tool: ${toolName}`);
  }
  try {
    return await handler(args, deps);
  } catch (err: unknown) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
