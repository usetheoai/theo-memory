import type { MemoryEvidenceReader, Principal, Filters } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { actingUserId } from './_body-parsing.js';

const paramsSchema=z.object({kind:z.enum(['user','session','agent']),scopeId:z.string().min(1),memoryId:z.string().uuid(),
  limit:z.coerce.number().int().min(1).max(100).default(20),offset:z.coerce.number().int().min(0).default(0)});

export async function memoryEvidenceHandler(c:Context,store:MemoryEvidenceReader):Promise<Response> {
  const parsed=paramsSchema.safeParse({...c.req.query(),kind:c.req.param('type'),scopeId:c.req.param('id'),memoryId:c.req.param('memoryId')});
  if(!parsed.success)return c.json({code:'INVALID_QUERY',message:'Invalid evidence scope or pagination.'},422);
  const {kind,scopeId,memoryId,limit,offset}=parsed.data;
  const actor=actingUserId(c);
  const principal=c.get('principal') as Principal|undefined;
  const filters:Filters={workspace_id:principal?.workspaceId??'default',
    ...(kind==='user'?{user_id:actor??scopeId,scopeHierarchy:'global' as const}:kind==='session'?{session_id:scopeId}:{agent_id:scopeId}),
    ...(actor!==undefined?{user_id:actor}:{})};
  return c.json(await store.list(memoryId,filters,{limit,offset}));
}
