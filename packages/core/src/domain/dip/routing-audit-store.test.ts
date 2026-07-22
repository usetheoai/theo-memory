/**
 * M11 T2.1 — `RoutingAuditStore` records who/what/why + reads are `(workspace, user)`-scoped.
 * Exercised against the in-memory impl; the pg impl is proven in the integration suite.
 */
import { describe, expect, it } from 'vitest';

import {
  InMemoryRoutingAuditStore,
  recordRoutingDecision,
  type RoutingAuditRecord,
  type RoutingAuditStore,
} from './routing-audit-store.js';

const rec = (over: Partial<RoutingAuditRecord>): RoutingAuditRecord => ({
  workspaceId: 'ws-1',
  userId: 'alice',
  chosenScope: 'session',
  attribution: 'agent',
  decidedBy: 'agent-1',
  why: 'agent-explicit',
  at: new Date('2026-07-22T00:00:00Z'),
  ...over,
});

describe('RoutingAuditStore — who/what/why + (workspace,user) scoping', () => {
  it('test_routing_decision_is_recorded_with_who_what_why', async () => {
    const store = new InMemoryRoutingAuditStore();
    await store.record(rec({ chosenScope: 'global', attribution: 'user', decidedBy: 'alice', why: 'policy-default' }));
    const [got] = await store.list('ws-1', 'alice');
    expect(got).toMatchObject({ chosenScope: 'global', attribution: 'user', decidedBy: 'alice', why: 'policy-default' });
  });

  it('test_audit_read_is_workspace_user_scoped', async () => {
    const store = new InMemoryRoutingAuditStore();
    await store.record(rec({ userId: 'alice', why: 'a1' }));
    await store.record(rec({ userId: 'bob', why: 'b1' }));
    await store.record(rec({ workspaceId: 'ws-2', userId: 'alice', why: 'other-ws' }));
    const alice = await store.list('ws-1', 'alice');
    // Only alice@ws-1 — never bob's, never ws-2's.
    expect(alice.map((r) => r.why)).toEqual(['a1']);
  });

  it('test_list_is_newest_first_and_capped', async () => {
    const store = new InMemoryRoutingAuditStore();
    await store.record(rec({ why: 'older', at: new Date('2026-07-20T00:00:00Z') }));
    await store.record(rec({ why: 'newer', at: new Date('2026-07-22T00:00:00Z') }));
    const rows = await store.list('ws-1', 'alice', 1);
    expect(rows.map((r) => r.why)).toEqual(['newer']); // newest first + capped to 1
  });

  it('test_recordRoutingDecision_is_failsoft_when_the_store_throws', async () => {
    // A failed audit write must NOT propagate — the decision already happened (Rule 8 fail-soft).
    const throwing: RoutingAuditStore = {
      record: () => Promise.reject(new Error('db down')),
      list: () => Promise.resolve([]),
    };
    await expect(recordRoutingDecision(throwing, rec({}))).resolves.toBeUndefined();
  });
});
