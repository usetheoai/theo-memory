/**
 * `SandboxedSkillExecutor` — default `SkillExecutor` impl that runs a stored
 * skill's code inside an isolated V8 context (the `isolated-vm` native addon,
 * lazy-loaded and OPTIONAL so the default barrel stays addon-free).
 *
 * Security model: the isolate is the PRIMARY guarantee — a fresh isolate has no
 * `process` / `require` / `fs` / Node bindings, so untrusted code cannot reach
 * the host by construction. On top of that primary boundary this executor adds a
 * defense-in-depth + audit layer: a source pre-scan denies (and emits an audit
 * event for) any ATTEMPT to reference Node/fs bindings, plus structured-arg
 * injection, a wall-clock timeout, an output-size cap, and a memory cap. Every
 * denial throws a typed `ToolInvocationDeniedError` and emits `tool_invocation_denied`
 * (Princípio 3 — no silent IGNORE on an RCE surface).
 *
 * Args are injected as STRUCTURED values (never string-concatenated into source);
 * only the validated arg-key identifiers are appended to the invocation expression.
 *
 * @see .claude/knowledge-base/plans/agentic-skill-execution-sandbox-plan.md § T1.3 (DEC-1..DEC-7)
 */
import type { Tracer } from '@opentelemetry/api';
// `import type` is fully erased at compile time — it does NOT pull the native addon
// into the default barrel (T1.4 / EC-47). The runtime load is the lazy #load() only.
import type { Isolate, ExternalCopy } from 'isolated-vm';

import type {
  SkillExecutor,
  SkillExecutionOptions,
  SkillExecutionResult,
} from '../../domain/dip/skill-executor.js';
import {
  ToolInvocationDeniedError,
  SkillExecutorUnavailableError,
  type ToolInvocationDeniedReason,
} from '../../domain/errors.js';
import { emitEvent } from '../../domain/memory-event.js';
import type { Skill } from '../../domain/skill.js';

/** The two addon members this executor constructs (type-only; no runtime import). */
interface IsolatedVmModule {
  readonly Isolate: typeof Isolate;
  readonly ExternalCopy: typeof ExternalCopy;
}
/**
 * Lazy loader for the optional native addon. Default `() => import('isolated-vm')`.
 * Returns `unknown` because the CJS module's ESM namespace exposes only `default`
 * at runtime (named exports are type-only) — {@link normalizeIvm} reconciles both shapes.
 */
type IsolatedVmLoader = () => Promise<unknown>;

/** Reconcile the CJS-default vs named-namespace shapes of the loaded addon. */
function normalizeIvm(mod: unknown): IsolatedVmModule {
  const withDefault = mod as { default?: IsolatedVmModule };
  return withDefault.default ?? (mod as IsolatedVmModule);
}

export interface SandboxedSkillExecutorDeps {
  readonly tracer?: Tracer;
  /** Test/extension seam for the lazy addon load; default `() => import('isolated-vm')`. */
  readonly loadIsolatedVm?: IsolatedVmLoader;
}

const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_MEMORY_LIMIT_MB = 16;
const MIN_MEMORY_LIMIT_MB = 8;
const DEFAULT_MAX_OUTPUT_BYTES = 65536;

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const NAMED_FUNCTION_RE = /function\s+([A-Za-z_$][\w$]*)/;
const ASYNC_FUNCTION_RE = /async\s+function/;
// DEC-2 source pre-scan (defense-in-depth + audit; the isolate is the primary boundary).
const FS_TOKEN_RE = /\brequire\b|\bimport\s*\(|\bfs\b/;
const NODE_BINDING_TOKEN_RE = /\bprocess\b|\bchild_process\b|\bmodule\b|\b__dirname\b|\b__filename\b/;

/** Strip a leading `export ` and append the named invocation so the classic-script completion value is the return. */
function wrapInvocation(code: string, argNames: readonly string[], fnName: string): string {
  const withoutExport = code.replace(/^\s*export\s+/m, '');
  return `${withoutExport}\n;${fnName}(${argNames.join(',')});`;
}

/** Serialized UTF-8 byte length of the (already-copied) output (DEC-3 measurement). */
function outputByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  return json === undefined ? 0 : Buffer.byteLength(json, 'utf8');
}

export class SandboxedSkillExecutor implements SkillExecutor {
  readonly #tracer: Tracer | undefined;
  readonly #load: IsolatedVmLoader;

  constructor(deps: SandboxedSkillExecutorDeps = {}) {
    this.#tracer = deps.tracer;
    this.#load = deps.loadIsolatedVm ?? (() => import('isolated-vm'));
  }

  /** Emit the audit event and throw the typed denial. Disposal is handled by the caller's `finally`. */
  #deny(reason: ToolInvocationDeniedReason, detail: string): never {
    emitEvent(this.#tracer, 'tool_invocation_denied', { reason });
    throw new ToolInvocationDeniedError(reason, detail);
  }

  async execute(
    skill: Skill,
    args: Readonly<Record<string, unknown>>,
    opts: SkillExecutionOptions = {},
  ): Promise<SkillExecutionResult> {
    const start = performance.now();

    // --- Pre-isolate guards (cheap denials; NO isolate created → NO dispose). ---
    if (skill.code === null) this.#deny('empty-code', 'skill has no executable code (derived skill)');
    const code: string = skill.code;
    if (skill.codeLanguage === 'typescript') {
      this.#deny('unsupported-language', 'TypeScript skills are not executable in v1; store transpiled JS');
    }
    if (ASYNC_FUNCTION_RE.test(code)) {
      this.#deny('unsupported-async', 'async skills are not supported in v1');
    }
    if (FS_TOKEN_RE.test(code)) this.#deny('fs-access-attempt', 'skill references require/import/fs');
    if (NODE_BINDING_TOKEN_RE.test(code)) {
      this.#deny('node-binding-attempt', 'skill references a Node binding (process/module/...)');
    }
    const fnMatch = NAMED_FUNCTION_RE.exec(code);
    if (fnMatch === null || fnMatch[1] === undefined) {
      this.#deny('unsupported-language', 'skill must declare a named function');
    }
    const fnName: string = fnMatch[1];
    const argNames = Object.keys(args);
    if (argNames.some((k) => !IDENTIFIER_RE.test(k))) {
      this.#deny('non-cloneable-args', 'arg key is not a valid identifier');
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs <= 0) throw new RangeError('timeoutMs must be > 0');
    const memoryLimit = Math.max(MIN_MEMORY_LIMIT_MB, opts.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB);
    const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    // --- Load the optional addon (EC-3 → typed unavailable error, NOT a denial). ---
    let loaded: unknown;
    try {
      loaded = await this.#load();
    } catch (cause) {
      throw new SkillExecutorUnavailableError('isolated-vm', { cause });
    }
    const ivm = normalizeIvm(loaded);

    // --- Post-isolate path (denials here MUST dispose — handled by finally). ---
    let isolate: Isolate | undefined;
    try {
      isolate = new ivm.Isolate({ memoryLimit });
      const context = isolate.createContextSync();
      for (const [key, value] of Object.entries(args)) {
        // Only structured-cloneable primitives go in directly; objects/functions/
        // symbols route through ExternalCopy, which THROWS on non-cloneable values
        // (functions/symbols/circular) → mapped to the typed denial (DEC-4).
        const isCopyablePrimitive =
          value === null || ['string', 'number', 'boolean', 'bigint', 'undefined'].includes(typeof value);
        try {
          if (isCopyablePrimitive) {
            context.global.setSync(key, value);
          } else {
            context.global.setSync(key, new ivm.ExternalCopy(value).copyInto());
          }
        } catch {
          this.#deny('non-cloneable-args', `arg '${key}' is not structured-cloneable`);
        }
      }

      const script = isolate.compileScriptSync(wrapInvocation(code, argNames, fnName));
      let raw: unknown;
      try {
        raw = script.runSync(context, { timeout: timeoutMs, copy: true });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (/timed out/i.test(message)) this.#deny('timeout', `execution exceeded ${timeoutMs}ms`);
        if (/clone|copy|transfer/i.test(message)) {
          this.#deny('non-cloneable-result', 'skill return value is not structured-cloneable');
        }
        throw cause instanceof Error ? cause : new Error(message);
      }

      const bytes = outputByteLength(raw);
      if (bytes > maxOutputBytes) this.#deny('output-cap', `output ${bytes} bytes exceeds cap ${maxOutputBytes}`);
      emitEvent(this.#tracer, 'skill_executed', { skill_id: skill.id });
      return { output: raw, truncated: false, elapsedMs: performance.now() - start };
    } finally {
      isolate?.dispose();
    }
  }
}
