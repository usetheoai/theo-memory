import { afterEach, expect, test, vi } from 'vitest';

import { MemoryJobInputSchema, MemoryJobLeaseLost } from '../domain/memory-job.js';
import type { ClaimedMemoryJob, MemoryJobLeaseStore } from '../domain/memory-job.js';

import { MemoryJobWorker } from './memory-job-worker.js';

const job:ClaimedMemoryJob={jobId:'job',workspaceId:'default',leaseToken:'lease',attempts:1,drafts:null,
  input:MemoryJobInputSchema.parse({text:'I prefer simple clothes',sourceId:'conversation',scope:{kind:'user',userId:'alice'}})};
function store():MemoryJobLeaseStore {
  return {claim:vi.fn().mockResolvedValue(job),renew:vi.fn().mockResolvedValue(undefined),
    saveDraft:vi.fn().mockResolvedValue(undefined),fail:vi.fn().mockResolvedValue(undefined)};
}
function deferred<T>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
afterEach(()=>vi.useRealTimers());

test('renews a lease during slow preparation and saves the draft before applying',async()=>{
  vi.useFakeTimers();
  const leases=store(),draft=deferred<unknown>();
  const apply=vi.fn(async()=>{});
  const worker=new MemoryJobWorker(leases,{prepare:()=>draft.promise,apply});
  const result=worker.runOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(leases.renew).toHaveBeenCalledTimes(2);
  expect(apply).not.toHaveBeenCalled();
  draft.resolve({facts:[]});
  expect(await result).toBe('succeeded');
  expect(leases.saveDraft).toHaveBeenCalledWith(job,{facts:[]});
  expect(vi.mocked(leases.saveDraft).mock.invocationCallOrder[0]).toBeLessThan(apply.mock.invocationCallOrder[0]!);
});

test('lost renewal prevents saving or applying an obsolete preparation',async()=>{
  vi.useFakeTimers();
  const leases=store(),draft=deferred<unknown>();
  vi.mocked(leases.renew).mockRejectedValue(new MemoryJobLeaseLost());
  const apply=vi.fn(async()=>{});
  const result=new MemoryJobWorker(leases,{prepare:()=>draft.promise,apply}).runOnce();
  await vi.advanceTimersByTimeAsync(30_000);
  draft.resolve({facts:[]});
  expect(await result).toBe('lost');
  expect(leases.saveDraft).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled();
  expect(leases.fail).not.toHaveBeenCalled();
});

test('abort drains both active jobs and stops new claims',async()=>{
  const leases=store(),draft=deferred<unknown>(),controller=new AbortController();
  const started=deferred<void>();let preparations=0;
  const apply=vi.fn(async()=>{});
  const running=new MemoryJobWorker(leases,{prepare:()=>{if(++preparations===2)started.resolve();return draft.promise;},apply}).run(controller.signal);
  await started.promise;
  controller.abort();
  let finished=false;void running.then(()=>{finished=true;});
  await Promise.resolve();expect(finished).toBe(false);
  draft.resolve({facts:[]});await running;
  expect(apply).toHaveBeenCalledTimes(2);expect(leases.claim).toHaveBeenCalledTimes(2);
});
