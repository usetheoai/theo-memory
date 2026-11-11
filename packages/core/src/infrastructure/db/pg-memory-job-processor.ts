import { trace, type Tracer } from '@opentelemetry/api';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { MemoryJobProcessor } from '../../application/memory-job-worker.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';
import type { MemoryEntityStore, UpsertAndLinkParams } from '../../domain/dip/memory-entity-store.js';
import type { MemoryGraphStore, UpsertEdgesParams } from '../../domain/dip/memory-graph-store.js';
import type { InsertOutcome, VectorStore, VectorStoreResult } from '../../domain/dip/vector-store.js';
import { InvalidScope } from '../../domain/errors.js';
import { DEFAULT_CONTEXT_MESSAGE_COUNT, runExtractionWithContext } from '../../domain/extraction/pipeline.js';
import { memoryJobScope } from '../../domain/memory-job.js';
import type { Filters } from '../../domain/scope.js';

import { InMemoryVectorStore } from './in-memory-store.js';
import { PgMemoryEntityStore } from './pg-memory-entity-store.js';
import { PgMemoryGraphStore } from './pg-memory-graph-store.js';
import type { ClaimedMemoryJob, PgMemoryJobStore } from './pg-memory-job-store.js';
import { PgMessageLog } from './pg-message-log.js';
import { PgvectorStore } from './pgvector-store.js';
import { deriveScopeKey } from './recall-cache/scope-key.js';
import { filtersFromScope } from './scope-filters.js';
import { transactionPool } from './transaction-pool.js';
import { withWorkspaceScope } from './workspace-scope.js';

const payloadSchema=z.record(z.union([z.string(),z.number().finite(),z.boolean(),z.null()]));
const vectorSchema=z.array(z.number().finite()).min(1).max(1536);
const entitySchema=z.object({type:z.string(),name:z.string(),normalizedKey:z.string(),embedding:vectorSchema});
const edgeSchema=z.object({sourceName:z.string(),relation:z.string(),normalizedRelation:z.string(),targetName:z.string(),
  normalizedSourceKey:z.string(),normalizedTargetKey:z.string()});
export const PreparedMemoryBatchSchema=z.object({
  facts:z.array(z.object({memoryId:z.string().uuid(),vector:vectorSchema,payload:payloadSchema})).max(256),
  nodes:z.array(z.object({memoryId:z.string().uuid(),entities:z.array(entitySchema).max(50)})).max(256),
  edges:z.array(z.object({memoryId:z.string().uuid(),edges:z.array(edgeSchema).max(50)})).max(256),
  /** ADR-0029: existing memories a staged fact replaces; applied in the commit transaction. Absent in older drafts. */
  supersessions:z.array(z.object({memoryId:z.string().uuid(),supersededIds:z.array(z.string().uuid()).min(1).max(10)})).max(256).default([]),
  /** ADR-0031: embedding of the logged input message, computed in prepare. Absent in older drafts. */
  messageVector:vectorSchema.optional(),
}).strict();
type PreparedBatch=z.infer<typeof PreparedMemoryBatchSchema>;

class StagingStore extends InMemoryVectorStore {
  readonly facts:PreparedBatch['facts']=[];
  readonly supersessions:PreparedBatch['supersessions']=[];
  constructor(private readonly existing:VectorStore){super();}
  /** The extractor's context comes from the committed memories, never from what this job staged. */
  override search(query:readonly number[],topK?:number,filters?:Filters):Promise<readonly VectorStoreResult[]>{
    return this.existing.search(query,topK,filters);
  }
  /** Record the replacement for apply's transaction; the store decides there what really changes. */
  override supersede(_filters:Filters,memoryIds:readonly string[],by:{readonly memoryId:string;readonly at:Date}):Promise<readonly string[]>{
    this.supersessions.push({memoryId:by.memoryId,supersededIds:[...memoryIds]});
    return Promise.resolve(memoryIds);
  }
  override list(filters?:Filters,topK?:number,includeSoftDeleted?:boolean,offset?:number):Promise<readonly [readonly VectorStoreResult[],number]>{
    return this.existing.list(filters,topK,includeSoftDeleted,offset);
  }
  override async insert(vectors:readonly (readonly number[])[],ids:readonly string[],payloads:readonly Record<string,string|number|boolean|null>[]):Promise<readonly InsertOutcome[]> {
    for(let index=0;index<ids.length;index++)this.facts.push({memoryId:ids[index]!,vector:[...vectors[index]!],payload:{...payloads[index]!}});
    return super.insert(vectors,ids,payloads);
  }
}
function timed<T>(work:Promise<T>):Promise<T> {
  let timer:ReturnType<typeof setTimeout>;
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Memory provider call exceeded 90 seconds.')),90_000);});
  return Promise.race([work,deadline]).finally(()=>clearTimeout(timer));
}

/** Stage provider work durably; apply facts, evidence, graph, history and receipt in one transaction. */
export class PgMemoryJobProcessor implements MemoryJobProcessor {
  constructor(private readonly jobs:PgMemoryJobStore,private readonly pool:Pool,
    private readonly config:{readonly llm:LLM;readonly embedder:Embedder;readonly embeddingDim:number;readonly entityBoost?:boolean;
      /** ADR-0027 raw message log, on by default; `false` neither logs nor gives preceding turns. */
      readonly messageLog?:false;readonly contextMessageCount?:number}){}

  async prepare(job:ClaimedMemoryJob):Promise<PreparedBatch> {
    return withWorkspaceScope(job.workspaceId,async()=>{
      const staging=new StagingStore(new PgvectorStore(this.pool,{embeddingDim:this.config.embeddingDim}));
      const graphFailures:string[]=[];
      const noop=trace.getTracer('@usetheo/memory/jobs');
      const startActive = noop.startActiveSpan.bind(noop);
      const capture=(...args:unknown[]):unknown=>{
        const event=args[0];
        if(event==='entity_linking_failed'||event==='entity_edge_linking_failed')graphFailures.push(event);
        return Reflect.apply(startActive,undefined,args) as unknown;
      };
      const tracer:Tracer={startSpan:noop.startSpan.bind(noop),startActiveSpan:capture};
      const nodeCalls:UpsertAndLinkParams[]=[],edgeCalls:UpsertEdgesParams[]=[];
      const unsupported=()=>{throw new Error('The staging graph supports write capture only.');};
      const entityStore:MemoryEntityStore={upsertAndLink:call=>{nodeCalls.push(call);return Promise.resolve();},
        list:unsupported,supersedeEntity:unsupported,forgetEntity:unsupported,linkedKeysForMemories:unsupported};
      const graphStore:MemoryGraphStore={upsertEdges:call=>{edgeCalls.push(call);return Promise.resolve();},invalidateEdgesByMemory:unsupported,listEdges:unsupported};
      const embedder:Embedder={embed:text=>timed(this.config.embedder.embed(text)),embedBatch:texts=>timed(this.config.embedder.embedBatch(texts))};
      const llm:LLM={generateResponse:(...args)=>timed(this.config.llm.generateResponse(...args)),generateChat:messages=>timed(this.config.llm.generateChat(messages))};
      const filters=filtersFromScope(memoryJobScope(job.input),job.workspaceId);
      // ADR-0027: read-only here, because prepare can repeat; logging happens in apply's transaction.
      const previous=this.config.messageLog===false?[]:(await new PgMessageLog(this.pool)
        .recent(filters,this.config.contextMessageCount??DEFAULT_CONTEXT_MESSAGE_COUNT)).map(m=>({role:m.role,content:m.content}));
      await runExtractionWithContext([{role:'user',content:job.input.text}],filters,{
        vectorStore:staging,embedder,llm,tracer,redactErrorDetails:true,
        ...(this.config.entityBoost===false?{}:{memoryEntityStore:entityStore,memoryGraphStore:graphStore,entityExtractor:{extract:()=>[]}}),
      },{strictExtraction:true,
        ...(job.input.attributedTo!==undefined?{attributedTo:job.input.attributedTo}:{}),
        ...(job.input.expiresAt!==undefined?{expiresAt:new Date(job.input.expiresAt)}:{}),
        evidence:{kind:'inferred',sourceId:job.input.sourceId,modality:job.input.modality,
          ...(job.input.originSourceId!==undefined?{originSourceId:job.input.originSourceId}:{})},
      },previous);
      if(graphFailures.length>0)throw new Error('Graph preparation was incomplete.');
      const messageVector=this.config.messageLog===false||staging.facts.length===0?undefined:await embedder.embed(job.input.text);
      return PreparedMemoryBatchSchema.parse({facts:staging.facts,nodes:nodeCalls,edges:edgeCalls,supersessions:staging.supersessions,
        ...(messageVector!==undefined?{messageVector:[...messageVector]}:{})});
    });
  }

  async apply(job:ClaimedMemoryJob,raw:unknown):Promise<void> {
    const draft=PreparedMemoryBatchSchema.parse(raw);
    if(job.input.expiresAt!==undefined&&Date.parse(job.input.expiresAt)<=Date.now())throw new InvalidScope('The observation expired before persistence.');
    await this.jobs.complete(job,async client=>{
      const pool=transactionPool(client);
      const store=new PgvectorStore(pool,{embeddingDim:this.config.embeddingDim});
      const persisted=new Map<string,string>();
      for(const fact of draft.facts){
        const payload={...fact.payload,idempotency_key:`job:${job.jobId}:${fact.memoryId}`};
        const outcomes=await store.insert([fact.vector],[fact.memoryId],[payload]);
        if(outcomes.length!==1)throw new Error('Job memory application was incomplete.');
        const outcome=outcomes[0]!;
        persisted.set(fact.memoryId,outcome.id);
        await client.query(`INSERT INTO history(memory_id,workspace_id,event,prev_text,new_text)
          VALUES($1,$2,'remember',NULL,$3)`,[outcome.id,job.workspaceId,fact.payload['text']]);
      }
      const filters=filtersFromScope(memoryJobScope(job.input),job.workspaceId);
      // ADR-0029: replaced memories become invalid at the transaction's own instant, which is also
      // the new facts' valid-from time, so the two versions neither overlap nor leave a gap.
      if(draft.supersessions.length>0){
        const {rows:[clock]}=await client.query<{now:Date}>('SELECT now() AS now');
        for(const supersession of draft.supersessions){
          const memoryId=persisted.get(supersession.memoryId);
          if(memoryId===undefined)throw new Error('Supersession has no staged source memory.');
          const invalidated=await store.supersede(filters,supersession.supersededIds,{memoryId,at:clock!.now});
          const newText=draft.facts.find(fact=>fact.memoryId===supersession.memoryId)?.payload['text']??null;
          for(const id of invalidated){
            await client.query(`INSERT INTO history(memory_id,workspace_id,event,prev_text,new_text)
              SELECT id,workspace_id,'supersede',text,$2 FROM memories WHERE id=$1`,[id,newText]);
          }
        }
      }
      // ADR-0027: the input joins the log in the same transaction as its facts, so a rollback drops both.
      if(this.config.messageLog!==false&&persisted.size>0){
        const log=new PgMessageLog(pool);
        await log.linkSources(filters,[...new Set(persisted.values())],
          await log.append(filters,[{role:'user',content:job.input.text}],undefined,[draft.messageVector??null]));
      }
      const entities=new PgMemoryEntityStore(pool),graph=new PgMemoryGraphStore(pool);
      for(const node of draft.nodes){
        const memoryId=persisted.get(node.memoryId);if(memoryId===undefined)throw new Error('Graph node has no staged source memory.');
        await entities.upsertAndLink({memoryId,workspaceId:job.workspaceId,filters,entities:node.entities});
      }
      for(const edge of draft.edges){
        const memoryId=persisted.get(edge.memoryId);if(memoryId===undefined)throw new Error('Graph edge has no staged source memory.');
        await graph.upsertEdges({memoryId,workspaceId:job.workspaceId,filters,edges:edge.edges});
      }
      await client.query('DELETE FROM recall_cache WHERE workspace_id=$1 AND scope_key=$2',
        [job.workspaceId,deriveScopeKey(memoryJobScope(job.input),job.workspaceId)]);
      return [...persisted.values()];
    });
  }
}
