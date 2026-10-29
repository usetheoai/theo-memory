import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { InsertOutcome } from '../../domain/dip/vector-store.js';
import { IdempotencyConflict } from '../../domain/errors.js';
import { evidenceFromPayload } from '../../domain/memory-evidence.js';

import { runInTx } from './pg-tx.js';

type Payload = Record<string, string | number | boolean | null>;

/** Serialize same-scope fact writes and keep evidence, receipts and counters atomic. */
export async function writeWithEvidence(
  pool: Pool,
  vectors: readonly (readonly number[])[],
  ids: readonly string[],
  payloads: readonly Payload[],
  insert: (client: PoolClient, vector: readonly number[], memoryId: string, payload: Payload) => Promise<readonly InsertOutcome[]>,
): Promise<readonly InsertOutcome[]> {
  return runInTx(pool, async (client) => {
    const scopes = payloads.map((payload) => JSON.stringify([
      payload['workspace_id'] ?? 'default', payload['user_id'] ?? null,
      payload['session_id'] ?? null, payload['agent_id'] ?? null,
    ]));
    // Acquire locks in stable order to avoid deadlocks between multi-fact batches.
    const lockKeys = payloads.map((payload, index) => `${scopes[index]}:${String(payload['idempotency_key'] ?? payload['hash'])}`);
    for (const key of [...new Set(lockKeys)].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    }
    const first=payloads[0];
    if(first!==undefined&&typeof first['idempotency_key']==='string'&&
      payloads.every((payload,index)=>payload['idempotency_key']===first['idempotency_key']&&scopes[index]===scopes[0])) {
      const prior=await client.query<{id:string;confirmation_count:number;request_hash:string}>(
        `SELECT m.id,m.confirmation_count,r.request_hash FROM memory_write_receipts r JOIN memories m ON m.id=r.memory_id
         WHERE r.workspace_id=$1 AND r.scope_key=$2 AND r.request_key=$3 ORDER BY m.created_at,m.id`,
        [first['workspace_id']??'default',scopes[0],first['idempotency_key']]);
      if(prior.rows.length>0){
        if(prior.rows.some(row=>row.request_hash!==String(first['request_hash']??createHash('sha256').update(String(first['text'])).digest('hex'))))throw new IdempotencyConflict();
        return prior.rows.map(row=>({id:row.id,confirmationCount:row.confirmation_count,rejectedAsDuplicate:true,idempotentReplay:true}));
      }
    }
    const outcomes: InsertOutcome[] = [];
    for (let index = 0; index < payloads.length; index++) {
      const payload = payloads[index]!;
      const workspace = String(payload['workspace_id'] ?? 'default');
      const scopeKey = scopes[index]!;
      const requestKey = payload['idempotency_key'];
      const digest = String(payload['request_hash'] ?? createHash('sha256').update(String(payload['text'])).digest('hex'));
      if (typeof requestKey === 'string') {
        const prior = await client.query<{ request_hash: string; id: string; hash: string; confirmation_count: number }>(
          `SELECT r.request_hash,m.id,m.hash,m.confirmation_count FROM memory_write_receipts r
           JOIN memories m ON m.id=r.memory_id WHERE r.workspace_id=$1 AND r.scope_key=$2 AND r.request_key=$3`,
          [workspace, scopeKey, requestKey],
        );
        if (prior.rows.some((row) => row.request_hash !== digest)) throw new IdempotencyConflict();
        const replay = prior.rows.find((row) => row.hash === payload['hash']);
        if (replay !== undefined) {
          outcomes.push({ id: replay.id, confirmationCount: replay.confirmation_count, rejectedAsDuplicate: true });
          continue;
        }
      }
      await client.query(`UPDATE memories SET t_invalid=expires_at WHERE workspace_id=$1 AND hash=$2
        AND COALESCE(user_id,'')=$3 AND COALESCE(session_id,'')=$4 AND COALESCE(agent_id,'')=$5
        AND t_invalid IS NULL AND expires_at<=clock_timestamp()`,
      [workspace, payload['hash'], payload['user_id'] ?? '', payload['session_id'] ?? '', payload['agent_id'] ?? '']);
      const written = await insert(client, vectors[index]!, ids[index]!, payload);
      const outcome = written[0];
      if (outcome === undefined) throw new Error('Memory insert returned no outcome.');
      const evidence = evidenceFromPayload(payload).evidence;
      const origin = evidence?.originSourceId ?? evidence?.sourceId;
      if (origin !== undefined) {
        await client.query(`INSERT INTO memory_evidence(workspace_id,memory_id,origin_source_id,evidence)
          VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`, [workspace, outcome.id, origin, JSON.stringify({ ...evidence, originSourceId: origin })]);
      }
      const projection=await client.query<{distinct_source_count:number;expires_at:Date|null}>(`UPDATE memories SET distinct_source_count=(SELECT COUNT(*) FROM memory_evidence
        WHERE memory_id=$1 AND workspace_id=$2) WHERE id=$1 AND workspace_id=$2 RETURNING distinct_source_count,expires_at`, [outcome.id, workspace]);
      if (typeof requestKey === 'string') {
        await client.query(`INSERT INTO memory_write_receipts(workspace_id,scope_key,request_key,request_hash,memory_id)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [workspace, scopeKey, requestKey, digest, outcome.id]);
      }
      const current=projection.rows[0];
      outcomes.push({...outcome,
        ...(current?.distinct_source_count!==undefined?{distinctSourceCount:current.distinct_source_count}:{}),
        ...(current?.expires_at!==undefined?{expiresAt:current.expires_at}:{})});
    }
    return outcomes;
  });
}
