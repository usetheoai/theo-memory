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
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  adaptOpenrouterEnvForDemo,
  resolveBackendMode,
  warnIfLocalOpenrouterMissingBaseUrl,
} from '../../../examples/chat-with-memory/lib/memory.js';

const ENV_KEYS = [
  'THEOMEM_DEMO_BACKEND',
  'THEOMEM_USE_STUB_ADAPTERS',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENROUTER_KEY',
  'OPENROUTER_API_KEY',
] as const;

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

// /review F-M12 EC-10 — local-openrouter mode without OPENAI_BASE_URL warn
describe('warnIfLocalOpenrouterMissingBaseUrl (T2.1 / EC-10)', () => {
  let envSnapshot: Record<string, string | undefined>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    envSnapshot = snapshotEnv();
    clearEnv();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    restoreEnv(envSnapshot);
    warnSpy.mockRestore();
  });

  test('warns when OPENAI_BASE_URL is missing (would silently route to OpenAI default URL)', () => {
    delete process.env.OPENAI_BASE_URL;
    warnIfLocalOpenrouterMissingBaseUrl();
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toMatch(/OPENAI_BASE_URL/);
    expect(msg).toMatch(/local-openrouter/);
  });

  test('warns when OPENAI_BASE_URL is empty string', () => {
    process.env.OPENAI_BASE_URL = '';
    warnIfLocalOpenrouterMissingBaseUrl();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  test('silent when OPENAI_BASE_URL is set to an OpenRouter URL', () => {
    process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
    warnIfLocalOpenrouterMissingBaseUrl();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// adaptOpenrouterEnvForDemo — promote OPENROUTER_KEY → OPENAI_API_KEY +
// default OPENAI_BASE_URL when the operator stores their key under the
// natural OpenRouter env var name.
describe('adaptOpenrouterEnvForDemo (local-openrouter mode env-shift)', () => {
  let envSnapshot: Record<string, string | undefined>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    envSnapshot = snapshotEnv();
    clearEnv();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    restoreEnv(envSnapshot);
    logSpy.mockRestore();
  });

  test('promotes OPENROUTER_KEY → OPENAI_API_KEY when OPENAI_API_KEY is missing', () => {
    process.env.OPENROUTER_KEY = 'sk-or-v1-test-key';
    adaptOpenrouterEnvForDemo();
    expect(process.env.OPENAI_API_KEY).toBe('sk-or-v1-test-key');
  });

  test('promotes OPENROUTER_API_KEY → OPENAI_API_KEY when OPENROUTER_KEY is missing', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-alt-name';
    adaptOpenrouterEnvForDemo();
    expect(process.env.OPENAI_API_KEY).toBe('sk-or-v1-alt-name');
  });

  test('OVERWRITES an existing non-OpenRouter OPENAI_API_KEY when OPENROUTER_KEY is set (local-openrouter mode misroute-fix)', () => {
    // E2E discovery 2026-06-02: user's .env had OPENAI_API_KEY=sk-svca-...
    // (a real OpenAI service-account key) AND OPENROUTER_API_KEY=sk-or-v-...
    // The local-openrouter mode SHOULD use the OpenRouter key against
    // openrouter.ai — the OpenAI key would 401. So we override.
    process.env.OPENAI_API_KEY = 'sk-svca-openai-service-account';
    process.env.OPENROUTER_KEY = 'sk-or-v1-openrouter-target';
    adaptOpenrouterEnvForDemo();
    expect(process.env.OPENAI_API_KEY).toBe('sk-or-v1-openrouter-target');
  });

  test('leaves OPENAI_API_KEY untouched when no OpenRouter key is set', () => {
    process.env.OPENAI_API_KEY = 'sk-only-openai';
    adaptOpenrouterEnvForDemo();
    expect(process.env.OPENAI_API_KEY).toBe('sk-only-openai');
  });

  test('idempotent when OPENAI_API_KEY already equals the OpenRouter key', () => {
    process.env.OPENAI_API_KEY = 'sk-or-v1-already-the-or-key';
    process.env.OPENROUTER_KEY = 'sk-or-v1-already-the-or-key';
    adaptOpenrouterEnvForDemo();
    expect(process.env.OPENAI_API_KEY).toBe('sk-or-v1-already-the-or-key');
  });

  test('defaults OPENAI_BASE_URL to openrouter.ai when missing', () => {
    adaptOpenrouterEnvForDemo();
    expect(process.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });

  test('does NOT overwrite an existing OPENAI_BASE_URL', () => {
    process.env.OPENAI_BASE_URL = 'https://custom.example.com/v1';
    adaptOpenrouterEnvForDemo();
    expect(process.env.OPENAI_BASE_URL).toBe('https://custom.example.com/v1');
  });
});
