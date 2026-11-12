import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { expect, test } from 'vitest';
import { runMigrations } from '@usetheo/memory';

const root=process.env['THEOMEM_PG_URI'];
test.skipIf(!root)('fresh and 0034-upgraded databases install lifecycle policies without fabricating legacy provenance',async()=>{
  const adminUri=new URL(root!);adminUri.pathname='/postgres';
  const admin=new pg.Pool({connectionString:adminUri.toString()});
  const folder=await mkdtemp(join(tmpdir(),'themem-lifecycle-migrations-'));
  try {
    const source=resolve('packages/core/src/infrastructure/db/migrations');
    await cp(source,folder,{recursive:true});
    const journal=JSON.parse(await readFile(join(folder,'meta/_journal.json'),'utf8')) as {entries:{idx:number}[]};
    journal.entries=journal.entries.filter(entry=>entry.idx<=34);
    await writeFile(join(folder,'meta/_journal.json'),JSON.stringify(journal));
    for(const upgrade of [false,true]) {
      const database=`themem_lifecycle_${randomUUID().replaceAll('-','')}`;
      await admin.query(`CREATE DATABASE ${database}`);
      const uri=new URL(root!);uri.pathname=`/${database}`;
      const pool=new pg.Pool({connectionString:uri.toString()});
      try {
        if(upgrade) {
          await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
          await migrate(drizzle(pool),{migrationsFolder:folder});
          await pool.query("INSERT INTO memories(text,hash,embedding,payload,user_id,confirmation_count) VALUES('legacy','legacy-lifecycle',$1::vector,'{}','alice',100)",
            [`[${Array(1536).fill(0).join(',')}]`]);
        }
        await runMigrations(pool);
        await runMigrations(pool);
        expect((await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN('memory_jobs','memory_evidence','memory_write_receipts')")).rows)
          .toEqual(Array.from({length:3},()=>({relrowsecurity:true,relforcerowsecurity:true})));
        expect((await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname='memories_hash_scope_unique_idx'")).rows[0]?.indexdef).toContain('WHERE (t_invalid IS NULL)');
        expect((await pool.query("SELECT tgname FROM pg_trigger WHERE tgname='memories_redact_jobs'")).rows).toHaveLength(1);
        expect((await pool.query('SELECT * FROM memory_evidence')).rows).toEqual([]);
        if(upgrade) {
          expect((await pool.query('SELECT confirmation_count,distinct_source_count,expires_at FROM memories')).rows)
            .toEqual([{confirmation_count:100,distinct_source_count:null,expires_at:null}]);
        }
        expect((await pool.query("SELECT policyname FROM pg_policies WHERE tablename='memory_jobs' AND policyname='memory_jobs_worker_cross_workspace'")).rows).toHaveLength(1);
      } finally {await pool.end();await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);}
    }
  } finally {await rm(folder,{recursive:true,force:true});await admin.end();}
},60_000);
