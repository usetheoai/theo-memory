import { z } from 'zod';

import type { WorkspaceRole } from './principal.js';
import type { Scope } from './scope.js';

const jobScopeSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('user'),userId:z.string().min(1)}).strict(),
  z.object({kind:z.literal('session'),sessionId:z.string().min(1),userId:z.string().min(1).optional()}).strict(),
  z.object({kind:z.literal('agent'),agentId:z.string().min(1),userId:z.string().min(1).optional()}).strict(),
]);
/** JSON-compatible durable submission. Scope identity is rebound from authentication. */
export const MemoryJobInputSchema=z.object({
  text:z.string().trim().min(1).max(100_000),sourceId:z.string().trim().min(1).max(512),
  originSourceId:z.string().trim().min(1).max(512).optional(),
  modality:z.enum(['text','audio','video']).default('text'),
  attributedTo:z.string().trim().min(1).max(512).optional(),
  expiresAt:z.string().datetime({offset:true}).transform(value=>new Date(value).toISOString()).optional(),scope:jobScopeSchema,
}).strict();
export type MemoryJobInput=z.input<typeof MemoryJobInputSchema>;
export interface MemoryJobActor { readonly workspaceId:string;readonly userId?:string;readonly role:WorkspaceRole }
export interface MemoryJobSummary {
  readonly jobId:string;readonly status:'queued'|'running'|'succeeded'|'failed';readonly attempts:number;
  readonly createdAt:Date;readonly updatedAt:Date;readonly finishedAt:Date|null;
  readonly memoryIds:readonly string[];readonly errorCode:string|null;
}
export interface MemoryJobService {
  submit(input:MemoryJobInput,actor:MemoryJobActor,idempotencyKey:string):Promise<MemoryJobSummary>;
  get(jobId:string,actor:MemoryJobActor):Promise<MemoryJobSummary>;
  retry(jobId:string,actor:MemoryJobActor):Promise<MemoryJobSummary>;
}
export class MemoryJobLeaseLost extends Error {
  override readonly name='MemoryJobLeaseLost';
  constructor(){super('The memory job lease is no longer owned by this worker.');}
}
export class MemoryJobUnavailable extends Error {
  override readonly name='MemoryJobUnavailable';
  constructor(){super('The memory job cannot be retried because its retained input is unavailable or it is not failed.');}
}

/** Remove optional undefined values before entering the exact-optional scope contract. */
export function memoryJobScope(input: z.output<typeof MemoryJobInputSchema>): Scope {
  const scope=input.scope;
  if(scope.kind==='user')return {kind:'user',userId:scope.userId};
  const user=scope.userId===undefined?{}:{userId:scope.userId};
  return scope.kind==='session'?{kind:'session',sessionId:scope.sessionId,...user}:{kind:'agent',agentId:scope.agentId,...user};
}

export interface ClaimedMemoryJob {
  readonly jobId:string;readonly workspaceId:string;readonly leaseToken:string;
  readonly input:z.output<typeof MemoryJobInputSchema>;readonly drafts:unknown;readonly attempts:number;
}
export interface MemoryJobLeaseStore {
  claim():Promise<ClaimedMemoryJob|null>;
  renew(job:ClaimedMemoryJob):Promise<void>;
  saveDraft(job:ClaimedMemoryJob,drafts:unknown):Promise<void>;
  fail(job:ClaimedMemoryJob,permanent?:boolean):Promise<void>;
}
