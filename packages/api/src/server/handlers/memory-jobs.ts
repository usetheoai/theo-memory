import type { MemoryJobActor, MemoryJobService, Principal } from '@usetheo/memory/contract';
import { MemoryJobInputSchema } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { actingUserId, readJsonBody } from './_body-parsing.js';

function actor(c:Context):MemoryJobActor {
  const principal=c.get('principal') as Principal|undefined;
  const userId=actingUserId(c);
  return {workspaceId:principal?.workspaceId??'default',role:principal?.role??'owner',...(userId!==undefined?{userId}:{})};
}
export async function submitMemoryJob(c:Context,service:MemoryJobService):Promise<Response> {
  const body=await readJsonBody(c);if(body instanceof Response)return body;
  const input=MemoryJobInputSchema.safeParse(body);
  const key=z.string().trim().min(1).max(256).safeParse(c.req.header('Idempotency-Key'));
  if(!input.success||!key.success)return c.json({code:'INVALID_JOB',message:'A valid observation and Idempotency-Key header are required.'},422);
  return c.json(await service.submit(input.data,actor(c),key.data),202);
}
export async function getMemoryJob(c:Context,service:MemoryJobService):Promise<Response> {
  return c.json(await service.get(c.req.param('jobId')??'',actor(c)));
}
export async function retryMemoryJob(c:Context,service:MemoryJobService):Promise<Response> {
  return c.json(await service.retry(c.req.param('jobId')??'',actor(c)),202);
}
