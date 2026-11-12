import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { IdempotencyConflict, InvalidScope, MemoryNotFound } from '../../domain/errors.js';
import { MemoryJobInputSchema, MemoryJobLeaseLost, MemoryJobUnavailable } from '../../domain/memory-job.js';
import type { MemoryJobActor, MemoryJobInput, MemoryJobService, MemoryJobSummary, ClaimedMemoryJob } from '../../domain/memory-job.js';

import { assertBackgroundPoolCrossWorkspace } from './background-pool-reach.js';
import { runInTx } from './pg-tx.js';
import { withWorkspaceScope } from './workspace-scope.js';

interface JobRow {
  job_id:string;workspace_id:string;requester_id:string;request_hash:string;
  input:unknown;drafts:unknown;status:MemoryJobSummary['status'];attempts:number;
  lease_token:string|null;lease_until:Date|null;created_at:Date;updated_at:Date;finished_at:Date|null;
  result_memory_ids:string[];error_code:string|null;
}
export type { ClaimedMemoryJob } from '../../domain/memory-job.js';
function summary(row:JobRow):MemoryJobSummary {
  return {jobId:row.job_id,status:row.status,attempts:row.attempts,createdAt:row.created_at,updatedAt:row.updated_at,
    finishedAt:row.finished_at,memoryIds:row.result_memory_ids,errorCode:row.error_code};
}
function actorKey(actor:MemoryJobActor):string {
  if(!actor.workspaceId.trim() || (actor.role==='member'&&!actor.userId?.trim()))throw new InvalidScope('Memory jobs require an authenticated workspace and user.');
  return actor.userId??'workspace-admin';
}

/** Durable queue with authenticated request access and separately verified discovery access. */
export class PgMemoryJobStore implements MemoryJobService {
  private workerVerified=false;
  constructor(private readonly requestPool:Pool,private readonly workerPool?:Pool){}

  async submit(input:MemoryJobInput,actor:MemoryJobActor,idempotencyKey:string):Promise<MemoryJobSummary> {
    const requester=actorKey(actor);
    if(!idempotencyKey.trim()||idempotencyKey.length>256)throw new InvalidScope('Job idempotency key must contain 1-256 characters.');
    const parsed=MemoryJobInputSchema.parse(input);
    if(actor.role==='member') {
      parsed.scope={...parsed.scope,userId:actor.userId!};
    }
    const hash=createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
    return withWorkspaceScope(actor.workspaceId,()=>runInTx(this.requestPool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([actor.workspaceId,requester,idempotencyKey])]);
      const prior=await client.query<JobRow>('SELECT * FROM memory_jobs WHERE workspace_id=$1 AND requester_id=$2 AND idempotency_key=$3',
        [actor.workspaceId,requester,idempotencyKey]);
      if(prior.rows[0]){
        if(prior.rows[0].request_hash!==hash)throw new IdempotencyConflict();
        return summary(prior.rows[0]);
      }
      if(parsed.expiresAt!==undefined&&Date.parse(parsed.expiresAt)<=Date.now())throw new InvalidScope('Job expiration must be in the future.');
      const inserted=await client.query<JobRow>(`INSERT INTO memory_jobs(workspace_id,requester_id,idempotency_key,request_hash,input)
        VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *`,[actor.workspaceId,requester,idempotencyKey,hash,JSON.stringify(parsed)]);
      return summary(inserted.rows[0]!);
    }));
  }

  async get(jobId:string,actor:MemoryJobActor):Promise<MemoryJobSummary> {
    return summary(await this.authorizedJob(jobId,actor));
  }

  async retry(jobId:string,actor:MemoryJobActor):Promise<MemoryJobSummary> {
    await this.authorizedJob(jobId,actor);
    return withWorkspaceScope(actor.workspaceId,async()=>{
      const result=await this.requestPool.query<JobRow>(`UPDATE memory_jobs SET status='queued',attempts=0,
        available_at=NOW(),lease_token=NULL,lease_until=NULL,error_code=NULL,finished_at=NULL,updated_at=NOW()
        WHERE job_id=$1 AND workspace_id=$2 AND status='failed' AND input IS NOT NULL
        AND ($3::text IS NULL OR requester_id=$3) RETURNING *`,[jobId,actor.workspaceId,actor.role==='member'?actorKey(actor):null]);
      if(!result.rows[0])throw new MemoryJobUnavailable();
      return summary(result.rows[0]);
    });
  }

  private async authorizedJob(jobId:string,actor:MemoryJobActor):Promise<JobRow> {
    actorKey(actor);
    if(!z.string().uuid().safeParse(jobId).success)throw new InvalidScope('Invalid job identifier.');
    return withWorkspaceScope(actor.workspaceId,async()=>{
      const result=await this.requestPool.query<JobRow>(`SELECT * FROM memory_jobs WHERE job_id=$1 AND workspace_id=$2
        AND ($3::text IS NULL OR requester_id=$3)`,[jobId,actor.workspaceId,actor.role==='member'?actorKey(actor):null]);
      if(!result.rows[0])throw new MemoryNotFound(jobId);
      return result.rows[0];
    });
  }

  private async discoveryPool():Promise<Pool> {
    if(this.workerPool===undefined)throw new Error('Worker discovery requires a dedicated worker pool.');
    if(!this.workerVerified){await assertBackgroundPoolCrossWorkspace(this.workerPool,'memory_jobs');this.workerVerified=true;}
    return this.workerPool;
  }

  async claim():Promise<ClaimedMemoryJob|null> {
    const pool=await this.discoveryPool();
    await pool.query(`UPDATE memory_jobs SET status='failed',error_code='ATTEMPTS_EXHAUSTED',finished_at=NOW(),updated_at=NOW(),
      lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<=NOW() AND attempts>=5`);
    const result=await pool.query<JobRow>(`WITH candidate AS (
      SELECT job_id FROM memory_jobs WHERE input IS NOT NULL AND attempts<5
      AND ((status='queued' AND available_at<=NOW()) OR (status='running' AND lease_until<=NOW()))
      ORDER BY available_at,created_at,job_id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE memory_jobs j SET status='running',attempts=attempts+1,lease_token=gen_random_uuid(),
      lease_until=NOW()+INTERVAL '120 seconds',updated_at=NOW(),error_code=NULL
      FROM candidate c WHERE j.job_id=c.job_id RETURNING j.*`);
    const row=result.rows[0];
    return row===undefined?null:{jobId:row.job_id,workspaceId:row.workspace_id,leaseToken:row.lease_token!,
      input:MemoryJobInputSchema.parse(row.input),drafts:row.drafts,attempts:row.attempts};
  }

  async renew(job:ClaimedMemoryJob):Promise<void> {
    await withWorkspaceScope(job.workspaceId,async()=>{
      const result=await this.requestPool.query(`UPDATE memory_jobs SET lease_until=NOW()+INTERVAL '120 seconds',updated_at=NOW()
        WHERE job_id=$1 AND workspace_id=$2 AND lease_token=$3 AND status='running' AND lease_until>NOW()`,[job.jobId,job.workspaceId,job.leaseToken]);
      if(result.rowCount!==1)throw new MemoryJobLeaseLost();
    });
  }

  async saveDraft(job:ClaimedMemoryJob,drafts:unknown):Promise<void> {
    await withWorkspaceScope(job.workspaceId,async()=>{
      const result=await this.requestPool.query(`UPDATE memory_jobs SET drafts=$4::jsonb,updated_at=NOW()
        WHERE job_id=$1 AND workspace_id=$2 AND lease_token=$3 AND status='running' AND lease_until>NOW()`,
        [job.jobId,job.workspaceId,job.leaseToken,JSON.stringify(drafts)]);
      if(result.rowCount!==1)throw new MemoryJobLeaseLost();
    });
  }

  /** The receipt and all application writes commit together; a stale worker cannot finalize. */
  async complete(job:ClaimedMemoryJob,apply:(client:PoolClient)=>Promise<readonly string[]>):Promise<void> {
    await withWorkspaceScope(job.workspaceId,()=>runInTx(this.requestPool,async client=>{
      const owned=await client.query(`SELECT job_id FROM memory_jobs WHERE job_id=$1 AND workspace_id=$2
        AND lease_token=$3 AND status='running' AND lease_until>clock_timestamp() FOR UPDATE`,[job.jobId,job.workspaceId,job.leaseToken]);
      if(owned.rows.length!==1)throw new MemoryJobLeaseLost();
      const memoryIds=await apply(client);
      const done=await client.query(`UPDATE memory_jobs SET status='succeeded',result_memory_ids=$4::jsonb,finished_at=NOW(),
        updated_at=NOW(),lease_token=NULL,lease_until=NULL WHERE job_id=$1 AND workspace_id=$2 AND lease_token=$3
        AND lease_until>clock_timestamp()`,[job.jobId,job.workspaceId,job.leaseToken,JSON.stringify(memoryIds)]);
      if(done.rowCount!==1)throw new MemoryJobLeaseLost();
    }));
  }

  async fail(job:ClaimedMemoryJob,permanent=false):Promise<void> {
    const terminal=permanent||job.attempts>=5;
    const delay=[5,30,120,600][Math.min(job.attempts-1,3)]!;
    await withWorkspaceScope(job.workspaceId,async()=>{
      const result=await this.requestPool.query(`UPDATE memory_jobs SET status=$4,error_code=$5,
        available_at=NOW()+($6::int*INTERVAL '1 second'),lease_token=NULL,lease_until=NULL,updated_at=NOW(),
        finished_at=CASE WHEN $4='failed' THEN NOW() ELSE NULL END
        WHERE job_id=$1 AND workspace_id=$2 AND lease_token=$3 AND status='running' AND lease_until>clock_timestamp()`,
        [job.jobId,job.workspaceId,job.leaseToken,terminal?'failed':'queued',permanent?'INVALID_INPUT':'EXTRACTION_FAILED',delay]);
      if(result.rowCount!==1)throw new MemoryJobLeaseLost();
    });
  }

  /** Optional physical purge; historical snapshots of these rows are then unavailable. */
  async purgeExpired():Promise<void> {
    const pool=await this.discoveryPool();
    await assertBackgroundPoolCrossWorkspace(pool,'memories');
    await pool.query('DELETE FROM memories WHERE expires_at<=NOW()');
  }

  async prune():Promise<void> {
    const pool=await this.discoveryPool();
    await pool.query(`UPDATE memory_jobs SET input=NULL,drafts=NULL WHERE finished_at<NOW()-INTERVAL '7 days' AND status IN('succeeded','failed')`);
    await pool.query(`DELETE FROM memory_jobs WHERE finished_at<NOW()-INTERVAL '30 days' AND status IN('succeeded','failed')`);
    await pool.query(`DELETE FROM memory_write_receipts WHERE created_at<NOW()-INTERVAL '30 days'`);
  }
}
