import { createServer as createHttpServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createWishlistStore } from '../../examples/wishlist/facts.mjs';
import { WORKER_ROLE, WORKER_PASSWORD } from './global-setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createLocalMemory, MemorySession, MemoryJobWorker, PgMemoryJobStore, PgMemoryJobProcessor, PgMemoryGraphStore, PgMemoryEntityStore, PgvectorStore, tenantScopedPool } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';
import { MemoryJobLeaseLost } from '@usetheo/memory/contract';
import { createServer } from '@usetheo/memory-api';

import { transactionPool } from '../../packages/core/src/infrastructure/db/transaction-pool.js';
import { PreparedMemoryBatchSchema } from '../../packages/core/src/infrastructure/db/pg-memory-job-processor.js';
import { withWorkspaceScope } from '../../packages/core/src/infrastructure/db/workspace-scope.js';
import { createIsolatedDb, type IsolatedDb } from './_helpers/isolated-db.js';

const vector=[1,0,0];
const embedder:Embedder={embed:async()=>vector,embedBatch:async texts=>texts.map(()=>vector)};
const input={text:'I prefer dark colors',sourceId:'session-a:turn-1',scope:{kind:'user' as const,userId:'alice'}};
const actor={workspaceId:'default',userId:'alice',role:'member' as const};

describe.skipIf(!process.env['THEOMEM_PG_URI'])('durable extraction jobs on enforced Postgres',()=>{
  let db:IsolatedDb;
  let jobs:PgMemoryJobStore;
  let processor:PgMemoryJobProcessor;
  let worker:MemoryJobWorker;
  const llm:LLM={generateResponse:vi.fn(async()=>({memory:[{id:'1',text:'user prefers dark colors',evidence:{kind:'stated',durability:'durable',sourceQuote:'I prefer dark colors'}}]})),generateChat:vi.fn()};
  beforeAll(async()=>{
    db=await createIsolatedDb({embeddingDim:3});
    await db.setupPool.query(readFileSync(resolve('examples/wishlist/schema.sql'),'utf8'));
    const pool=tenantScopedPool(db.pool);
    jobs=new PgMemoryJobStore(pool,db.crossWorkspacePool('Discover durable extraction jobs across authenticated workspaces.'));
    processor=new PgMemoryJobProcessor(jobs,pool,{llm,embedder,embeddingDim:3,entityBoost:false});
    worker=new MemoryJobWorker(jobs,processor);
  });
  afterAll(async()=>{if(db!==undefined)await db.dropDb();});
  beforeEach(async()=>{await db.setupPool.query('TRUNCATE wishlist_items,memory_jobs,memories CASCADE');vi.mocked(llm.generateResponse).mockClear();});
  const memory=()=>createLocalMemory({vectorStore:new PgvectorStore(tenantScopedPool(db.pool),{embeddingDim:3}),embedder,llm,embeddingDim:3,entityBoost:false});

  test('acknowledges committed enqueue, processes and exposes persisted memory IDs',async()=>{
    const job=await jobs.submit(input,actor,'first');
    expect(job.status).toBe('queued');
    expect(llm.generateResponse).not.toHaveBeenCalled();
    expect(await worker.runOnce()).toBe('succeeded');
    const done=await jobs.get(job.jobId,actor);
    expect(done.status).toBe('succeeded');expect(done.memoryIds).toHaveLength(1);
    const sdk=await memory();
    const item=await withWorkspaceScope('default',()=>sdk.get(done.memoryIds[0]!));
    expect(item?.text).toBe('user prefers dark colors');
    expect(item?.evidence?.sourceId).toBe(input.sourceId);
    const history=await db.setupPool.query('SELECT * FROM history WHERE memory_id=$1',[done.memoryIds[0]]);
    expect(history.rows).toHaveLength(1);
  });

  test('concurrent claims do not assign a job twice and stale workers are fenced',async()=>{
    await jobs.submit(input,actor,'claim');
    const claims=await Promise.all([jobs.claim(),jobs.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first=claims.find(Boolean)!;
    await db.setupPool.query("UPDATE memory_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE job_id=$1",[first.jobId]);
    const next=await jobs.claim();expect(next?.leaseToken).not.toBe(first.leaseToken);
    await expect(jobs.renew(first)).rejects.toBeInstanceOf(MemoryJobLeaseLost);
    await expect(jobs.saveDraft(first,{})).rejects.toBeInstanceOf(MemoryJobLeaseLost);
    const apply=vi.fn(async()=>[]);
    await expect(jobs.complete(first,apply)).rejects.toBeInstanceOf(MemoryJobLeaseLost);
    expect(apply).not.toHaveBeenCalled();
  });

  test('a failure after fact writes rolls back and resumption reuses persisted drafts',async()=>{
    await jobs.submit(input,actor,'resume');
    const job=(await jobs.claim())!;
    const drafts=await withWorkspaceScope(job.workspaceId,()=>processor.prepare(job));
    await jobs.saveDraft(job,drafts);
    const calls=vi.mocked(llm.generateResponse).mock.calls.length;
    const parsed=PreparedMemoryBatchSchema.parse(drafts);
    await expect(jobs.complete(job,async client=>{
      const store=new PgvectorStore(transactionPool(client),{embeddingDim:3});
      const fact=parsed.facts[0]!;
      await store.insert([fact.vector],[fact.memoryId],[fact.payload]);
      throw new Error('Simulated crash before completion');
    })).rejects.toThrow('Simulated crash');
    const before=await db.setupPool.query('SELECT COUNT(*)::int AS count FROM memories');expect(before.rows[0]?.count).toBe(0);
    await db.setupPool.query("UPDATE memory_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE job_id=$1",[job.jobId]);
    expect(await worker.runOnce()).toBe('succeeded');
    expect(vi.mocked(llm.generateResponse).mock.calls.length).toBe(calls);
    const done=await jobs.get(job.jobId,actor);expect(done.memoryIds).toHaveLength(1);
    const assertions=await db.setupPool.query('SELECT confirmation_count,distinct_source_count FROM memories');
    expect(assertions.rows).toEqual([{confirmation_count:1,distinct_source_count:1}]);
  });

  test('transient failures use backoff while validation failures become terminal',async()=>{
    const job=await jobs.submit(input,actor,'retrying');
    vi.mocked(llm.generateResponse).mockRejectedValueOnce(new Error('Provider unavailable'));
    expect(await worker.runOnce()).toBe('retrying');
    const queued=await jobs.get(job.jobId,actor);expect(queued.status).toBe('queued');expect(queued.attempts).toBe(1);
    expect(await worker.runOnce()).toBe('idle');
    await db.setupPool.query('UPDATE memory_jobs SET available_at=NOW() WHERE job_id=$1',[job.jobId]);
    expect(await worker.runOnce()).toBe('succeeded');
  });

  test('REST idempotency conflicts, owner binding and cross-user access follow the credential',async()=>{
    const sdk=await memory();
    const app=createServer({memory:sdk,memoryJobs:jobs,authVerifier:{verify:async()=>true,resolvePrincipal:async()=>({...actor,subject:'alice',scopes:['memory:read','memory:write']})}});
    const request=(path:string,body?:unknown)=>app.fetch(new Request(`http://localhost${path}`,{
      method:body===undefined?'GET':'POST',headers:{authorization:'Bearer test','content-type':'application/json','Idempotency-Key':'http-request'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    }));
    const first=await request('/v1/memory-jobs',{...input,scope:{kind:'user',userId:'bob'}});expect(first.status).toBe(202);
    const created=await first.json() as {jobId:string};
    const second=await request('/v1/memory-jobs',{...input,scope:{kind:'user',userId:'bob'}});
    expect((await second.json() as {jobId:string}).jobId).toBe(created.jobId);
    const conflict=await request('/v1/memory-jobs',{...input,text:'Different content'});expect(conflict.status).toBe(409);
    expect((await request(`/v1/memory-jobs/${created.jobId}`)).status).toBe(200);
    await expect(jobs.get(created.jobId,{...actor,userId:'bob'})).rejects.toThrow('Memory not found');
    expect(await worker.runOnce()).toBe('succeeded');
    const row=await db.setupPool.query('SELECT user_id FROM memories');expect(row.rows).toEqual([{user_id:'alice'}]);
  });

  test.each(['after-draft','after-write'] as const)('recovers after SIGKILL %s without re-extraction or duplicate writes',async phase=>{
    await jobs.submit(input,actor,`crash-${phase}`);
    const workerUri=new URL(db.uri);workerUri.username=WORKER_ROLE;workerUri.password=WORKER_PASSWORD;
    const childScript=`
      import {Pool} from 'pg';
      import {pathToFileURL} from 'node:url';
      import {resolve} from 'node:path';
      const sdk=await import(pathToFileURL(resolve('packages/core/dist/index.js')).href);
      const {transactionPool}=await import(pathToFileURL(resolve('packages/core/dist/infrastructure/db/transaction-pool.js')).href);
      const pool=sdk.tenantScopedPool(new Pool({connectionString:process.env.THEOMEM_TEST_APP_URI}));
      const discovery=new Pool({connectionString:process.env.THEOMEM_TEST_WORKER_URI});
      const jobs=new sdk.PgMemoryJobStore(pool,discovery);
      const processor=new sdk.PgMemoryJobProcessor(jobs,pool,{embeddingDim:3,entityBoost:false,
        embedder:{embed:async()=>[1,0,0],embedBatch:async texts=>texts.map(()=>[1,0,0])},
        llm:{generateResponse:async()=>({memory:[{id:'1',text:'user prefers dark colors',evidence:{kind:'stated',durability:'durable',sourceQuote:'I prefer dark colors'}}]}),generateChat:async()=>({role:'assistant',content:''})}});
      const job=await jobs.claim();if(!job)throw new Error('No crash-test job');
      const draft=await processor.prepare(job);await jobs.saveDraft(job,draft);
      const hang=()=>new Promise(()=>{setInterval(()=>{},1000);process.stdout.write('CRASH_READY\\n');});
      if(process.env.THEOMEM_TEST_CRASH_PHASE==='after-draft')await hang();
      else await jobs.complete(job,async client=>{
        const fact=draft.facts[0];
        await new sdk.PgvectorStore(transactionPool(client),{embeddingDim:3}).insert([fact.vector],[fact.memoryId],[fact.payload]);
        await hang();return [];
      });
    `;
    const child=spawn(process.execPath,['--input-type=module','-e',childScript],{cwd:process.cwd(),env:{...process.env,
      THEOMEM_TEST_APP_URI:db.uri,THEOMEM_TEST_WORKER_URI:workerUri.toString(),THEOMEM_TEST_CRASH_PHASE:phase},stdio:['ignore','pipe','pipe']});
    let output='';
    try {
      await new Promise<void>((resolveReady,reject)=>{
        const timer=setTimeout(()=>reject(new Error(`Crash child did not reach checkpoint: ${output}`)),20_000);
        child.stdout.on('data',(data:Buffer)=>{output+=data.toString();if(output.includes('CRASH_READY')){clearTimeout(timer);resolveReady();}});
        child.stderr.on('data',(data:Buffer)=>{output+=data.toString();});
        child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Crash child exited ${code}: ${output}`));});
      });
      const exited=once(child,'exit');child.kill('SIGKILL');await exited;
      expect((await db.setupPool.query('SELECT COUNT(*)::int AS count FROM memories')).rows[0]?.count).toBe(0);
      await db.setupPool.query("UPDATE memory_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE status='running'");
      expect(await worker.runOnce()).toBe('succeeded');
      expect(llm.generateResponse).not.toHaveBeenCalled();
      const persisted=await db.setupPool.query('SELECT confirmation_count,distinct_source_count FROM memories');
      expect(persisted.rows).toEqual([{confirmation_count:1,distinct_source_count:1}]);
      expect((await db.setupPool.query('SELECT COUNT(*)::int AS count FROM history')).rows[0]?.count).toBe(1);
    } finally {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
  });

  test('the compiled worker command boots with contained roles and drains an idle queue',async()=>{
    const workerUri=new URL(db.uri);workerUri.username=WORKER_ROLE;workerUri.password=WORKER_PASSWORD;
    const result=await promisify(execFile)(process.execPath,[resolve('dist/agent-tools/cli.js'),'worker','--once'],{
      env:{...process.env,THEOMEM_PG_URI:db.uri,THEOMEM_WORKER_PG_URI:workerUri.toString(),THEOMEM_EMBEDDER:'local'},timeout:30_000,
    });
    expect(result.stdout).toContain('"result":"idle"');
  });

  test.each([{args:[] as string[]},{args:['--once']}])('the compiled CLI drains an active extraction on SIGTERM with args $args', async ({args}) => {
    const isolated = await createIsolatedDb();
    let releaseChat!:()=>void;
    let signalChat!:()=>void;
    const chatStarted = new Promise<void>(resolve=>{signalChat=resolve;});
    const server = createHttpServer((request,response)=>{
      let raw='';
      request.on('data',(data:Buffer)=>{raw+=data.toString();});
      request.on('end',()=>{
        response.setHeader('content-type','application/json');
        if(request.url?.endsWith('/embeddings')) {
          const body=JSON.parse(raw) as {input:string|string[];encoding_format?:string};
          const values=[1,...Array<number>(1535).fill(0)];
          const embedding=body.encoding_format==='base64'?Buffer.from(new Float32Array(values).buffer).toString('base64'):values;
          const count=Array.isArray(body.input)?body.input.length:1;
          response.end(JSON.stringify({object:'list',data:Array.from({length:count},(_,index)=>({object:'embedding',index,
            embedding})),model:'integration',usage:{prompt_tokens:1,total_tokens:1}}));
        } else {
          const send=()=>response.end(JSON.stringify({id:'chat-integration',object:'chat.completion',created:1,model:'integration',
            choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({memory:[{id:'1',text:'user prefers dark colors',
              evidence:{kind:'stated',durability:'durable',sourceQuote:'I prefer dark colors'}}]})}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
          if(releaseChat===undefined){releaseChat=send;signalChat();}else send();
        }
      });
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(address===null||typeof address==='string')throw new Error('Missing test provider address');
    const workerUri=new URL(isolated.uri);workerUri.username=WORKER_ROLE;workerUri.password=WORKER_PASSWORD;
    const queue=new PgMemoryJobStore(tenantScopedPool(isolated.pool));
    const submitted=await queue.submit(input,actor,'sigterm-drain');
    const child=spawn(process.execPath,[resolve('dist/agent-tools/cli.js'),'worker',...args],{env:{...process.env,
      THEOMEM_PG_URI:isolated.uri,THEOMEM_WORKER_PG_URI:workerUri.toString(),THEOMEM_EMBEDDER:'openai',
      OPENAI_API_KEY:'local-test-provider',OPENAI_BASE_URL:`http://127.0.0.1:${address.port}/v1`,OPENAI_CHAT_MODEL:'integration'},
      stdio:['ignore','pipe','pipe']});
    let diagnostics='';child.stdout.on('data',(chunk:Buffer)=>{diagnostics+=chunk.toString();});
    child.stderr.on('data',(chunk:Buffer)=>{diagnostics+=chunk.toString();});
    const exited=once(child,'exit');
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try {
      await Promise.race([chatStarted,exited.then(()=>{throw new Error(`Worker exited early: ${diagnostics}`);}),
        new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error(`Worker did not reach provider: ${diagnostics}`)),20_000);})]);
      if(timeout!==undefined)clearTimeout(timeout);
      child.kill('SIGTERM');
      await new Promise(resolve=>setTimeout(resolve,100));
      expect(child.exitCode).toBeNull();expect(child.signalCode).toBeNull();
      releaseChat();
      const [code,signal]=await Promise.race([exited,new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error(`Worker did not drain: ${diagnostics}`)),20_000);})]);
      expect({code,signal,diagnostics}).toMatchObject({code:0,signal:null});
      expect({status:(await queue.get(submitted.jobId,actor)).status,diagnostics}).toMatchObject({status:'succeeded'});
    } finally {
      if(timeout!==undefined)clearTimeout(timeout);
      if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
      server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
      await isolated.dropDb();
    }
  });

  test('the wishlist example survives process exit and a new session loads exact and semantic context',async()=>{
    const command=await promisify(execFile)(process.execPath,[resolve('examples/wishlist/run.mjs'),'enqueue'],{
      env:{...process.env,THEOMEM_PG_URI:db.uri},timeout:30_000,
    });
    expect(command.stdout).toContain('Durably accepted');
    const facts=createWishlistStore(tenantScopedPool(db.pool),actor);
    expect(await facts.lookup({itemId:'blue-jacket'})).toEqual([{recordId:'blue-jacket',description:'Blue jacket'}]);
    vi.mocked(llm.generateResponse).mockResolvedValueOnce({memory:[{id:'1',text:'user usually prefers dark colors',
      evidence:{kind:'stated',durability:'durable',sourceQuote:'I usually prefer dark colors.'}}]});
    expect(await worker.runOnce()).toBe('succeeded');
    const sdk=await memory();
    const session=new MemorySession({memory:sdk.withWorkspace!('default').user('alice'),facts});
    const context=await withWorkspaceScope('default',()=>session.loadContext({itemId:'blue-jacket'},'dinner style',{threshold:0}));
    expect(context.facts).toEqual([{recordId:'blue-jacket',description:'Blue jacket'}]);
    expect(context.memories).toHaveLength(1);
    expect(context.memories[0]?.evidence?.sourceId).toBe('wishlist-demo:turn-1');
    expect(await session.lookupFacts({itemId:'missing-jacket'})).toEqual([]);
    expect(await createWishlistStore(tenantScopedPool(db.pool),{...actor,userId:'bob'}).lookup({itemId:'blue-jacket'})).toEqual([]);
    await session.close();
  });

  test('durable workers cross tenants only through their named policy and request reads stay isolated', async () => {
    await db.setupPool.query("INSERT INTO workspaces(id,name) VALUES('job-a','Job A'),('job-b','Job B') ON CONFLICT DO NOTHING");
    const actorA = {...actor, workspaceId:'job-a'};
    const actorB = {...actor, workspaceId:'job-b'};
    const a = await jobs.submit(input, actorA, 'same-key');
    const b = await jobs.submit(input, actorB, 'same-key');
    expect(a.jobId).not.toBe(b.jobId);
    await expect(jobs.get(a.jobId, actorB)).rejects.toThrow('Memory not found');
    expect(await Promise.all([worker.runOnce(), worker.runOnce()])).toEqual(['succeeded','succeeded']);
    const sdk = await memory();
    for (const who of [actorA, actorB]) {
      const rows = await withWorkspaceScope(who.workspaceId,()=>sdk.withWorkspace!(who.workspaceId).user('alice').getAll());
      expect(rows).toHaveLength(1);
      const ownJob = await jobs.get(who.workspaceId==='job-a'?a.jobId:b.jobId,who);
      expect(rows[0]?.id).toBe(ownJob.memoryIds[0]);
    }
    expect((await db.pool.query('SELECT * FROM memory_jobs')).rows).toEqual([]);
  });

  test('prepared graph, history, evidence and receipt are applied atomically', async () => {
    const submitted = await jobs.submit(input, actor, 'atomic-graph');
    const job = (await jobs.claim())!;
    const draft = PreparedMemoryBatchSchema.parse(await processor.prepare(job));
    const source = draft.facts[0]!.memoryId;
    const valid = {...draft,
      nodes:[{memoryId:source,entities:[{name:'Alice',normalizedKey:'alice',type:'person',embedding:vector},
        {name:'Dark colors',normalizedKey:'dark colors',type:'preference',embedding:vector}]}],
      edges:[{memoryId:source,edges:[{sourceName:'Alice',targetName:'Dark colors',relation:'prefers',normalizedRelation:'prefers',
        normalizedSourceKey:'alice',normalizedTargetKey:'dark colors'}]}]};
    await expect(processor.apply(job,{...valid,edges:[{...valid.edges[0],memoryId:'00000000-0000-4000-8000-000000000099'}]})).rejects.toThrow('no staged source');
    for (const table of ['memories','memory_evidence','history','entity_edges','memory_entities']) {
      expect((await db.setupPool.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0]?.n).toBe(0);
    }
    expect((await jobs.get(submitted.jobId,actor)).status).toBe('running');
    await jobs.saveDraft(job,valid);
    await processor.apply(job,valid);
    expect((await jobs.get(submitted.jobId,actor)).status).toBe('succeeded');
    expect((await db.setupPool.query('SELECT COUNT(*)::int AS n FROM entity_edges')).rows[0]?.n).toBe(1);
    const graph = new PgMemoryGraphStore(db.poolPinnedTo('default'));
    const entities = new PgMemoryEntityStore(db.poolPinnedTo('default'));
    const graphParams = {workspaceId:'default',filters:{workspace_id:'default',user_id:'alice'}};
    expect(await graph.listEdges(graphParams)).toHaveLength(1);
    await db.setupPool.query("UPDATE memories SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[source]);
    expect(await graph.listEdges(graphParams)).toEqual([]);
    expect(await graph.listEdges({...graphParams,includeSuperseded:true})).toEqual([]);
    expect(await entities.list(graphParams)).toEqual([]);
    await jobs.purgeExpired();
    expect((await db.setupPool.query('SELECT * FROM memories WHERE id=$1',[source])).rows).toEqual([]);
    const erased = await db.setupPool.query('SELECT input,drafts FROM memory_jobs WHERE job_id=$1',[job.jobId]);
    expect(erased.rows).toEqual([{input:null,drafts:null}]);
    expect((await db.setupPool.query('SELECT * FROM memory_evidence')).rows).toEqual([]);
  });

  test('expired observations fail permanently and retained failures can be explicitly retried', async () => {
    const submitted = await jobs.submit({...input,expiresAt:new Date(Date.now()+60_000).toISOString()},actor,'expired');
    await db.setupPool.query("UPDATE memory_jobs SET input=jsonb_set(input,'{expiresAt}',to_jsonb($2::text)) WHERE job_id=$1",[submitted.jobId,new Date(Date.now()-1000).toISOString()]);
    expect(await worker.runOnce()).toBe('failed');
    expect(llm.generateResponse).not.toHaveBeenCalled();
    const terminal = await jobs.get(submitted.jobId,actor);
    expect(terminal.errorCode).toBe('INVALID_INPUT');
    await db.setupPool.query("UPDATE memory_jobs SET input=input-'expiresAt' WHERE job_id=$1",[submitted.jobId]);
    const reset = await jobs.retry(submitted.jobId,actor);
    expect(reset.status).toBe('queued');expect(reset.attempts).toBe(0);
    expect(await worker.runOnce()).toBe('succeeded');
  });

  test('exhaustion stops at five attempts and renewal extends the current lease', async () => {
    const submitted = await jobs.submit(input,actor,'exhaustion');
    for(let attempt=1;attempt<=5;attempt++) {
      const job = (await jobs.claim())!;
      expect(job.attempts).toBe(attempt);
      await db.setupPool.query("UPDATE memory_jobs SET lease_until=NOW()+INTERVAL '20 seconds' WHERE job_id=$1",[job.jobId]);
      await jobs.renew(job);
      const lease = await db.setupPool.query("SELECT lease_until>NOW()+INTERVAL '100 seconds' AS renewed FROM memory_jobs WHERE job_id=$1",[job.jobId]);
      expect(lease.rows[0]?.renewed).toBe(true);
      await jobs.fail(job);
      await db.setupPool.query('UPDATE memory_jobs SET available_at=NOW() WHERE job_id=$1',[job.jobId]);
    }
    expect((await jobs.get(submitted.jobId,actor)).status).toBe('failed');
    expect(await jobs.claim()).toBeNull();
  });

  test('retention purges input after seven days and removes receipts after thirty',async()=>{
    const submitted=await jobs.submit(input,actor,'retention');
    const claimed=(await jobs.claim())!;await jobs.fail(claimed,true);
    await db.setupPool.query("UPDATE memory_jobs SET finished_at=NOW()-INTERVAL '8 days' WHERE job_id=$1",[submitted.jobId]);
    await jobs.prune();
    const retained=await db.setupPool.query('SELECT input,drafts FROM memory_jobs WHERE job_id=$1',[submitted.jobId]);
    expect(retained.rows).toEqual([{input:null,drafts:null}]);
    await expect(jobs.retry(submitted.jobId,actor)).rejects.toThrow('cannot be retried');
    await db.setupPool.query("UPDATE memory_jobs SET finished_at=NOW()-INTERVAL '31 days' WHERE job_id=$1",[submitted.jobId]);
    await jobs.prune();await expect(jobs.get(submitted.jobId,actor)).rejects.toThrow('Memory not found');
  });
});
