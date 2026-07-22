/**
 * M11 T3.1 — routing-governance handler contract: admin-scoped PUT + (workspace,user) 404 isolation.
 * Handler-level (mock Context) so the role/isolation branches are exercised without an auth harness.
 * Lives under tests/unit so the contract config's `@usetheo/memory/contract` → source alias applies.
 */
import { describe, expect, it } from 'vitest';
import type { Context } from 'hono';

import { InMemoryRoutingAuditStore, InMemoryRoutingPolicyStore } from '@usetheo/memory/contract';
import type { Principal } from '@usetheo/memory/contract';

import {
  getRoutingAuditHandler,
  getRoutingPolicyHandler,
  putRoutingPolicyHandler,
} from '../../packages/api/src/server/handlers/routing-governance.js';

interface Captured {
  status: number;
  body: unknown;
}

function mockCtx(principal: Principal | undefined, userId: string | undefined, body?: unknown): { c: Context; out: Captured } {
  const out: Captured = { status: 0, body: undefined };
  const c = {
    get: (k: string) => (k === 'principal' ? principal : undefined),
    req: {
      param: (name: string) => (name === 'userId' ? userId : undefined),
      json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
    },
    json: (b: unknown, status = 200) => {
      out.status = status;
      out.body = b;
      return new Response(JSON.stringify(b), { status });
    },
    notFound: () => {
      out.status = 404;
      return new Response('not found', { status: 404 });
    },
  } as unknown as Context;
  return { c, out };
}

const admin = (workspaceId: string, userId: string | null): Principal =>
  ({ workspaceId, userId, role: 'admin', scopes: ['memory:read', 'memory:write'] }) as Principal;
const member = (workspaceId: string, userId: string): Principal =>
  ({ workspaceId, userId, role: 'member', scopes: ['memory:read', 'memory:write'] }) as Principal;

describe('routing-governance handlers — admin PUT + (workspace,user) isolation', () => {
  const validPolicy = { defaultScope: 'global', llmRouting: true, confirmationThreshold: 5 };

  it('test_put_policy_requires_admin_scope', async () => {
    const store = new InMemoryRoutingPolicyStore();
    const m = mockCtx(member('ws-1', 'alice'), 'alice', validPolicy);
    await putRoutingPolicyHandler(m.c, store);
    expect(m.out.status).toBe(403);
    const a = mockCtx(admin('ws-1', null), 'alice', validPolicy);
    await putRoutingPolicyHandler(a.c, store);
    expect(a.out.status).toBe(200);
    await expect(store.get('ws-1', 'alice')).resolves.toMatchObject(validPolicy);
  });

  it('test_put_rejects_invalid_policy_400', async () => {
    const store = new InMemoryRoutingPolicyStore();
    const a = mockCtx(admin('ws-1', null), 'alice', { defaultScope: 'bogus', llmRouting: true, confirmationThreshold: 5 });
    await putRoutingPolicyHandler(a.c, store);
    expect(a.out.status).toBe(400);
  });

  it('test_get_policy_is_workspace_user_scoped_404_cross_user', async () => {
    const store = new InMemoryRoutingPolicyStore();
    await store.put('ws-1', 'alice', validPolicy);
    const bob = mockCtx(member('ws-1', 'bob'), 'alice');
    await getRoutingPolicyHandler(bob.c, store);
    expect(bob.out.status).toBe(404);
    const alice = mockCtx(member('ws-1', 'alice'), 'alice');
    await getRoutingPolicyHandler(alice.c, store);
    expect(alice.out.status).toBe(200);
  });

  it('test_get_audit_is_workspace_user_scoped_404_cross_user', async () => {
    const store = new InMemoryRoutingAuditStore();
    await store.record({
      workspaceId: 'ws-1',
      userId: 'alice',
      chosenScope: 'global',
      attribution: 'agent',
      decidedBy: 'agent-1',
      why: 'agent-explicit',
      at: new Date('2026-07-22T00:00:00Z'),
    });
    const bob = mockCtx(member('ws-1', 'bob'), 'alice');
    await getRoutingAuditHandler(bob.c, store);
    expect(bob.out.status).toBe(404);
    const a = mockCtx(admin('ws-1', null), 'alice');
    await getRoutingAuditHandler(a.c, store);
    expect(a.out.status).toBe(200);
    expect((a.out.body as { items: unknown[] }).items).toHaveLength(1);
  });
});
