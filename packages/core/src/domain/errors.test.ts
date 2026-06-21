import { describe, expect, test } from 'vitest';

import {
  BiTemporalNotSupportedLocally,
  EmbeddingMismatch,
  InvalidScope,
  MemoryNotFound,
  MissingScopeError,
  ReflectionNotConfigured,
  ToolInvocationDeniedError,
  SkillExecutionNotConfiguredError,
  SkillExecutorUnavailableError,
  type ToolInvocationDeniedReason,
} from './errors.js';

describe('EC-2 — every error subclass survives cross-module instanceof checks', () => {
  test('MemoryNotFound: instanceof works on a fresh instance', () => {
    const e = new MemoryNotFound('mem-uuid-123');
    expect(e instanceof MemoryNotFound).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(e.name).toBe('MemoryNotFound');
    expect(e.message).toContain('mem-uuid-123');
  });

  test('InvalidScope: instanceof works on a fresh instance', () => {
    const e = new InvalidScope('user_id is required');
    expect(e instanceof InvalidScope).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(e.name).toBe('InvalidScope');
  });

  test('EmbeddingMismatch: instanceof works on a fresh instance', () => {
    const e = new EmbeddingMismatch(1536, 768);
    expect(e instanceof EmbeddingMismatch).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(e.name).toBe('EmbeddingMismatch');
    expect(e.message).toContain('1536');
    expect(e.message).toContain('768');
  });

  test('BiTemporalNotSupportedLocally: instanceof works on a fresh instance', () => {
    const e = new BiTemporalNotSupportedLocally();
    expect(e instanceof BiTemporalNotSupportedLocally).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(e.name).toBe('BiTemporalNotSupportedLocally');
  });

  test('ReflectionNotConfigured: instanceof works on a fresh instance', () => {
    const e = new ReflectionNotConfigured();
    expect(e instanceof ReflectionNotConfigured).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(e.name).toBe('ReflectionNotConfigured');
  });
});

describe('errors preserve cause via ErrorOptions (Node 20 + ES2022)', () => {
  test('MemoryNotFound retains cause when provided', () => {
    const root = new Error('db connection failed');
    const e = new MemoryNotFound('mem-uuid-x', { cause: root });
    expect(e.cause).toBe(root);
  });

  test('BiTemporalNotSupportedLocally retains cause when provided', () => {
    const root = new Error('local-runtime probe');
    const e = new BiTemporalNotSupportedLocally({ cause: root });
    expect(e.cause).toBe(root);
  });
});

describe('error name fields are literal-typed (as const)', () => {
  test('MemoryNotFound.name narrows to the literal "MemoryNotFound"', () => {
    const e = new MemoryNotFound('x');
    const literal: 'MemoryNotFound' = e.name;
    expect(literal).toBe('MemoryNotFound');
  });
});

describe('MissingScopeError — fail-loud per ADR D4 (binding 3-state resolver)', () => {
  test('exposes a stable literal name "MissingScopeError"', () => {
    const e = new MissingScopeError('authenticated session required');
    const literal: 'MissingScopeError' = e.name;
    expect(literal).toBe('MissingScopeError');
  });

  test('is an instance of Error AND of MissingScopeError (EC-2 cross-module trap)', () => {
    const e = new MissingScopeError('binding requires session-bearing TheoKit context');
    expect(e instanceof Error).toBe(true);
    expect(e instanceof MissingScopeError).toBe(true);
  });

  test('preserves the caller-provided message verbatim', () => {
    const message = 'authenticated session required — call requireAuth(ctx.session) first';
    const e = new MissingScopeError(message);
    expect(e.message).toBe(message);
  });

  test('retains cause when provided via ErrorOptions', () => {
    const root = new Error('upstream session decode failure');
    const e = new MissingScopeError('session decryption failed', { cause: root });
    expect(e.cause).toBe(root);
  });
});

describe('ToolInvocationDeniedError (T1.2)', () => {
  test('name + reason + instanceof Error', () => {
    const e = new ToolInvocationDeniedError('timeout', 'exceeded 1000ms');
    expect(e).toBeInstanceOf(Error);
    expect(e instanceof ToolInvocationDeniedError).toBe(true);
    expect(e.name).toBe('ToolInvocationDeniedError');
    expect(e.reason).toBe('timeout');
    expect(e.message).toContain('timeout');
  });

  test('reason union covers all 10 guard literals', () => {
    const reasons: ToolInvocationDeniedReason[] = [
      'node-binding-attempt',
      'fs-access-attempt',
      'timeout',
      'output-cap',
      'tool-call-cap',
      'non-cloneable-args',
      'non-cloneable-result',
      'unsupported-language',
      'unsupported-async',
      'empty-code',
    ];
    for (const r of reasons) {
      expect(new ToolInvocationDeniedError(r, 'detail').reason).toBe(r);
    }
  });

  test('retains cause via ErrorOptions', () => {
    const root = new Error('isolate boom');
    const e = new ToolInvocationDeniedError('timeout', 'x', { cause: root });
    expect(e.cause).toBe(root);
  });
});

describe('SkillExecutionNotConfiguredError (T1.2)', () => {
  test('name + instanceof Error', () => {
    const e = new SkillExecutionNotConfiguredError('no executor wired for this scope');
    expect(e).toBeInstanceOf(Error);
    expect(e instanceof SkillExecutionNotConfiguredError).toBe(true);
    expect(e.name).toBe('SkillExecutionNotConfiguredError');
  });
});

describe('SkillExecutorUnavailableError (T1.2)', () => {
  test('name + instanceof Error + carries install hint in message', () => {
    const e = new SkillExecutorUnavailableError('isolated-vm');
    expect(e).toBeInstanceOf(Error);
    expect(e instanceof SkillExecutorUnavailableError).toBe(true);
    expect(e.name).toBe('SkillExecutorUnavailableError');
    expect(e.message).toContain('isolated-vm');
  });
});
