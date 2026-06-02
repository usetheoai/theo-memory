/**
 * adapters-openrouter-local-embedder T2.1 — unit RED tests for the
 * `resolveBackendMode` precedence ladder + EC-11 unknown-value loud-fail
 * absorbed at plan v1.1.
 *
 * EC-13 absorption: this test file lives at `tests/unit/examples/` (matches
 * `tests/unit/**\/*.test.ts` vitest contract include glob) — NOT under
 * `examples/chat-with-memory/lib/__tests__/` which would be UNREACHABLE
 * per vitest.contract.config.ts:5-9. Avoids replicating the v0-4a T0.1
 * Stop-Condition-#4 failure mode.
 *
 * Strategy: `resolveBackendMode` is extracted as a standalone exported
 * helper so the env-var precedence ladder can be unit-tested in isolation.
 * The full `buildStore` + `getSingleton` factory is exercised end-to-end
 * by the T4.1 integration test against the demo HTTP surface (running
 * dev server).
 *
 * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T2.1 + ADR D6
 * @see .claude/knowledge-base/reviews/adapters-openrouter-local-embedder-edge-cases-2026-06-01.md § EC-11 + EC-13
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { resolveBackendMode } from '../../../examples/chat-with-memory/lib/memory.js';

const ENV_KEYS = ['THEOMEM_DEMO_BACKEND', 'THEOMEM_USE_STUB_ADAPTERS'] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}
function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
}
function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe('resolveBackendMode — precedence ladder (T2.1 / ADR D6)', () => {
  let envSnapshot: Record<string, string | undefined>;
  beforeEach(() => {
    envSnapshot = snapshotEnv();
    clearEnv();
  });
  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  test('defaults to "openai" when no env var is set', () => {
    expect(resolveBackendMode()).toBe('openai');
  });

  test('THEOMEM_DEMO_BACKEND="stub" → "stub"', () => {
    process.env.THEOMEM_DEMO_BACKEND = 'stub';
    expect(resolveBackendMode()).toBe('stub');
  });

  test('THEOMEM_DEMO_BACKEND="openai" → "openai"', () => {
    process.env.THEOMEM_DEMO_BACKEND = 'openai';
    expect(resolveBackendMode()).toBe('openai');
  });

  test('THEOMEM_DEMO_BACKEND="local-openrouter" → "local-openrouter"', () => {
    process.env.THEOMEM_DEMO_BACKEND = 'local-openrouter';
    expect(resolveBackendMode()).toBe('local-openrouter');
  });

  test('legacy THEOMEM_USE_STUB_ADAPTERS=1 → "stub" (backward compat)', () => {
    process.env.THEOMEM_USE_STUB_ADAPTERS = '1';
    expect(resolveBackendMode()).toBe('stub');
  });

  test('THEOMEM_DEMO_BACKEND="openai" wins over legacy stub flag (precedence)', () => {
    process.env.THEOMEM_DEMO_BACKEND = 'openai';
    process.env.THEOMEM_USE_STUB_ADAPTERS = '1';
    expect(resolveBackendMode()).toBe('openai');
  });

  test('THEOMEM_DEMO_BACKEND="local-openrouter" wins over legacy stub flag', () => {
    process.env.THEOMEM_DEMO_BACKEND = 'local-openrouter';
    process.env.THEOMEM_USE_STUB_ADAPTERS = '1';
    expect(resolveBackendMode()).toBe('local-openrouter');
  });
});

describe('resolveBackendMode — EC-11 unknown-value loud-fail (T2.1 / EC-11)', () => {
  let envSnapshot: Record<string, string | undefined>;
  beforeEach(() => {
    envSnapshot = snapshotEnv();
    clearEnv();
  });
  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  test('throws on underscore typo: THEOMEM_DEMO_BACKEND="local_openrouter"', () => {
    process.env.THEOMEM_DEMO_BACKEND = 'local_openrouter';
    expect(() => resolveBackendMode()).toThrow(/local_openrouter/);
  });

  test('throws on uppercase variant: THEOMEM_DEMO_BACKEND="LOCAL-OPENROUTER"', () => {
    process.env.THEOMEM_DEMO_BACKEND = 'LOCAL-OPENROUTER';
    expect(() => resolveBackendMode()).toThrow(/LOCAL-OPENROUTER/);
  });

  test('throws on generic typo: THEOMEM_DEMO_BACKEND="banana"', () => {
    process.env.THEOMEM_DEMO_BACKEND = 'banana';
    expect(() => resolveBackendMode()).toThrow(/banana/);
  });

  test('error message lists all 3 valid values (operator diagnosability)', () => {
    process.env.THEOMEM_DEMO_BACKEND = 'banana';
    expect(() => resolveBackendMode()).toThrow(/stub/);
    expect(() => resolveBackendMode()).toThrow(/openai/);
    expect(() => resolveBackendMode()).toThrow(/local-openrouter/);
  });

  test('empty string THEOMEM_DEMO_BACKEND="" is treated as unset (defaults to openai)', () => {
    process.env.THEOMEM_DEMO_BACKEND = '';
    expect(resolveBackendMode()).toBe('openai');
  });
});
