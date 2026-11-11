/**
 * Error classifier for v0.3 MCP server.
 *
 * Maps thrown errors to TWO wire-shapes per MCP spec 2025-11-25 § Error Handling:
 *
 * 1. **Protocol Errors** (JSON-RPC `error{code, message, data?}`):
 *    - `-32601 Method not found`: unknown tool name (UnknownToolError)
 *    - `-32602 Invalid params`: malformed args (ZodError at boundary)
 *    - `-32603 Internal error`: unexpected fallback (NO stack/cause leak per EC-13)
 *
 * 2. **Tool Execution Errors** (`result.isError: true` + content text):
 *    - MissingScopeError → scope-binding failure (T3.1)
 *    - MemoryStoreError → pg/persistence boundary failure
 *    - EmbedderError → embedding provider failure
 *    - ContentTooLargeError → payload exceeds cap (EC-2)
 *    - pg-driver errors with PG_TRANSIENT_CODES (EC-5) → mapped to MemoryStoreError-equivalent text
 *
 * Branch order: typed domain errors → PG_TRANSIENT_CODES → UnknownToolError → ZodError → -32603 fallback.
 *
 * @see ADR D6 — TWO error mechanisms per MCP spec
 * @see EC-5 (plan v1.1) — PG_TRANSIENT_CODES
 * @see EC-13 (plan v1.1) — Error.cause + Error.stack not leaked in -32603 data
 */
import {
  ContentTooLargeError,
  EmbedderError,
  EntityForgetScopeError,
  MemoryStoreError,
  MessageLogNotConfigured,
  MissingScopeError,
  ReflectionNotConfigured,
} from '@usetheo/memory/contract';
import { ZodError } from 'zod';


/**
 * Pg driver transient codes (EC-5 absorbed). Errors carrying these codes are
 * transient infrastructure failures — agents can retry. Mapped to Tool Execution
 * Error with `Retry in a moment` text rather than crashing the JSON-RPC connection.
 */
const PG_TRANSIENT_CODES = new Set<string>([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'ECONNRESET',
]);

/**
 * Catalog of expected domain error classes — the upstream `EXPECTED_MCP_TOOL_ERRORS`
 * pattern (blueprint Q3) adapted for v0.3. Used by future observability to
 * classify log-level (info vs warning).
 */
export const EXPECTED_DOMAIN_ERRORS = [
  'MissingScopeError',
  'MemoryStoreError',
  'EmbedderError',
  'ContentTooLargeError',
] as const;

/**
 * Sentinel thrown by tool dispatch (T5.1) when a `tools/call` request names
 * a tool not in the locked verb set. Maps to -32601 Method not found.
 */
export class UnknownToolError extends Error {
  override readonly name = 'UnknownToolError' as const;

  constructor(requestedTool: string, options?: ErrorOptions) {
    super(`Unknown tool: ${requestedTool}`, options);
    Object.setPrototypeOf(this, UnknownToolError.prototype);
  }
}

/** Single text-block content entry per MCP spec § Tool Result § Text Content. */
interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

/** Tool Execution Error wire shape (returned in JSON-RPC `result`). */
export interface ToolExecutionErrorPayload {
  readonly content: readonly TextContent[];
  readonly isError: true;
}

/** Protocol Error wire shape (returned in JSON-RPC `error` field). */
export interface ProtocolErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** Tagged union returned by `classifyError`. */
export type ClassifiedError =
  | { readonly kind: 'execution'; readonly payload: ToolExecutionErrorPayload }
  | { readonly kind: 'protocol'; readonly payload: ProtocolErrorPayload };

function execution(text: string): ClassifiedError {
  return { kind: 'execution', payload: { content: [{ type: 'text', text }], isError: true } };
}

function protocolErr(code: number, message: string, data?: Record<string, unknown>): ClassifiedError {
  return data
    ? { kind: 'protocol', payload: { code, message, data } }
    : { kind: 'protocol', payload: { code, message } };
}

/**
 * Classifies an arbitrary thrown error into its MCP wire-shape per ADR D6.
 *
 * Branch order matters: typed domain errors first (instanceof checks), then
 * pg-transient code matches (errors that happen to look like Error but carry
 * `.code`), then UnknownToolError + ZodError, finally -32603 fallback that
 * sanitizes any unexpected shape.
 */
export function classifyError(err: unknown): ClassifiedError {
  // 1. Domain errors → Tool Execution Errors (LLM-self-correctable)
  if (err instanceof MissingScopeError) {
    return execution(
      'Scope not bound. Caller must invoke memoryFromCtx with ctx.session before tool call (per ADR D3).',
    );
  }
  if (err instanceof EntityForgetScopeError) {
    // Fail-closed #252 defense-in-depth: an entity forget reached the store without a confirmed
    // user. Surface as a self-correctable execution error (not a -32603 protocol error, F-api-4).
    return execution('Entity delete refused: an active user scope is required (fail-closed).');
  }
  if (err instanceof MemoryStoreError) {
    return execution('Memory store unavailable. Retry in a moment.');
  }
  if (err instanceof EmbedderError) {
    return execution('Embedding provider unavailable. Retry in a moment.');
  }
  if (err instanceof ContentTooLargeError) {
    return execution(err.message);
  }
  if (err instanceof MessageLogNotConfigured) {
    return execution('This server runs without the raw message log, so message search is unavailable. Use recall instead.');
  }
  if (err instanceof ReflectionNotConfigured) {
    // v0.1 reflect algorithm deferred to v0.4a per CLAUDE.md Roadmap Item 5.
    // Surface as Tool Execution Error so agent loops can self-correct rather than crash.
    return execution(
      'Reflection algorithm not yet shipped (v0.4a per CLAUDE.md Roadmap Item 5). Try again after the v0.4a upgrade.',
    );
  }

  // 2. pg-driver transient codes (EC-5) → Tool Execution Error
  if (err instanceof Error && hasTransientPgCode(err)) {
    return execution('Memory store unavailable. Retry in a moment.');
  }

  // 3. UnknownToolError → -32601 Method not found (JSON-RPC convention: standard message; details in data)
  if (err instanceof UnknownToolError) {
    return protocolErr(-32601, 'Method not found', { details: err.message });
  }

  // 4. ZodError (boundary validation fail) → -32602 Invalid params
  if (err instanceof ZodError) {
    return protocolErr(-32602, 'Invalid params', { issues: err.issues });
  }

  // 5. Fallback → -32603 Internal error
  //    EC-13: do NOT leak Error.cause chain or Error.stack into data field.
  const message = err instanceof Error ? err.message : 'Unknown error';
  return protocolErr(-32603, `Internal error: ${message}`);
}

function hasTransientPgCode(err: Error): boolean {
  const code = (err as Error & { code?: unknown }).code;
  return typeof code === 'string' && PG_TRANSIENT_CODES.has(code);
}
