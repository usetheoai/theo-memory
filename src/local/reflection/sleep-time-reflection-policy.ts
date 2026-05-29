/**
 * SleepTimeReflectionPolicy — fires reflection on a cron schedule.
 *
 * Per plan v0-4a-reflection-pipeline § T3.1 + ADR D7 + ADR D10 (`croner` adopted
 * as runtime dep per blueprint D7) + blueprint Q5 (Letta v4 fire-and-forget
 * pattern from `safe_create_task`).
 *
 * Behavior:
 *  - Constructor validates cronExpression EAGERLY via new Cron(...) inside
 *    try/catch (EC-4 absorption); empty string rejected before croner.
 *  - Cron callback sets a boolean latch (this._tickPending = true).
 *  - shouldReflect returns the latch AND resets it (consume-once semantics).
 *  - start()/stop() are idempotent (EC-11 absorption); track _started.
 *
 * Timezone caveat (EC-15 absorption documented in JSDoc):
 *  - croner v10.x evaluates expressions in the Node process timezone by default.
 *  - For deterministic behavior in containerized deployments, consumers MUST set
 *    `process.env.TZ='UTC'` (or pass a future `timezone` constructor option;
 *    deferred to F-sleeptime-timezone-option followup per YAGNI v0.4a).
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T3.1
 * @see .claude/knowledge-base/discoveries/blueprints/v0-4a-reflection-pipeline-blueprint.md § D7
 */

import { Cron } from 'croner';

import { InvalidCronExpressionError } from '../../core/errors.js';
import type {
  ReflectionPolicy,
  ReflectionTrigger,
} from '../../core/dip/reflection-policy.js';
import type { Scope } from '../../core/scope.js';

export interface SleepTimeReflectionPolicyConfig {
  /**
   * Cron expression (5 or 6 fields per croner v10.x syntax). EC-15: evaluated
   * in `process.env.TZ` by default. Set TZ=UTC in containerized deployments
   * for determinism.
   */
  readonly cronExpression: string;
}

export class SleepTimeReflectionPolicy implements ReflectionPolicy {
  readonly kind = 'sleep-time' as const;

  private readonly cronExpression: string;
  private _tickPending = false;
  private _started = false;
  private _cronJob: Cron | null = null;

  constructor(config: SleepTimeReflectionPolicyConfig) {
    // EC-4: EAGER validation — empty string + croner parse errors caught BEFORE start()
    if (config.cronExpression === '') {
      throw new InvalidCronExpressionError(config.cronExpression);
    }
    try {
      // Validate by constructing a paused Cron; discard the instance.
      const probe = new Cron(config.cronExpression, { paused: true });
      probe.stop();
    } catch (err) {
      throw new InvalidCronExpressionError(config.cronExpression, { cause: err });
    }
    this.cronExpression = config.cronExpression;
  }

  /**
   * Start the cron job. Idempotent (EC-11): calling twice is a no-op on the
   * second invocation; the first registration stays.
   */
  start(): void {
    if (this._started) {
      return;
    }
    this._cronJob = new Cron(this.cronExpression, () => {
      this._tickPending = true;
    });
    this._started = true;
  }

  /**
   * Stop the cron job. Idempotent — calling on a non-started or already-stopped
   * policy is a no-op (no error).
   */
  stop(): void {
    if (this._cronJob !== null) {
      this._cronJob.stop();
      this._cronJob = null;
    }
    this._started = false;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shouldReflect(_scope: Scope, _trigger: ReflectionTrigger): Promise<boolean> {
    if (this._tickPending) {
      this._tickPending = false;
      return true;
    }
    return false;
  }
}
