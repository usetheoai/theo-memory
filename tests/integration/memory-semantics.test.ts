import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { createLocalMemory, MemorySession, PgvectorStore, MAX_EMBEDDING_DIM, PgMemoryEvidenceStore } from '@usetheo/memory';
import type { Embedder, LLM, Memory, MemoryEvidence } from '@usetheo/memory';
import { createServer } from '@usetheo/memory-api';
import { withScope } from '@usetheo/memory-agent-core';

import { rememberHandler } from '../../packages/mcp/src/tools/remember-handler.js';
import { PgvectorRecallCacheStore } from '../../packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.js';
import { tenantScopedPool } from '../../packages/core/src/infrastructure/db/tenant-scoped-pool.js';
import { withWorkspaceScope } from '../../packages/core/src/infrastructure/db/workspace-scope.js';
import { createIsolatedDb, type IsolatedDb } from './_helpers/isolated-db.js';

const vector = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
vector[0] = 1;
const embedder: Embedder = { embed: async () => vector, embedBatch: async (texts) => texts.map(() => vector) };

describe.skipIf(!process.env['THEOMEM_PG_URI'])('memory evidence and session lifecycle on Postgres', () => {
  let db: IsolatedDb;
  let memory: Memory;
  const llm: LLM = {
    generateResponse: vi.fn(async () => ({ memory: [{ id: '1', text: 'user usually prefers dark colors',
      evidence: { kind: 'stated', durability: 'durable', sourceQuote: 'I usually prefer dark colors' },
    }] })),
    generateChat: vi.fn(),
  };

  beforeAll(async () => {
    db = await createIsolatedDb();
    memory = await createLocalMemory({ vectorStore: new PgvectorStore(db.poolPinnedTo('default')),
      embedder, llm, entityBoost: false });
    // A domain record stays in its own application table, not in vector memory.
    await db.setupPool.query(`CREATE TABLE wishlist (
      item_id text PRIMARY KEY, user_id text NOT NULL, item_name text NOT NULL
    )`);
    await db.setupPool.query('GRANT SELECT, INSERT ON wishlist TO themory_app');
  });
  afterAll(async () => { if (db !== undefined) await db.dropDb(); });

  test('saves exact records immediately and carries extracted understanding into a new session', async () => {
    const pool = db.poolPinnedTo('default');
    const facts = {
      lookup: async (itemId: string) => (await pool.query<{ item_id: string; item_name: string }>(
        'SELECT item_id, item_name FROM wishlist WHERE user_id = $1 AND item_id = $2', ['alice', itemId],
      )).rows,
      write: async (item: { itemId: string; name: string }) => (await pool.query<{ item_id: string; item_name: string }>(
        'INSERT INTO wishlist (item_id, user_id, item_name) VALUES ($1, $2, $3) RETURNING item_id, item_name',
        [item.itemId, 'alice', item.name],
      )).rows[0]!,
    };
    const first = new MemorySession({ memory: memory.user('alice'), facts });
    vi.mocked(llm.generateResponse).mockClear();
    expect(await first.writeFact({ itemId: 'blue-jacket', name: 'Blue jacket' })).toEqual({ item_id: 'blue-jacket', item_name: 'Blue jacket' });
    expect(llm.generateResponse).not.toHaveBeenCalled();
    expect(await memory.user('alice').count()).toBe(0);
    first.enqueueUnderstanding({ text: 'I usually prefer dark colors', sourceId: 'session-1:turn-1', modality: 'audio' });
    await first.close();

    const second = new MemorySession({ memory: memory.user('alice'), facts });
    const context = await second.loadContext('blue-jacket', 'dinner style', { threshold: 0 });
    expect(context.facts).toEqual([{ item_id: 'blue-jacket', item_name: 'Blue jacket' }]);
    expect(context.memories).toHaveLength(1);
    expect(context.memories[0]?.evidence).toEqual({ kind: 'stated', sourceQuote: 'I usually prefer dark colors', sourceId: 'session-1:turn-1', modality: 'audio' });
    expect(await second.lookupFacts('missing-jacket')).toEqual([]);
    expect(await memory.user('bob').getAll()).toEqual([]);
    await second.close();
  });

  test('REST single and batch evidence survives dedup and all SDK read projections', async () => {
    const app = createServer({ memory });
    const firstEvidence: MemoryEvidence = { kind: 'observed', sourceId: 'video:frame-12', modality: 'video' };
    const request = (path: string, body: unknown) => app.fetch(new Request(`http://localhost${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    const first = await request('/v1/remember', { userId: 'rest-user', text: 'The invitation specifies formal attire.', infer: false, evidence: firstEvidence });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { items: { id: string; evidence: MemoryEvidence }[] };
    const memoryId = firstBody.items[0]!.id;
    const duplicate = await request('/v1/remember/batch', { items: [{ userId: 'rest-user', text: 'The invitation specifies formal attire.', infer: false,
      evidence: { kind: 'inferred', sourceId: 'another-session' } }] });
    expect(duplicate.status).toBe(201);
    const duplicateBody = await duplicate.json() as { items: { evidence: MemoryEvidence; rejectedAsDuplicate: boolean }[] };
    expect(duplicateBody.items[0]).toMatchObject({ evidence: firstEvidence, rejectedAsDuplicate: true });
    expect((await memory.get(memoryId))?.evidence).toEqual(firstEvidence);
    expect((await memory.user('rest-user').getAll())[0]?.evidence).toEqual(firstEvidence);
    expect((await memory.user('rest-user').recall('formal attire', { threshold: 0 }))[0]?.evidence).toEqual(firstEvidence);
    expect((await memory.user('rest-user').episodes()).items[0]?.evidence).toEqual(firstEvidence);
    const invalid = await request('/v1/remember', { userId: 'rest-user', text: 'Invalid', evidence: { kind: 'verified' } });
    expect(invalid.status).toBe(422);
  });

  test('MCP passes evidence into the same persisted SDK contract', async () => {
    const evidence: MemoryEvidence = { kind: 'stated', sourceId: 'mcp:turn-1' };
    const result = await withScope({ session: { userId: 'mcp-user' } }, () => rememberHandler({
      content: 'The user prefers simple clothes.', infer: false, evidence,
    }, { memoryFactory: () => memory }));
    expect(result.isError).toBe(false);
    expect((await memory.user('mcp-user').getAll())[0]?.evidence).toEqual(evidence);
  });

  test('queued extraction retains each authenticated workspace under enforced RLS', async () => {
    await db.setupPool.query("INSERT INTO workspaces (id, name) VALUES ('evidence-a', 'Evidence A'), ('evidence-b', 'Evidence B')");
    const scopedMemory = await createLocalMemory({ vectorStore: new PgvectorStore(tenantScopedPool(db.pool)),
      embedder, llm, entityBoost: false });
    const facts = { lookup: async () => [], write: async (value: string) => value };
    const aliceA = scopedMemory.withWorkspace!('evidence-a').user('alice');
    const aliceB = scopedMemory.withWorkspace!('evidence-b').user('alice');
    const sessionA = new MemorySession({ memory: aliceA, facts });
    const sessionB = new MemorySession({ memory: aliceB, facts });
    await withWorkspaceScope('evidence-a', async () => {
      sessionA.enqueueUnderstanding({ text: 'I usually prefer dark colors', sourceId: 'a:turn-1' });
    });
    await withWorkspaceScope('evidence-b', async () => {
      sessionB.enqueueUnderstanding({ text: 'I usually prefer dark colors', sourceId: 'b:turn-1' });
    });
    // The requests have ended; queued jobs must carry their own captured context.
    await Promise.all([sessionA.close(), sessionB.close()]);
    const rowsA = await withWorkspaceScope('evidence-a', () => aliceA.getAll());
    const rowsB = await withWorkspaceScope('evidence-b', () => aliceB.getAll());
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0]?.evidence?.sourceId).toBe('a:turn-1');
    expect(rowsB[0]?.evidence?.sourceId).toBe('b:turn-1');
    expect(rowsA[0]?.id).not.toBe(rowsB[0]?.id);
  });

  test('counts identified origins separately and replays a write without another assertion', async () => {
    const scope = memory.user('source-ledger');
    const text = 'The user prefers understated outfits.';
    const first = (await scope.remember(text, { infer: false, idempotencyKey: 'request-a',
      evidence: { kind: 'stated', sourceId: 'original-a' } }))[0]!;
    await scope.remember(text, { infer: false, idempotencyKey: 'request-a',
      evidence: { kind: 'stated', sourceId: 'original-a' } });
    let stored = await memory.get(first.id);
    expect(stored?.metadata['confirmation_count']).toBe(1);
    expect(stored?.distinctSourceCount).toBe(1);
    await scope.remember(text, { infer: false, evidence: { kind: 'inferred', sourceId: 'summary-a', originSourceId: 'original-a' } });
    stored = await memory.get(first.id);
    expect(stored?.distinctSourceCount).toBe(1);
    await scope.remember(text, { infer: false, evidence: { kind: 'stated', sourceId: 'original-b' } });
    stored = await memory.get(first.id);
    expect(stored?.distinctSourceCount).toBe(2);
    const ledger = await db.poolPinnedTo('default').query('SELECT origin_source_id FROM memory_evidence WHERE memory_id=$1', [first.id]);
    expect(ledger.rows).toHaveLength(2);
  });

  test('expiration hides current context and a later occurrence preserves history', async () => {
    const scope = memory.user('expiry-user');
    const text = 'The dinner requires formal clothes.';
    const first = (await scope.remember(text, { infer: false, expiresAt: new Date(Date.now()+60_000) }))[0]!;
    const deadline = new Date(Date.now()-1000);
    await db.setupPool.query('UPDATE memories SET expires_at=$2 WHERE id=$1', [first.id, deadline]);
    expect(await memory.get(first.id)).toBeNull();
    expect(await scope.getAll()).toEqual([]);
    expect(await scope.count()).toBe(0);
    expect(await scope.recall('dinner', { threshold: 0 })).toEqual([]);
    expect((await scope.episodes()).items).toEqual([]);
    const next = (await scope.remember(text, { infer: false }))[0]!;
    expect(next.id).not.toBe(first.id);
    const old = await db.setupPool.query('SELECT t_invalid FROM memories WHERE id=$1', [first.id]);
    expect(old.rows[0]?.t_invalid).toEqual(deadline);
  });

  test('evidence pagination is scoped, complete, and survives expiry until hard erasure', async () => {
    const scope = memory.user('audit-reader');
    const text = 'The user enjoys comfortable shoes.';
    const first = (await scope.remember(text, { infer: false, evidence: {kind: 'stated', sourceId: 'audit-a'} }))[0]!;
    await scope.remember(text, { infer: false, evidence: {kind: 'observed', sourceId: 'audit-b'} });
    const reader = new PgMemoryEvidenceStore(db.poolPinnedTo('default'));
    const filters = { workspace_id: 'default', user_id: 'audit-reader' };
    const page = await reader.list(first.id, filters, {limit: 1});
    expect(page.items).toHaveLength(1);
    expect(page.nextOffset).toBe(1);
    const next = await reader.list(first.id, filters, {limit: 1, offset: page.nextOffset!});
    expect(next.items).toHaveLength(1);
    expect(next.nextOffset).toBeUndefined();
    expect(new Set([...page.items, ...next.items].map(item => item.originSourceId))).toEqual(new Set(['audit-a', 'audit-b']));
    await expect(reader.list(first.id, {...filters, user_id: 'intruder'})).rejects.toThrow('Memory not found');
    await db.setupPool.query("UPDATE memories SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [first.id]);
    expect((await reader.list(first.id, filters)).items).toHaveLength(2);
    const app = createServer({memory, memoryEvidenceStore: reader});
    const response = await app.fetch(new Request(`http://localhost/v1/scopes/user/audit-reader/memories/${first.id}/evidence?limit=1`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({items: [expect.objectContaining({originSourceId: expect.any(String)})], nextOffset: 1});
    await scope.forget(first.id, {hard: true});
    expect((await db.setupPool.query('SELECT * FROM memory_evidence WHERE memory_id=$1', [first.id])).rows).toEqual([]);
  });

  test('historical reads respect expiry and derived memories inherit deadline and original sources', async () => {
    const scope = memory.user('derived-lifecycle');
    const deadline = new Date(Date.now()+120_000);
    const source = (await scope.remember('Temporary dinner context', {infer: false, expiresAt: deadline,
      evidence: {kind: 'observed', sourceId: 'invitation-original'}}))[0]!;
    const store = new PgvectorStore(db.poolPinnedTo('default'));
    const id = await store.insertDerivedMemory({text:'Dinner needs formal clothes', hash:'derived-expiry-test', embedding: vector,
      derivedFrom: [source.id], scope: {userId: 'derived-lifecycle'}});
    const item = await memory.get(id);
    expect(item?.expiresAt).toEqual(deadline);
    expect(item?.distinctSourceCount).toBe(1);
    const ledger = await new PgMemoryEvidenceStore(db.poolPinnedTo('default')).list(id, {workspace_id:'default', user_id:'derived-lifecycle'});
    expect(ledger.items.map(item=>item.originSourceId)).toEqual(['invitation-original']);
    const historical = await store.list({workspace_id:'default',user_id:'derived-lifecycle',asOf:new Date(deadline.getTime()-1000)});
    expect(historical[0].map(item=>item.id)).toContain(id);
    const expired = await store.list({workspace_id:'default',user_id:'derived-lifecycle',asOf:deadline});
    expect(expired[0]).toEqual([]);
    await db.setupPool.query("UPDATE memories SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [source.id]);
    await expect(store.insertDerivedMemory({text:'Invalid derived memory',hash:'invalid-expired-derived',embedding:vector,
      derivedFrom:[source.id],scope:{userId:'derived-lifecycle'}})).rejects.toThrow();
  });

  test('concurrent request replay returns the same fact without new counters or hooks', async () => {
    const scope = memory.user('concurrent-replay');
    const options = {infer:false, idempotencyKey:'simultaneous', evidence:{kind:'stated' as const, sourceId:'one-origin'}};
    const results = await Promise.all([scope.remember('Stable preference', options), scope.remember('Stable preference', options)]);
    expect(results[0]?.[0]?.id).toBe(results[1]?.[0]?.id);
    const row = await memory.get(results[0]![0]!.id);
    expect(row?.confirmationCount).toBe(1);
    expect(row?.distinctSourceCount).toBe(1);
    expect(results.flat().filter(item=>item.idempotentReplay)).toHaveLength(1);
    await expect(scope.remember('Changed preference', options)).rejects.toThrow('Idempotency');
  });

  test('cache lifetime is capped by source expiry instead of its configured ten-minute TTL', async () => {
    const scope = memory.user('expiry-cache');
    const [item] = await scope.remember('Formal dinner tonight', {infer:false,expiresAt:new Date(Date.now()+2000)});
    const cache = new PgvectorRecallCacheStore(db.poolPinnedTo('default'));
    await withWorkspaceScope('default',()=>cache.set(vector,{kind:'user',userId:'expiry-cache'},[{...item!,score:1}],600,'default'));
    expect(await cache.get(vector,{kind:'user',userId:'expiry-cache'},'default')).toBeDefined();
    const stored = await db.setupPool.query("SELECT expires_at-created_at<INTERVAL '3 seconds' AS capped FROM recall_cache WHERE result_set @> $1::jsonb",[JSON.stringify([{id:item!.id}])]);
    expect(stored.rows).toEqual([{capped:true}]);
    await new Promise(resolve=>setTimeout(resolve,2100));
    expect(await cache.get(vector,{kind:'user',userId:'expiry-cache'},'default')).toBeUndefined();
    expect(await scope.recall('dinner',{threshold:0})).toEqual([]);
  });

  test('reflection-derived rows are inferred on later reads, never stated or observed', async () => {
    const store = new PgvectorStore(db.poolPinnedTo('default'));
    const source = (await memory.user('alice').getAll())[0]!;
    const memoryId = await store.insertDerivedMemory({ text: 'user favors understated dinner outfits',
      hash: 'derived-test-style', embedding: vector, derivedFrom: [source.id], scope: { userId: 'alice' },
    });
    expect((await memory.get(memoryId))?.evidence).toEqual({ kind: 'inferred' });
    expect((await memory.user('alice').getAll()).find((item) => item.id === memoryId)?.evidence).toEqual({ kind: 'inferred' });
  });
});
