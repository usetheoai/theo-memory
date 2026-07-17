/**
 * `SkillExecutor` DIP port — the contract for running a stored skill's code-as-skill
 * payload and capturing its result.
 *
 * The default impl (`SandboxedSkillExecutor`, T1.3) runs the skill inside an isolated
 * V8 context with a hardened guard set; an out-of-process impl (cloud sandbox) is a
 * future seam. Per ADR D1 the port lives in the domain layer (pure contract, no I/O,
 * no native addon) so high-level callers depend on the abstraction, not the impl
 * the locked default; per ADR D3 execution is opt-in/gated (a consumer wires an
 * executor explicitly — STORE-only stays the default).
 *
 */
import type { Skill } from '../skill.js';

/** Captured outcome of a successful skill execution. */
export interface SkillExecutionResult {
  /** The skill function's return value, copied out of the sandbox. `unknown` — never `any`. */
  readonly output: unknown;
  /** True when the serialized output exceeded `maxOutputBytes` and was capped. */
  readonly truncated: boolean;
  /** Wall-clock duration of the execution in milliseconds. */
  readonly elapsedMs: number;
}

/**
 * Per-call execution bounds. All optional; the impl applies safe defaults
 * (timeout 1000ms, memoryLimit 16MB clamped to the sandbox's 8MB minimum,
 * output cap 65536 bytes). The values map onto the sandbox guards in T1.3.
 */
export interface SkillExecutionOptions {
  /** Hard wall-clock cap; on overrun the execution is aborted and denied. */
  readonly timeoutMs?: number;
  /** Isolate heap cap in MB (clamped to the sandbox minimum). */
  readonly memoryLimitMb?: number;
  /** Maximum serialized output size in bytes before the cap guard trips. */
  readonly maxOutputBytes?: number;
}

export interface SkillExecutor {
  /**
   * Execute the skill's code with the given args inside a hardened sandbox.
   * Args are injected as structured values (never string-concatenated into source).
   * Throws a typed denial when a guard rejects the execution; throws an
   * unavailable error when the sandbox backend is not installed.
   */
  execute(
    skill: Skill,
    args: Readonly<Record<string, unknown>>,
    opts?: SkillExecutionOptions,
  ): Promise<SkillExecutionResult>;
}
