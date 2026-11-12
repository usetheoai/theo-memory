import { MemoryJobWorker, PgMemoryJobProcessor, PgMemoryJobStore, tenantScopedPool, assertRequestPoolIsolated, assertBackgroundPoolCrossWorkspace } from '@usetheo/memory';
import { buildEmbedder, embeddingDimForKind, resolveEmbedderKind } from '@usetheo/memory-agent-core';
import { Pool } from 'pg';

import { resolvePgUri } from './resolve-pg-uri.js';
import { resolveWorkerPgUri } from './resolve-worker-pg-uri.js';

/** Run only against migrated databases; migration credentials never enter the worker. */
export async function runWorker(options:{once?:boolean;concurrency?:number;purgeExpired?:boolean}={}):Promise<void> {
  const requestUri=resolvePgUri()??process.env['THEOMEM_PG_URI'],workerUri=resolveWorkerPgUri()??process.env['THEOMEM_WORKER_PG_URI'];
  if(requestUri===undefined||workerUri===undefined)throw new Error('themory worker requires THEOMEM_PG_URI and THEOMEM_WORKER_PG_URI. Run migrations separately first.');
  const raw=new Pool({connectionString:requestUri}),discovery=new Pool({connectionString:workerUri,max:2});
  const controller=new AbortController();
  const stop=()=>controller.abort();
  let pruneTimer:ReturnType<typeof setInterval>|undefined;
  let pruning:Promise<void>|undefined;
  try {
    await assertRequestPoolIsolated(raw);
    await assertBackgroundPoolCrossWorkspace(discovery,'memory_jobs');
    const pool=tenantScopedPool(raw);
    const jobs=new PgMemoryJobStore(pool,discovery);
    const kind=resolveEmbedderKind();
    const [{OpenAILLM},embedder]=await Promise.all([import('@usetheo/memory/llms/openai'),buildEmbedder(kind)]);
    const processor=new PgMemoryJobProcessor(jobs,pool,{llm:new OpenAILLM(),embedder,embeddingDim:embeddingDimForKind(kind)});
    const worker=new MemoryJobWorker(jobs,processor);
    await jobs.prune();
    if(options.purgeExpired===true)await jobs.purgeExpired();
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
    if(options.once===true){process.stdout.write(JSON.stringify({event:'memory_job_worker',result:await worker.runOnce()})+'\n');return;}
    pruneTimer=setInterval(()=>{
      if(pruning!==undefined)return;
      pruning=jobs.prune().then(async()=>{if(options.purgeExpired===true)await jobs.purgeExpired();}).catch(()=>{process.stderr.write('Memory job retention failed; it will be retried.\n');}).finally(()=>{pruning=undefined;});
    },60_000);
    await worker.run(controller.signal,options.concurrency??2);
  } finally {
    if(pruneTimer!==undefined)clearInterval(pruneTimer);
    process.off('SIGTERM',stop);process.off('SIGINT',stop);
    await pruning;
    await Promise.all([raw.end(),discovery.end()]);
  }
}
