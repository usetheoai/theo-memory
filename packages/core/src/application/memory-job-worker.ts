import { setTimeout as delay } from 'node:timers/promises';

import { metrics } from '@opentelemetry/api';
import { z } from 'zod';

import { InvalidScope, IdempotencyConflict } from '../domain/errors.js';
import { MemoryJobLeaseLost } from '../domain/memory-job.js';
import type { ClaimedMemoryJob, MemoryJobLeaseStore } from '../domain/memory-job.js';

export interface MemoryJobProcessor {
  prepare(job:ClaimedMemoryJob):Promise<unknown>;
  apply(job:ClaimedMemoryJob,draft:unknown):Promise<void>;
}
export type MemoryJobWorkResult='idle'|'succeeded'|'retrying'|'failed'|'lost';

/** Leases are renewed while provider I/O runs; SQL fencing owns correctness. */
export class MemoryJobWorker {
  constructor(private readonly store:MemoryJobLeaseStore,private readonly processor:MemoryJobProcessor){}

  async runOnce():Promise<MemoryJobWorkResult> {
    const job=await this.store.claim();if(job===null)return 'idle';
    let heartbeat:Promise<void>|undefined;
    let renewalError:unknown;
    const timer=setInterval(()=>{
      if(heartbeat!==undefined)return;
      heartbeat=this.store.renew(job).catch(error=>{renewalError=error;}).finally(()=>{heartbeat=undefined;});
    },30_000);
    timer.unref();
    try {
      if(job.input.expiresAt!==undefined&&Date.parse(job.input.expiresAt)<=Date.now())throw new InvalidScope('The observation expired before processing.');
      let drafts=job.drafts;
      if(drafts===null){
        drafts=await this.processor.prepare(job);
        if(renewalError!==undefined)throw renewalError instanceof Error ? renewalError : new Error('Job lease renewal failed.', { cause: renewalError });
        await this.store.saveDraft(job,drafts);
      }
      clearInterval(timer);await heartbeat;
      if(renewalError!==undefined)throw renewalError instanceof Error ? renewalError : new Error('Job lease renewal failed.', { cause: renewalError });
      await this.processor.apply(job,drafts);
      return 'succeeded';
    } catch(error) {
      if(error instanceof MemoryJobLeaseLost)return 'lost';
      const permanent=error instanceof InvalidScope||error instanceof IdempotencyConflict||error instanceof z.ZodError;
      try {await this.store.fail(job,permanent);}catch(failure){if(failure instanceof MemoryJobLeaseLost)return 'lost';throw failure;}
      return permanent||job.attempts>=5?'failed':'retrying';
    } finally {clearInterval(timer);await heartbeat;}
  }

  /** Abort stops new claims; accepted provider calls and transactions are drained. */
  async run(signal:AbortSignal,concurrency=2):Promise<void> {
    if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>32)throw new RangeError('Worker concurrency must be 1-32.');
    let failed=false;
    const processed=metrics.getMeter('@usetheo/memory').createCounter('memory.jobs.processed');
    const loop=async()=>{
      try {
      while(!signal.aborted&&!failed){
        const result=await this.runOnce();
        if(result!=='idle')processed.add(1,{result});
        if(result==='idle')await delay(1000,undefined,{signal}).catch(error=>{if(!signal.aborted)throw error;});
      }
      } catch(error){failed=true;throw error;}
    };
    const settled=await Promise.allSettled(Array.from({length:concurrency},loop));
    const errors=settled.flatMap(result=>result.status==='rejected'?[result.reason as unknown]:[]);
    if(errors.length>0)throw new AggregateError(errors,'Memory job worker failed after draining active work.');
  }
}
