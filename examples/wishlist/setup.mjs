import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { runMigrations } from '@usetheo/memory';

if (!process.env.THEOMEM_MIGRATE_PG_URI) throw new Error('Set THEOMEM_MIGRATE_PG_URI for the example database.');
const pool = new Pool({ connectionString: process.env.THEOMEM_MIGRATE_PG_URI });
try {
  await runMigrations(pool, { embeddingDim: process.env.THEOMEM_EMBEDDER === 'openai' ? 1536 : 384 });
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  console.log('Memory and wishlist schemas are ready.');
} finally {
  await pool.end();
}
