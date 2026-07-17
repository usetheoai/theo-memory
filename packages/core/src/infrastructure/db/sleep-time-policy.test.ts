/**
 * T3.1 tests for SleepTimeReflectionPolicy.
 *
 * Real-timer integration tests with retry:3 per plan D9 (vitest jitter absorption).
 *
 */
import { afterEach, describe, expect, test } from 'vitest';

import type { ReflectionTrigger } from './../../domain/dip/reflection-policy.js';
import { InvalidCronExpressionError } from './../../domain/errors.js';
import type { Scope } from './../../domain/scope.js';
import { SleepTimeReflectionPolicy } from './reflection/sleep-time-reflection-policy.js';

const TRIGGER: ReflectionTrigger = { kind: 'sleep-time' };
const SCOPE: Scope = { kind: 'user', userId: 'alice' };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('SleepTimeReflectionPolicy', () => {
  let activePolicies: SleepTimeReflectionPolicy[] = [];

  afterEach(() => {
    for (const p of activePolicies) {
      p.stop();
    }
    activePolicies = [];
  });

  function track(p: SleepTimeReflectionPolicy): SleepTimeReflectionPolicy {
    activePolicies.push(p);
    return p;
  }

  test('kind is "sleep-time"', () => {
    const p = track(new SleepTimeReflectionPolicy({ cronExpression: '* * * * *' }));
    expect(p.kind).toBe('sleep-time');
  });

  test('EC-4: constructor throws InvalidCronExpressionError on empty cronExpression', () => {
    expect(() => new SleepTimeReflectionPolicy({ cronExpression: '' })).toThrow(InvalidCronExpressionError);
  });

  test('EC-4: constructor throws InvalidCronExpressionError on malformed cronExpression', () => {
    expect(() => new SleepTimeReflectionPolicy({ cronExpression: 'not a cron' })).toThrow(InvalidCronExpressionError);
  });

  test('EC-4: InvalidCronExpressionError exposes providedExpression', () => {
    try {
      new SleepTimeReflectionPolicy({ cronExpression: 'bogus' });
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidCronExpressionError);
      const e = err as InvalidCronExpressionError;
      expect(e.providedExpression).toBe('bogus');
    }
  });

  test('shouldReflect returns false before start()', async () => {
    const p = track(new SleepTimeReflectionPolicy({ cronExpression: '* * * * *' }));
    expect(await p.shouldReflect(SCOPE, TRIGGER)).toBe(false);
  });

  test('EC-11: start() is idempotent (second call is no-op)', () => {
    const p = track(new SleepTimeReflectionPolicy({ cronExpression: '* * * * *' }));
    p.start();
    expect(() => p.start()).not.toThrow();
  });

  test('stop() is idempotent', () => {
    const p = track(new SleepTimeReflectionPolicy({ cronExpression: '* * * * *' }));
    p.start();
    p.stop();
    expect(() => p.stop()).not.toThrow();
  });

  test('stop() before start() is no-op', () => {
    const p = track(new SleepTimeReflectionPolicy({ cronExpression: '* * * * *' }));
    expect(() => p.stop()).not.toThrow();
  });

  test(
    'shouldReflect returns true after a cron tick fires (real timer)',
    {
      retry: 3, // plan D9 — jitter absorption
      timeout: 5000,
    },
    async () => {
      // '* * * * * *' = every second (6-field syntax)
      const p = track(new SleepTimeReflectionPolicy({ cronExpression: '* * * * * *' }));
      p.start();
      await sleep(1500);
      expect(await p.shouldReflect(SCOPE, TRIGGER)).toBe(true);
      // latch reset → next call without new tick returns false
      expect(await p.shouldReflect(SCOPE, TRIGGER)).toBe(false);
    },
  );

  test(
    'consecutive ticks re-fire (latch resets correctly)',
    {
      retry: 3,
      timeout: 7000,
    },
    async () => {
      const p = track(new SleepTimeReflectionPolicy({ cronExpression: '* * * * * *' }));
      p.start();
      await sleep(1500);
      expect(await p.shouldReflect(SCOPE, TRIGGER)).toBe(true);
      await sleep(1500);
      expect(await p.shouldReflect(SCOPE, TRIGGER)).toBe(true);
    },
  );

  test(
    'stop() halts future ticks',
    {
      retry: 3,
      timeout: 7000,
    },
    async () => {
      const p = track(new SleepTimeReflectionPolicy({ cronExpression: '* * * * * *' }));
      p.start();
      await sleep(1500);
      // consume any pending tick
      await p.shouldReflect(SCOPE, TRIGGER);
      p.stop();
      await sleep(2000);
      // After stop, no new tick should fire
      expect(await p.shouldReflect(SCOPE, TRIGGER)).toBe(false);
    },
  );
});
