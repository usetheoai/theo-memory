/**
 * T4.1 RED tests for buildReflectionPrompt per plan v0-4a-reflection-pipeline.
 *
 */
import { describe, expect, test } from 'vitest';

import type { MemoryItem } from './memory-item.js';
import { buildReflectionPrompt } from './reflection/prompt.js';
import { PROMPT_VERSION } from './reflection/types.js';
import type { Scope } from './scope.js';

function mockMemory(id: string, text: string, scope: Scope): MemoryItem {
  return {
    id,
    text,
    hash: 'mock-hash',
    scope,
    metadata: {},
    tValid: new Date('2026-05-26'),
    tInvalid: null,
    createdAt: new Date('2026-05-26'),
    updatedAt: new Date('2026-05-26'),
  };
}

describe('buildReflectionPrompt (T4.1)', () => {
  test('PROMPT_VERSION constant is exported as "1.1"', () => {
    expect(PROMPT_VERSION).toBe('1.1');
  });

  test('includes "reflection helper" framing', () => {
    const scope: Scope = { kind: 'user', userId: 'alice' };
    const prompt = buildReflectionPrompt(scope, []);
    expect(prompt.toLowerCase()).toContain('reflection helper');
  });

  test('substitutes user scope identifier', () => {
    const scope: Scope = { kind: 'user', userId: 'alice' };
    const prompt = buildReflectionPrompt(scope, []);
    expect(prompt).toContain('user "alice"');
  });

  test('substitutes session scope identifier with optional userId', () => {
    const scope: Scope = { kind: 'session', sessionId: 'sess-1', userId: 'alice' };
    const prompt = buildReflectionPrompt(scope, []);
    expect(prompt).toContain('session "sess-1"');
    expect(prompt).toContain('user "alice"');
  });

  test('contains "invent NO ids" instruction', () => {
    const scope: Scope = { kind: 'user', userId: 'alice' };
    const prompt = buildReflectionPrompt(scope, []);
    expect(prompt).toContain('Invent NO ids');
  });

  test('enumerates source memories with IDs', () => {
    const scope: Scope = { kind: 'user', userId: 'alice' };
    const sources = [
      mockMemory('id-1', 'Alice likes coffee', scope),
      mockMemory('id-2', 'Alice likes morning runs', scope),
    ];
    const prompt = buildReflectionPrompt(scope, sources);
    expect(prompt).toContain('id="id-1"');
    expect(prompt).toContain('id="id-2"');
    expect(prompt).toContain('Alice likes coffee');
  });

  test('declares total source count', () => {
    const scope: Scope = { kind: 'user', userId: 'alice' };
    const sources = [mockMemory('id-1', 't1', scope), mockMemory('id-2', 't2', scope)];
    const prompt = buildReflectionPrompt(scope, sources);
    expect(prompt).toContain('(2 total)');
  });

  test('mentions "derived_from" structure', () => {
    const scope: Scope = { kind: 'user', userId: 'alice' };
    const prompt = buildReflectionPrompt(scope, []);
    expect(prompt).toContain('derived_from');
  });

  test('instructs empty-array fallback when no consolidation possible', () => {
    const scope: Scope = { kind: 'user', userId: 'alice' };
    const prompt = buildReflectionPrompt(scope, []);
    expect(prompt).toContain('empty array');
  });
});
