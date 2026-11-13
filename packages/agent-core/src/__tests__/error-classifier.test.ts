/**
 * Error classifier tests — T4.1.
 *
 * Maps thrown errors to TWO MCP wire-shapes per spec 2025-11-25 § Error Handling:
 * - **Protocol Errors** (JSON-RPC `error{code, message, data?}`): unknown tool, malformed args, transport crash
 * - **Tool Execution Errors** (`result.isError: true` + content text): domain failures forwarded for LLM self-correction
 *
 * @see ADR D6 — TWO error mechanisms per MCP spec
 * @see EC-5 (plan v1.1) — PG_TRANSIENT_CODES mapped to MemoryStoreError → Tool Execution Error
 * @see EC-13 (plan v1.1 SHOULD TEST inline) — Error.cause + Error.stack NOT leaked in -32603 data
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ContentTooLargeError,
  EmbedderError,
  EntityForgetScopeError,
  MemoryStoreError,
  MessageLogNotConfigured,
  MissingScopeError,
} from '@usetheo/memory/contract';
import { classifyError, UnknownToolError } from '../error-classifier.js';

/** Assert a classified error is a self-correctable execution error whose text matches `re`. */
function assertExecution(result: ReturnType<typeof classifyError>, re: RegExp): void {
  expect(result.kind).toBe('execution');
  if (result.kind === 'execution') {
    expect(result.payload.isError).toBe(true);
    expect(result.payload.content[0]?.text).toMatch(re);
  }
}

describe('classifyError — Tool Execution Error mappings (ADR D6)', () => {
  it('maps MissingScopeError to an execution error with isError:true', () => {
    assertExecution(classifyError(new MissingScopeError('getScope: no active scope.')), /Scope/);
  });

  it('maps EntityForgetScopeError to a self-correctable execution error (not -32603, F-api-4)', () => {
    assertExecution(
      classifyError(new EntityForgetScopeError('forgetEntity(X) requires filters.user_id')),
      /user scope|fail-closed/i,
    );
  });

  it('maps MessageLogNotConfigured to an execution error naming the disabled log', () => {
    assertExecution(classifyError(new MessageLogNotConfigured('searchMessages')), /message log/i);
  });

  it('maps MemoryStoreError to an execution error with retry-in-a-moment text', () => {
    assertExecution(classifyError(new MemoryStoreError('pg connection refused')), /Retry/i);
  });

  it('maps EmbedderError to an execution error with retry text', () => {
    assertExecution(classifyError(new EmbedderError('OpenAI 429 rate limit')), /Retry/i);
  });

  it('maps ContentTooLargeError to an execution error citing the max cap', () => {
    assertExecution(classifyError(new ContentTooLargeError(50_000, 75_000)), /50000/);
  });

  it('maps pg-driver ECONNREFUSED (EC-5 PG_TRANSIENT_CODES) to an execution error with retry text', () => {
    // Simulate a pg-driver error with a transient code attached.
    const pgErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED' as const,
    });
    assertExecution(classifyError(pgErr), /Retry/i);
  });
});

describe('classifyError — Protocol Error mappings (JSON-RPC error{} per spec)', () => {
  it('maps UnknownToolError to -32601 Method not found', () => {
    const result = classifyError(new UnknownToolError('xxx'));
    expect(result.kind).toBe('protocol');
    if (result.kind === 'protocol') {
      expect(result.payload.code).toBe(-32601);
      expect(result.payload.message).toMatch(/Method not found/);
    }
  });

  it('maps ZodError (boundary validation fail) to -32602 Invalid params', () => {
    const schema = z.object({ content: z.string() });
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const result = classifyError(parsed.error);
      expect(result.kind).toBe('protocol');
      if (result.kind === 'protocol') {
        expect(result.payload.code).toBe(-32602);
      }
    }
  });

  it('maps unexpected errors to -32603 Internal error WITHOUT leaking stack or cause chain (EC-13)', () => {
    const innerSecret = new Error('inner with SECRET payload');
    const outer = new Error('outer message', { cause: innerSecret });
    const result = classifyError(outer);
    expect(result.kind).toBe('protocol');
    if (result.kind === 'protocol') {
      expect(result.payload.code).toBe(-32603);
      // EC-13 absorbed: no stack, no nested cause, no secret-bearing fields surface
      const serialized = JSON.stringify(result.payload);
      expect(serialized).not.toContain('SECRET');
      expect(serialized).not.toContain('stack');
      expect(serialized).not.toContain('cause');
    }
  });
});
