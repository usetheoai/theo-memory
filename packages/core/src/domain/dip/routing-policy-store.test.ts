/**
 * M11 T1.1 — `RoutingPolicyStore` fail-closed default + put/get roundtrip + zod validation.
 * Exercised against the in-memory impl (no DB); the pg impl is proven in the integration suite.
 */
import { describe, expect, it } from 'vitest';

import { InvalidRoutingPolicy } from '../errors.js';

import {
  FAILCLOSED_DEFAULT_POLICY,
  InMemoryRoutingPolicyStore,
  parseRoutingPolicy,
} from './routing-policy-store.js';

const WS = 'ws-1';
const USER = 'alice';

describe('RoutingPolicyStore — fail-closed default + roundtrip + validation', () => {
  it('test_absent_policy_resolves_to_failclosed_default', async () => {
    const store = new InMemoryRoutingPolicyStore();
    const policy = await store.get(WS, USER);
    // Conservative: routing OFF, session default — never a value that disables isolation.
    expect(policy).toEqual(FAILCLOSED_DEFAULT_POLICY);
    expect(policy.llmRouting).toBe(false);
    expect(policy.defaultScope).toBe('session');
  });

  it('test_put_then_get_roundtrips_the_policy', async () => {
    const store = new InMemoryRoutingPolicyStore();
    const wanted = { defaultScope: 'global' as const, llmRouting: true, confirmationThreshold: 5 };
    await store.put(WS, USER, wanted);
    await expect(store.get(WS, USER)).resolves.toEqual(wanted);
  });

  it('test_policy_is_isolated_per_workspace_user', async () => {
    const store = new InMemoryRoutingPolicyStore();
    await store.put(WS, USER, { defaultScope: 'global', llmRouting: true, confirmationThreshold: 9 });
    // A different user in the same workspace still gets the fail-closed default (no bleed).
    await expect(store.get(WS, 'bob')).resolves.toEqual(FAILCLOSED_DEFAULT_POLICY);
    // A different workspace, same user id, also isolated.
    await expect(store.get('ws-2', USER)).resolves.toEqual(FAILCLOSED_DEFAULT_POLICY);
  });

  it('test_zod_rejects_invalid_policy', async () => {
    const store = new InMemoryRoutingPolicyStore();
    // Out-of-enum defaultScope → typed InvalidRoutingPolicy (fail-fast, never stored).
    await expect(store.put(WS, USER, { defaultScope: 'bogus', llmRouting: false, confirmationThreshold: 3 })).rejects.toThrow(
      InvalidRoutingPolicy,
    );
    // Non-integer threshold → rejected.
    expect(() => parseRoutingPolicy({ defaultScope: 'session', llmRouting: false, confirmationThreshold: 2.5 })).toThrow(
      InvalidRoutingPolicy,
    );
    // Unknown key → strict schema rejects.
    expect(() =>
      parseRoutingPolicy({ defaultScope: 'session', llmRouting: false, confirmationThreshold: 3, extra: 1 }),
    ).toThrow(InvalidRoutingPolicy);
  });
});
