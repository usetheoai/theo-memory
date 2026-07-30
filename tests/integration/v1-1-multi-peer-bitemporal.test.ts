/**
 * THE GOAL TEST for v1.1 Multi-Peer Attribution + Bi-Temporal Local Runtime.
 *
 * Plan Goal verbatim:
 * "Ship `attributed_to` as a first-class promoted column AND lift
 * `BiTemporalNotSupportedLocally` so that `recall({ asOf, attributedTo })`
 * returns the correct point-in-time + peer-attributed memories, measured by
 * an end-to-end integration test (`tests/integration/v1-1-multi-peer-bitemporal.test.ts`)
 * returning 100% PASS against real `ankane/pgvector:v0.5.1`."
 *
 * Wiring triad pillar (b): exercises the full T1.1 → T2.1 → T2.2 → T3.1 chain
 * end-to-end against a live pgvector container. Skipped when
 * `THEOMEM_PG_URI` is unset so CI environments without docker pass.
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { DeterministicStubLLM } from '@usetheo/memory/llms/stub';
import type { Embedder } from '@usetheo/memory';

/**
 * Test embedder returning a CONSTANT unit vector regardless of input. This makes
 * cosine distance ZERO between any two inputs (vector identity), score = 1, so
 * all rows trivially pass the threshold filter — semantic relevance is NOT what
 * this goal test is measuring. The goal test exercises the multi-peer +
 * bi-temporal MECHANICS at the SQL layer; semantic-match plumbing is covered
 * by the existing 670+ contract suite.
 */
const CONSTANT_UNIT_VEC: readonly number[] = (() => {
 const v = new Array<number>(1536).fill(0);
 v[0] = 1; // unit vector along axis 0
 return v;
})();
const ConstantEmbedder: Embedder = {
 embed: async () => CONSTANT_UNIT_VEC,
 embedBatch: async (texts: readonly string[]) => texts.map(() => CONSTANT_UNIT_VEC),
};

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

const ALICE = 'v1-1-goal-test-alice';
const BOB = 'v1-1-goal-test-bob';

async function resetTestRows(pool: pg.Pool): Promise<void> {
 await pool.query(`DELETE FROM memories WHERE user_id = ANY($1::text[])`, [[ALICE, BOB]]);
}

describe.skipIf(PG_URI === '')(
 'v1.1 THE GOAL TEST — multi-peer attribution + bi-temporal asOf against real ankane/pgvector:v0.5.1',
 () => {
 let pool: pg.Pool;
 let memory: Awaited<ReturnType<typeof createLocalMemory>>;

 beforeAll(async () => {
 pool = new pg.Pool({ connectionString: PG_URI });
 await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
 await runMigrations(pool);
 // Defensive self-sufficiency: orphan-schema DBs (drizzle-kit push flow)
 // skip migrate() per architecture.md § 10.2. Apply v1.1 migration 0008
 // inline if the column is missing — idempotent via IF NOT EXISTS.
 await pool.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS attributed_to text`);
 await pool.query(
 `CREATE INDEX IF NOT EXISTS idx_memories_user_attributed_to
 ON memories (user_id, attributed_to)
 WHERE attributed_to IS NOT NULL`,
 );
 const vectorStore = new PgvectorStore(pool);
 await vectorStore.initialize();
 memory = await createLocalMemory({
 vectorStore,
 embedder: ConstantEmbedder,
 llm: new DeterministicStubLLM(),
 });
 }, 30_000);

 beforeEach(async () => {
 await resetTestRows(pool);
 });

 afterAll(async () => {
 await resetTestRows(pool);
 await pool.end();
 });

 describe('Scenario 1 — Multi-peer attribution isolation (T1.1 + T2.1 + T2.2)', () => {
 test('Alice and Bob memories with distinct attributedTo round-trip disjoint via recall filter', async () => {
 await memory
 .user(ALICE)
 .remember('Alice likes lavender tea', { infer: false, attributedTo: 'alice' });
 await memory
 .user(ALICE)
 .remember('Bob said the server is in eu-west-2', { infer: false, attributedTo: 'bob' });
 await memory
 .user(ALICE)
 .remember('Charlie deployed v1.1 yesterday', { infer: false, attributedTo: 'charlie' });

 // Unfiltered recall returns all 3 attributions under the alice scope.
 const all = await memory.user(ALICE).recall('lavender server deploy', { threshold: 0 });
 expect(all.length).toBeGreaterThanOrEqual(3);
 const allAttrs = new Set(all.map((r) => r.attributedTo).filter(Boolean));
 expect(allAttrs.has('alice')).toBe(true);
 expect(allAttrs.has('bob')).toBe(true);
 expect(allAttrs.has('charlie')).toBe(true);

 // Filtered recall returns ONLY the requested peer's attribution.
 const onlyAlice = await memory
 .user(ALICE)
 .recall('lavender server deploy', { attributedTo: 'alice', threshold: 0 });
 for (const r of onlyAlice) {
 expect(r.attributedTo).toBe('alice');
 }

 const onlyBob = await memory
 .user(ALICE)
 .recall('lavender server deploy', { attributedTo: 'bob', threshold: 0 });
 for (const r of onlyBob) {
 expect(r.attributedTo).toBe('bob');
 }

 // EC-5 absorbed: cross-attribution isolation under the default
 // entityBoost path (which is the only path today since entity store
 // is opt-out per ADR-0007).
 const aliceIds = new Set(onlyAlice.map((r) => r.id));
 const bobIds = new Set(onlyBob.map((r) => r.id));
 for (const id of aliceIds) {
 expect(bobIds.has(id)).toBe(false);
 }
 }, 30_000);

 test('EC-7: recall({attributedTo: ""}) matches empty-string rows, NOT NULL rows (Postgres semantics)', async () => {
 // Seed one empty-string + one NULL-attribution row directly via raw SQL.
 const empty = '00000000-0000-4000-a000-000000000010';
 const nullAttr = '00000000-0000-4000-a000-000000000020';
 const embedding = '[' + Array.from({ length: 1536 }, () => 0).map((_, i) => (i === 0 ? '1' : '0')).join(',') + ']';
 await pool.query(
 `INSERT INTO memories (id, text, hash, embedding, payload, user_id, attributed_to)
 VALUES ($1, 'empty-attr fact', 'h-empty', $3::vector, '{}'::jsonb, $2, ''),
 ($4, 'null-attr fact', 'h-null', $3::vector, '{}'::jsonb, $2, NULL)`,
 [empty, ALICE, embedding, nullAttr],
 );

 const matched = await memory.user(ALICE).recall('fact', { attributedTo: '', threshold: 0 });
 const matchedIds = new Set(matched.map((r) => r.id));
 // Postgres '' = '' is true → empty-string row matches.
 expect(matchedIds.has(empty)).toBe(true);
 // Postgres NULL = '' is NULL → NULL row does NOT match.
 expect(matchedIds.has(nullAttr)).toBe(false);
 }, 30_000);
 });

 describe('Scenario 2 — Bi-temporal asOf lift (ADR-0011 + T3.1 + EC-3 + EC-11)', () => {
 test('Forgotten memory recoverable by historical asOf, excluded by post-forget asOf (null-safe temporal predicate)', async () => {
 const items = await memory
 .user(ALICE)
 .remember('Lavender tea ships from Yamashiro', { infer: false });
 expect(items.length).toBeGreaterThan(0);
 const id = items[0]!.id;

 // AS DUAS ANCORAS VEM DO RELOGIO DO BANCO, nao do processo de teste.
 //
 // `t_valid` e `t_invalid` sao gravados com `NOW()` — relogio do POSTGRES. Ancorar o `asOf` em
 // `new Date()` compara dois relogios diferentes; ler `NOW()` do proprio banco elimina essa
 // dependencia inteira, de graca (uma query, ja temos o pool).
 //
 // HONESTIDADE SOBRE O QUE ISTO **NAO** PROVA: este teste reprova no CI e eu NAO consegui
 // reproduzi-lo localmente contra `ankane/pgvector:v0.5.1` real — 7/7 verde com e sem esta
 // mudanca. Minha primeira hipotese era desvio de relogio entre app e banco, e ela foi REFUTADA
 // pela medicao correta: 0ms de desvio sobre a conexao TCP. Os "80ms" que eu havia medido antes
 // eram latencia do `docker exec`, nao relogio — metodo errado.
 //
 // Entao esta mudanca fica pelo seu proprio merito (ancora e coluna no mesmo relogio), NAO como
 // correcao provada do vermelho do CI. A causa daquele segue aberta, com a evidencia que eu tinha,
 // para quem for investigar nao repetir a hipotese ja descartada.
 const dbNow = async (): Promise<Date> =>
   (await pool.query<{ now: Date }>('SELECT NOW() AS now')).rows[0]!.now;
 
 const tBeforeForget = await dbNow();
 // Small pause so t_invalid > tBeforeForget after soft-delete.
 await new Promise((resolve) => setTimeout(resolve, 50));

 await memory.forget(id); // soft-delete: sets t_invalid = NOW()

 await new Promise((resolve) => setTimeout(resolve, 50));
 const tAfterForget = await dbNow();

 // Historical asOf — fact was valid at tBeforeForget; predicate keeps it.
 const recoverable = await memory.user(ALICE).recall('lavender', { asOf: tBeforeForget, threshold: 0 });
 expect(recoverable.some((r) => r.id === id)).toBe(true);

 // Current-state asOf — fact has t_invalid <= tAfterForget; predicate excludes it.
 const excluded = await memory.user(ALICE).recall('lavender', { asOf: tAfterForget, threshold: 0 });
 expect(excluded.some((r) => r.id === id)).toBe(false);

 // EC-11 verified: GDPR-strict erasure path. Hard-delete the row, then
 // even historical asOf cannot resurrect it (row is physically gone).
 await memory.forget(id, { hard: true });
 const erased = await memory.user(ALICE).recall('lavender', { asOf: tBeforeForget, threshold: 0 });
 expect(erased.some((r) => r.id === id)).toBe(false);
 }, 30_000);

 test('EC-3: recall({asOf: invalid Date}) throws InvalidScope at the boundary (not at SQL)', async () => {
 const { InvalidScope } = await import('@usetheo/memory');
 await expect(
 memory.user(ALICE).recall('q', { asOf: new Date('not-a-date') }),
 ).rejects.toBeInstanceOf(InvalidScope);
 }, 15_000);

 test('Regression guard: recall without asOf returns current-state results unchanged', async () => {
 await memory.user(ALICE).remember('Currently-valid fact', { infer: false });
 const noAsOf = await memory.user(ALICE).recall('currently-valid', { threshold: 0 });
 expect(noAsOf.length).toBeGreaterThan(0);
 }, 15_000);
 });

 describe('Scenario 3 — Combined attributedTo + asOf compose correctly (THE GOAL combined)', () => {
 test('recall({attributedTo, asOf}) returns the peer-attributed memory valid at the historical instant', async () => {
 await memory
 .user(ALICE)
 .remember('Paulo recommends pgvector v0.5.1', {
 infer: false,
 attributedTo: 'paulo',
 });
 await memory
 .user(ALICE)
 .remember('Bob recommends ', { infer: false, attributedTo: 'bob' });

 const tBefore = new Date();
 await new Promise((resolve) => setTimeout(resolve, 50));

 // Combined filter: only Paulo's attribution + only memories valid at
 // tBefore (both are valid since they were just inserted).
 const combined = await memory
 .user(ALICE)
 .recall('vector store recommendation', { attributedTo: 'paulo', asOf: tBefore, threshold: 0 });
 expect(combined.length).toBeGreaterThan(0);
 for (const r of combined) {
 expect(r.attributedTo).toBe('paulo');
 }

 // Sanity: Bob's row exists for the same scope but is excluded by the
 // attribution filter.
 const bobScoped = await memory
 .user(ALICE)
 .recall('vector store recommendation', { attributedTo: 'bob', threshold: 0 });
 expect(bobScoped.length).toBeGreaterThan(0);
 const paulosIds = new Set(combined.map((r) => r.id));
 for (const r of bobScoped) {
 expect(paulosIds.has(r.id)).toBe(false);
 }
 }, 30_000);
 });

 describe('Scenario 4 — Migration idempotency (EC-6)', () => {
 test('runMigrations(pool) invoked twice is a no-op (ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS)', async () => {
 // The migration ran at beforeAll. A second invocation must not throw
 // and must leave the schema state unchanged.
 await runMigrations(pool);
 const result = await pool.query<{ exists: boolean }>(
 `SELECT EXISTS (
 SELECT 1 FROM information_schema.columns
 WHERE table_name = 'memories' AND column_name = 'attributed_to'
 ) AS exists`,
 );
 expect(result.rows[0]?.exists).toBe(true);
 }, 15_000);
 });
 },
);
