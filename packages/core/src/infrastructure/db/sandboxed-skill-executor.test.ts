/**
 * Contract tests for T1.3 — the SandboxedSkillExecutor (isolated-vm).
 *
 * Runs against REAL isolated-vm. A fake recording tracer observes the
 * `tool_invocation_denied` / `skill_executed` events; `vi.spyOn` on the real
 * `Isolate.prototype.dispose` verifies the no-leak invariant (dispose asymmetry:
 * pre-isolate denials do NOT dispose, post-isolate denials DO).
 *
 */
import type { Tracer } from '@opentelemetry/api';
import { describe, test, expect } from 'vitest';
import ivm from 'isolated-vm';

import { SkillExecutorUnavailableError } from '../../domain/errors.js';
import type { Skill, SkillLanguage } from '../../domain/skill.js';
import { SandboxedSkillExecutor } from './sandboxed-skill-executor.js';

interface RecordedEvent {
  readonly event: string;
  readonly attributes: Record<string, unknown>;
}

function recordingTracer(sink: RecordedEvent[]): Tracer {
  // Minimal Tracer shape consumed by emitEvent: startActiveSpan(name, fn(span)).
  return {
    startActiveSpan(name: string, fn: (span: unknown) => void): void {
      const attributes: Record<string, unknown> = {};
      fn({
        setAttribute(k: string, v: unknown) {
          attributes[k] = v;
        },
        end() {
          /* no-op */
        },
      });
      sink.push({ event: name, attributes });
    },
  } as unknown as Tracer;
}

function mkSkill(code: string | null, codeLanguage: SkillLanguage | null = 'javascript'): Skill {
  return {
    id: 'skill-test-id',
    kind: 'skill',
    code,
    description: 'test skill',
    codeLanguage,
    supersededBy: null,
    createdAt: new Date('2026-06-21T00:00:00Z'),
  } as Skill;
}

/**
 * isolated-vm's `dispose` is a non-configurable native prototype method (vi.spyOn
 * cannot wrap it). Instead, inject a loader whose `Isolate` shadows each instance's
 * `dispose` with a counting own-property — the loader seam (DEC-6) is the test hook.
 */
interface DisposeTracker {
  loader(): Promise<unknown>;
  count(): number;
}
function trackingLoader(): DisposeTracker {
  let disposed = 0;
  const trackedIsolate = function (options?: ConstructorParameters<typeof ivm.Isolate>[0]) {
    // isolated-vm Isolate instances are native + non-extensible, so we cannot add an
    // own `dispose`. A Proxy intercepts `dispose` (counting) and delegates every other
    // member to the real isolate (native methods bound to the real target).
    const iso = new ivm.Isolate(options);
    return new Proxy(iso, {
      get(target, prop, receiver): unknown {
        if (prop === 'dispose') {
          return () => {
            disposed += 1;
            target.dispose();
          };
        }
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  } as unknown as typeof ivm.Isolate;
  const trackedModule = new Proxy(ivm, {
    get(target, prop, receiver): unknown {
      if (prop === 'Isolate') return trackedIsolate;
      return Reflect.get(target, prop, receiver);
    },
  });
  return {
    loader: () => Promise.resolve(trackedModule),
    count: () => disposed,
  };
}

describe('SandboxedSkillExecutor — constructor is addon-free (production-runtime-hardening EC-1)', () => {
  test('test_constructor_does_not_require_isolated_vm: new SandboxedSkillExecutor() never loads the addon at construction', () => {
    // EC-1: enabling THEOMEM_SKILL_EXECUTION on a runtime WITHOUT isolated-vm must
    // NOT crash server boot. The constructor only captures a lazy loader; the addon
    // loads at execute(). A throwing loader proves the ctor never invokes it.
    let loaderCalled = false;
    const throwingLoader = (): never => {
      loaderCalled = true;
      throw new Error('isolated-vm absent');
    };
    expect(() => new SandboxedSkillExecutor({ loadIsolatedVm: throwingLoader })).not.toThrow();
    expect(loaderCalled).toBe(false);
    // Default constructor (real `() => import('isolated-vm')`) also must not throw.
    expect(() => new SandboxedSkillExecutor()).not.toThrow();
  });
});

describe('SandboxedSkillExecutor — benign execution (T1.3 EC-1)', () => {
  test('test_benign_add_returns_5: export function add returns the invocation result', async () => {
    const events: RecordedEvent[] = [];
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ tracer: recordingTracer(events), loadIsolatedVm: t.loader });
    const result = await exec.execute(mkSkill('export function add(x, y) { return x + y; }'), {
      x: 2,
      y: 3,
    });
    expect(result.output).toBe(5);
    expect(result.truncated).toBe(false);
    expect(typeof result.elapsedMs).toBe('number');
    expect(events.some((e) => e.event === 'skill_executed')).toBe(true);
    expect(t.count()).toBe(1);
  });
});

describe('SandboxedSkillExecutor — pre-isolate denials (NO dispose)', () => {
  test('test_null_code_denied_empty_code', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(exec.execute(mkSkill(null), {})).rejects.toMatchObject({
      name: 'ToolInvocationDeniedError',
      reason: 'empty-code',
    });
    expect(t.count()).toBe(0);
  });

  test('test_typescript_skill_denied_unsupported_language', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(
      exec.execute(mkSkill('export function f(): number { return 1; }', 'typescript'), {}),
    ).rejects.toMatchObject({ reason: 'unsupported-language' });
    expect(t.count()).toBe(0);
  });

  test('test_async_skill_denied_unsupported_async', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(
      exec.execute(mkSkill('export async function f() { return 1; }'), {}),
    ).rejects.toMatchObject({ reason: 'unsupported-async' });
    expect(t.count()).toBe(0);
  });

  test('test_child_process_reach_denied_node_binding (pre-scan DEC-2)', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(
      exec.execute(mkSkill('export function f() { return process.env; }'), {}),
    ).rejects.toMatchObject({ reason: 'node-binding-attempt' });
    expect(t.count()).toBe(0);
  });

  test('test_fs_require_denied_fs_access (pre-scan DEC-2)', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(
      exec.execute(mkSkill("export function f() { return require('fs'); }"), {}),
    ).rejects.toMatchObject({ reason: 'fs-access-attempt' });
    expect(t.count()).toBe(0);
  });

  test('test_no_named_function_denied_unsupported_language', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(exec.execute(mkSkill('export const f = (x) => x;'), {})).rejects.toMatchObject({
      reason: 'unsupported-language',
    });
    expect(t.count()).toBe(0);
  });

  test('test_invalid_arg_key_denied (DEC-4 D4 injection guard)', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(
      exec.execute(mkSkill('export function f(a) { return a; }'), { 'a); globalThis.x = 1; (': 2 }),
    ).rejects.toMatchObject({ reason: 'non-cloneable-args' });
    expect(t.count()).toBe(0);
  });

  test('test_timeout_non_positive_rejected (EC-5)', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(
      exec.execute(mkSkill('export function f() { return 1; }'), {}, { timeoutMs: 0 }),
    ).rejects.toBeInstanceOf(Error);
    expect(t.count()).toBe(0);
  });
});

describe('SandboxedSkillExecutor — post-isolate denials (dispose REQUIRED)', () => {
  test('test_infinite_loop_denied_timeout_and_disposed', async () => {
    const events: RecordedEvent[] = [];
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ tracer: recordingTracer(events), loadIsolatedVm: t.loader });
    await expect(
      exec.execute(mkSkill('export function f() { while (true) {} }'), {}, { timeoutMs: 50 }),
    ).rejects.toMatchObject({ reason: 'timeout' });
    expect(
      events.some((e) => e.event === 'tool_invocation_denied' && e.attributes['reason'] === 'timeout'),
    ).toBe(true);
    expect(t.count()).toBe(1);
  });

  test('test_noncloneable_arg_denied', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(
      exec.execute(mkSkill('export function f(cb) { return 1; }'), { cb: () => 1 }),
    ).rejects.toMatchObject({ reason: 'non-cloneable-args' });
    expect(t.count()).toBe(1);
  });

  test('test_noncloneable_result_denied', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(
      exec.execute(mkSkill('export function f() { return function () {}; }'), {}),
    ).rejects.toMatchObject({ reason: 'non-cloneable-result' });
    expect(t.count()).toBe(1);
  });

  test('test_output_flood_denied_output_cap (DEC-3 deny-only)', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    await expect(
      exec.execute(mkSkill("export function f() { return 'x'.repeat(100000); }"), {}, { maxOutputBytes: 64 }),
    ).rejects.toMatchObject({ reason: 'output-cap' });
    expect(t.count()).toBe(1);
  });
});

describe('SandboxedSkillExecutor — backend unavailable (EC-3)', () => {
  test('test_missing_addon_throws_unavailable', async () => {
    const exec = new SandboxedSkillExecutor({
      loadIsolatedVm: () => {
        const err = new Error("Cannot find package 'isolated-vm'") as Error & { code?: string };
        err.code = 'ERR_MODULE_NOT_FOUND';
        return Promise.reject(err);
      },
    });
    await expect(exec.execute(mkSkill('export function f() { return 1; }'), {})).rejects.toBeInstanceOf(
      SkillExecutorUnavailableError,
    );
  });
});

describe('SandboxedSkillExecutor — memory limit clamp (EC-5)', () => {
  test('test_memory_limit_clamped_below_minimum_still_runs', async () => {
    const t = trackingLoader();
    const exec = new SandboxedSkillExecutor({ loadIsolatedVm: t.loader });
    const result = await exec.execute(mkSkill('export function f(x) { return x * 2; }'), { x: 21 }, {
      memoryLimitMb: 2,
    });
    expect(result.output).toBe(42);
  });
});
