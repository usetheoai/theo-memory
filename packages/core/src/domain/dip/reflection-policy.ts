/**
 * ReflectionPolicy DIP — strategy for deciding when reflection runs + lifecycle hooks.
 *
 * @see ADR-0005 — reflection trigger: explicit-only in v0.0, policy interface declared.
 * @see ADR-0008 — DIP method counts (ReflectionPolicy: 1 required + 2 optional).
 *
 * v0.0 ships ManualReflectionPolicy as the only built-in implementation
 * (shouldReflect always returns true; caller decided already).
 * v0.4a (roadmap Item 5) adds ThresholdReflectionPolicy + SleepTimeReflectionPolicy
 * behind the same DIP — zero contract change.
 */
import type { ReflectOptions } from '../options.js';
import type { ReflectionResult } from '../reflection-result.js';
import type { Scope } from '../scope.js';

export interface ReflectionTrigger {
  readonly kind: 'manual' | 'threshold' | 'sleep-time';
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ReflectionPolicy {
  /**
   * Discriminator — identifies the policy variant. Used by the runtime auto-fire
   * wiring (LocalScopedMemory.remember() invokes shouldReflect iff kind !== 'manual').
   * v0.4a values: 'manual' | 'threshold' | 'sleep-time'.
   */
  readonly kind: 'manual' | 'threshold' | 'sleep-time';

  /** Called by the runtime to decide whether to start a reflection cycle for the given scope. */
  shouldReflect(scope: Scope, trigger: ReflectionTrigger): Promise<boolean>;

  /** Called by the runtime when reflection is about to run; the policy can mutate options. */
  onReflectionStart?(scope: Scope, options: ReflectOptions): Promise<void>;

  /** Called by the runtime after reflection completes (success or failure). */
  onReflectionEnd?(scope: Scope, result: ReflectionResult | Error): Promise<void>;
}

/**
 * The only built-in policy at v0.0. shouldReflect always returns true —
 * the caller has already decided by invoking reflect() explicitly.
 */
export interface ManualReflectionPolicy extends ReflectionPolicy {
  readonly kind: 'manual';
}
