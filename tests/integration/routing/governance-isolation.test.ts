/**
 * M11 T4.1 — routing governance + isolation HARD GATE on real ankane/pgvector.
 *
 * The `PgRoutingPolicyStore` + `PgRoutingAuditStore` roundtrip a policy / audit for a `(workspace, user)`
 * and NEVER surface another `(workspace, user)`'s rows — the ROADMAP M11 isolation gate (a routing/
 * promotion decision is retrievable for its OWN `(workspace, user)`; another user's read returns nothing,
 * which the REST layer maps to 404, proven at the handler level in tests/unit/routing-governance-handler).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

import {
  PgRoutingPolicyStore,
  PgRoutingAuditStore,
  FAILCLOSED_DEFAULT_POLICY,
  createLocalMemory,
  PgvectorStore,
  StubEmbedder,
  SessionToGlobalConsolidationPolicy,
} from '@usetheo/memory';
import type { LLM, Message, RoutingAuditRecord } from '@usetheo/memory/contract';
import { createServer } from '@usetheo/memory-api';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const emptyLlm: LLM = {
  generateResponse: () => Promise.resolve([]),
  generateChat: (_m: readonly Message[]) => Promise.resolve({ role: 'assistant' as const, content: '[]' }),
};

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M11 routing governance + isolation (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M11 T4.1 — routing policy + audit + (workspace,user) isolation (real pgvector)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let policies: PgRoutingPolicyStore;
    let audit: PgRoutingAuditStore;
    const WS = 'default';
    const USER_A = `alice-${randomUUID()}`;
    const USER_B = `bob-${randomUUID()}`;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.crossWorkspacePool('mede o isolamento da governanca entre workspaces');
      dropDb = iso.dropDb;
      policies = new PgRoutingPolicyStore(pool);
      audit = new PgRoutingAuditStore(pool);
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query('DELETE FROM routing_policies');
      await pool.query('DELETE FROM routing_audit');
    });

    const auditRec = (user: string, why: string): RoutingAuditRecord => ({
      workspaceId: WS,
      userId: user,
      chosenScope: 'global',
      attribution: 'agent',
      decidedBy: 'agent-1',
      why,
      at: new Date(),
    });

    test('test_routing_governance_and_isolation', async () => {
      // Absent policy → fail-closed default (never a value that disables isolation).
      await expect(policies.get(WS, USER_A)).resolves.toEqual(FAILCLOSED_DEFAULT_POLICY);

      // User A sets a policy + records a routing decision.
      const wanted = { defaultScope: 'global' as const, llmRouting: true, confirmationThreshold: 7 };
      await policies.put(WS, USER_A, wanted);
      await audit.record(auditRec(USER_A, 'a-decision'));

      // User B (same workspace) sets its own.
      await policies.put(WS, USER_B, { defaultScope: 'session', llmRouting: false, confirmationThreshold: 2 });
      await audit.record(auditRec(USER_B, 'b-decision'));

      // (1) A reads its OWN policy + audit back.
      await expect(policies.get(WS, USER_A)).resolves.toMatchObject(wanted);
      const aAudit = await audit.list(WS, USER_A);
      expect(aAudit.map((r) => r.why)).toEqual(['a-decision']);

      // (2) ISOLATION: A's audit list contains NONE of B's rows, and vice-versa.
      expect(aAudit.every((r) => r.userId === USER_A)).toBe(true);
      const bAudit = await audit.list(WS, USER_B);
      expect(bAudit.map((r) => r.why)).toEqual(['b-decision']);

      // (3) ISOLATION: A's policy is A's, B's is B's — never bled across the (workspace,user) key.
      await expect(policies.get(WS, USER_B)).resolves.toMatchObject({ defaultScope: 'session', confirmationThreshold: 2 });

      // (4) A user with NO rows in this workspace still gets the fail-closed default + empty audit.
      const USER_C = `carol-${randomUUID()}`;
      await expect(policies.get(WS, USER_C)).resolves.toEqual(FAILCLOSED_DEFAULT_POLICY);
      await expect(audit.list(WS, USER_C)).resolves.toEqual([]);
    });

    test('test_rest_remember_audits_its_routing_decision', async () => {
      // Wiring pillar (b): a real POST /v1/remember records a routing-decision audit row (fail-soft,
      // opt-in). A `userId`-tier write → chosenScope 'global'; retrievable via the audit surface.
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: emptyLlm,
      });
      const app = createServer({ memory, routingAuditStore: audit });
      const user = `dave-${randomUUID()}`;
      const res = await app.fetch(
        new Request('http://localhost/v1/remember', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: user, text: 'dave fact', infer: false }),
        }),
      );
      expect(res.status).toBe(201);
      const rows = await audit.list(WS, user);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ chosenScope: 'global', userId: user });
      await memory.dispose();
    });

    test('test_m9_promotion_is_audited', async () => {
      // F-tests-1: a session→global PROMOTION (M9 reflect) emits a queryable audit row.
      const user = `erin-${randomUUID()}`;
      const session = `s-${randomUUID()}`;
      const embedding = new Array<number>(1536).fill(0);
      embedding[0] = 0.1;
      // Seed a DURABLE session fact (confirmation_count >= 3) — the M9 promotion candidate.
      await pool.query(
        `INSERT INTO memories (text, hash, embedding, payload, workspace_id, user_id, session_id, confirmation_count, kind)
         VALUES ($1,$2,$3::vector,'{}'::jsonb,$4,$5,$6,3,'extracted')`,
        ['erin durable fact', `h-${randomUUID()}`, `[${embedding.join(',')}]`, WS, user, session],
      );
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: emptyLlm,
        reflectionPolicy: { kind: 'manual' },
        routingAuditStore: audit,
      });
      await memory.session(session, user).reflect({ conflictResolution: new SessionToGlobalConsolidationPolicy(3) });
      // The promotion decision is retrievable via the audit surface for (WS, user).
      const rows = await audit.list(WS, user);
      expect(rows.some((r) => r.why === 'promotion-confirmation-threshold' && r.chosenScope === 'global')).toBe(true);
      expect(rows.every((r) => r.userId === user)).toBe(true); // isolation held
      await memory.dispose();
    });

    test('test_rest_routing_policy_roundtrips_through_the_stack', async () => {
      // F-tests-4: the routing-policy routes are MOUNTED + functional end-to-end on real pg (the
      // default owner Principal PUTs + GETs its own policy). The member cross-user 404 branch is
      // proven at the handler level (tests/unit/routing-governance-handler).
      const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder: new StubEmbedder(), llm: emptyLlm });
      const app = createServer({ memory, routingPolicyStore: policies, routingAuditStore: audit });
      const user = `frank-${randomUUID()}`;
      const put = await app.fetch(
        new Request(`http://localhost/v1/routing-policy/${user}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ defaultScope: 'global', llmRouting: true, confirmationThreshold: 4 }),
        }),
      );
      expect(put.status).toBe(200);
      const get = await app.fetch(new Request(`http://localhost/v1/routing-policy/${user}`));
      expect(get.status).toBe(200);
      expect(await get.json()).toMatchObject({ defaultScope: 'global', confirmationThreshold: 4 });
      await memory.dispose();
    });

    test('test_rest_remember_survives_a_failing_audit_store', async () => {
      // F-tests-5: a THROWING routingAuditStore must NOT fail the remember (wired fail-soft, Rule 8).
      const throwingAudit = {
        record: () => Promise.reject(new Error('audit db down')),
        list: () => Promise.resolve([]),
      };
      const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder: new StubEmbedder(), llm: emptyLlm });
      const app = createServer({ memory, routingAuditStore: throwingAudit });
      const res = await app.fetch(
        new Request('http://localhost/v1/remember', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: `gail-${randomUUID()}`, text: 'gail fact', infer: false }),
        }),
      );
      expect(res.status).toBe(201); // remember succeeded despite the audit write failing
      await memory.dispose();
    });
  });
}
