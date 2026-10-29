import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { MemoryEvidenceSchema, MemoryJobInputSchema } from '@usetheo/memory/contract';
import { z } from 'zod';

const summary=z.object({jobId:z.string().uuid(),status:z.enum(['queued','running','succeeded','failed']),attempts:z.number().int(),
  createdAt:z.string().datetime(),updatedAt:z.string().datetime(),finishedAt:z.string().datetime().nullable(),
  memoryIds:z.array(z.string().uuid()),errorCode:z.string().nullable()});
const error=z.object({code:z.string(),message:z.string()});
const failure=(description:string)=>({description,content:{'application/json':{schema:error}}});
const result=(status:number)=>({[status]:{description:status===202?'Durably accepted. Acceptance is not completed extraction.':'Current job state.',content:{'application/json':{schema:summary}}},
  404:failure('Job not found or not authorized.'),409:failure('Idempotency conflict or unavailable retry input.'),422:failure('Invalid observation or identifier.')});

/** Optional server capabilities still have a discoverable, versioned wire contract. */
export function registerMemoryJobPaths(registry:OpenAPIRegistry):void {
  registry.registerPath({method:'post',path:'/v1/memory-jobs',operationId:'submitMemoryJob',
    summary:'Accept durable extraction when memory jobs are enabled; requires memory:write.',
    request:{headers:z.object({'Idempotency-Key':z.string().min(1).max(256)}),
      body:{required:true,content:{'application/json':{schema:MemoryJobInputSchema}}}},responses:result(202)});
  registry.registerPath({method:'get',path:'/v1/memory-jobs/{jobId}',operationId:'getMemoryJob',summary:'Read an authorized extraction job; requires memory:read.',
    request:{params:z.object({jobId:z.string().uuid()})},responses:result(200)});
  registry.registerPath({method:'post',path:'/v1/memory-jobs/{jobId}/retry',operationId:'retryMemoryJob',summary:'Retry a failed retained job; requires memory:write.',
    request:{params:z.object({jobId:z.string().uuid()})},responses:result(202)});
  registry.registerPath({method:'get',path:'/v1/scopes/{type}/{id}/memories/{memoryId}/evidence',operationId:'listMemoryEvidence',
    summary:'List source evidence, including expired memories, within the authorized scope.',
    request:{params:z.object({type:z.enum(['user','session','agent']),id:z.string().min(1),memoryId:z.string().uuid()}),
      query:z.object({limit:z.coerce.number().int().min(1).max(100).optional(),offset:z.coerce.number().int().min(0).optional()})},
    responses:{200:{description:'Stable pagination by creation time and evidence ID.',content:{'application/json':{schema:z.object({
      items:z.array(z.object({evidenceId:z.string().uuid(),originSourceId:z.string(),evidence:MemoryEvidenceSchema,createdAt:z.string().datetime()})),nextOffset:z.number().int().optional()})}}},
      404:failure('Memory not found or not authorized.'),422:failure('Invalid pagination or identifier.')}});
}
