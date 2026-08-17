/**
 * The decision the boot guard makes, tested without a database.
 *
 * The measurement needs Postgres; the RULE does not, and the rule is where the
 * mistake would live. Both refusals matter and they are refusals for opposite
 * reasons — one connection sweeps nothing, the other sweeps everything through
 * a privilege no policy audit would show.
 *
 * @see background-pool-reach.ts
 * @see migrations/0029_rls_fail_closed.sql
 */
import { describe, expect, test } from 'vitest';

import { backgroundReachRefusal, type BackgroundReach } from './background-pool-reach.js';

const TABLE = 'recall_traces';

function reach(over: Partial<BackgroundReach>): BackgroundReach {
  return { role: 'themory', bypassRls: false, policy: '', ...over };
}

describe('backgroundReachRefusal', () => {
  test('accepts_worker_role_reaching_through_a_named_policy', () => {
    const sanctioned = reach({
      role: 'themory_worker',
      policy: 'recall_traces_worker_cross_workspace',
    });

    expect(backgroundReachRefusal(sanctioned, TABLE)).toBeUndefined();
  });

  test('refuses_application_role_because_the_sweep_would_delete_zero_rows', () => {
    // The application role holds no cross-workspace policy. Under a fail-closed
    // policy the DELETE matches nothing and COMMITS — success, zero rows, no log.
    const refusal = backgroundReachRefusal(reach({ role: 'themory' }), TABLE);

    expect(refusal).toBeDefined();
    expect(refusal).toContain('ZERO rows');
    // The refusal has to name the fix, or it is just an outage.
    expect(refusal).toContain('THEOMEM_WORKER_PG_URI');
    expect(refusal).toContain('recall_traces_worker_cross_workspace');
  });

  test('refuses_bypassrls_even_though_it_would_technically_work', () => {
    // This connection CAN sweep every workspace — that is precisely the problem.
    // Its reach is not a policy, so it is absent from pg_policies and cannot be
    // revoked per table. Accepting it swaps a silent no-op for a silent bypass.
    const refusal = backgroundReachRefusal(
      reach({ role: 'postgres', bypassRls: true, policy: '' }),
      TABLE,
    );

    expect(refusal).toBeDefined();
    expect(refusal).toContain('BYPASSRLS');
  });

  test('refuses_bypassrls_before_the_policy_check_when_both_are_present', () => {
    // A superuser that also matches a policy is still refused for the privilege:
    // the policy is not what is granting the reach, so revoking it would change
    // nothing. Reporting the policy here would be a comforting lie.
    const refusal = backgroundReachRefusal(
      reach({ role: 'postgres', bypassRls: true, policy: 'recall_traces_worker_cross_workspace' }),
      TABLE,
    );

    expect(refusal).toContain('BYPASSRLS');
  });
});
