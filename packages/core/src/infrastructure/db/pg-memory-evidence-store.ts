import type { Pool } from 'pg';

import { InvalidScope, MemoryNotFound } from '../../domain/errors.js';
import { MemoryEvidenceSchema } from '../../domain/memory-evidence.js';
import type { MemoryEvidencePage, MemoryEvidenceReader } from '../../domain/memory-evidence.js';
import type { Filters } from '../../domain/scope.js';

/** Paginated audit evidence; scope checks are applied even when the memory expired. */
export class PgMemoryEvidenceStore implements MemoryEvidenceReader {
  constructor(private readonly pool: Pool) {}

  async list(memoryId: string, filters: Filters, options?: { limit?: number; offset?: number }): Promise<MemoryEvidencePage> {
    const limit=options?.limit??20,offset=options?.offset??0;
    if (!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0) {
      throw new InvalidScope('Evidence pagination requires limit 1-100 and a nonnegative offset.');
    }
    const params: unknown[]=[memoryId,filters.workspace_id??'default'];
    const predicates=['id=$1::uuid','workspace_id=$2'];
    for(const key of ['user_id','session_id','agent_id'] as const) {
      if(filters[key]!==undefined){params.push(filters[key]);predicates.push(`${key}=$${params.length}`);}
    }
    if(filters.scopeHierarchy==='global')predicates.push('session_id IS NULL AND agent_id IS NULL');
    const visible=await this.pool.query(`SELECT id FROM memories WHERE ${predicates.join(' AND ')}`,params);
    if(visible.rows.length===0)throw new MemoryNotFound(memoryId);
    const result=await this.pool.query<{ evidence_id:string;origin_source_id:string;evidence:unknown;created_at:Date }>(
      `SELECT evidence_id,origin_source_id,evidence,created_at FROM memory_evidence
       WHERE memory_id=$1 AND workspace_id=$2 ORDER BY created_at,evidence_id LIMIT $3 OFFSET $4`,
      [memoryId,filters.workspace_id??'default',limit+1,offset]);
    return {items:result.rows.slice(0,limit).map(row=>({evidenceId:row.evidence_id,originSourceId:row.origin_source_id,
      evidence:MemoryEvidenceSchema.parse(row.evidence),createdAt:row.created_at})),
      ...(result.rows.length>limit?{nextOffset:offset+limit}:{})};
  }
}
