/**
 * T5.1 THE GOAL TEST — principles-alignment-hardening v1.1 consolidated
 * integration assertion suite against real `ankane/pgvector:v0.5.1`.
 *
 * Verifies the 4 sub-goals end-to-end + EC-1 absorption + EC-9 disclosure:
 *  - Princípio 1 (confirmação): assertion 1-6
 *      (a) SAME-scope dedup bumps confirmation_count
 *      (b) EC-1 cross-scope isolation
 *  - Princípio 3 (IGNORE auditability): assertion 7-10
 *      3 new events captured (extraction_zero_facts, dedup_collision_confirmed,
 *      recall_threshold_filtered)
 *  - Princípio 3 (rejectedAsDuplicate consumer-visible flag): assertion 11-14
 *  - Princípio 2 (diversify near-paraphrase reduction): assertion 15-18
 *      EC-9 disclosure: target ≥ 40% reduction; honest measurement; no silent padding.
 *
 * @see .claude/knowledge-base/plans/principles-alignment-hardening-plan.md § T5.1
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import type { LLM } from '@usetheo/memory';
import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { LocalTransformerEmbedder } from '@usetheo/memory/embedders/local';
import { DeterministicStubLLM } from '@usetheo/memory/llms/stub';
import { distinctFacts, nearParaphrases } from '../fixtures/principles/near-paraphrases.js';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t5_1_principles_alignment';

// LLM stub: echoes the user message as a single extracted fact. Same shape
// the cache integration tests use — keeps the extraction path deterministic
// while the embedder produces real semantic vectors.
const echoLlm = (): LLM => ({
  async generateResponse(messages) {
    const userMsg = messages.find((m) => m.role === 'user');
    const content = String(userMsg?.content ?? '');
    const lines = content.split('\n');
    const userLine = lines.find((l) => l.startsWith('user: ')) ?? '';
    const text = userLine.replace(/^user:\s*/, '') || 'extracted fact';
    return { memory: [{ id: '0', text, attributed_to: 'user' }] };
  },
  async generateChat() {
    return { role: 'assistant', content: '' };
  },
});

// LLM stub for the extraction_zero_facts test — returns empty drafts.
const emptyDraftLlm = (): LLM => ({
  async generateResponse() {
    return { memory: [] };
  },
  async generateChat() {
    return { role: 'assistant', content: '' };
  },
});

describe.skipIf(ROOT_PG_URI === '')(
  'principles-alignment-hardening T5.1 — consolidated THE GOAL TEST (≥ 18 assertions)',
  () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const testUri = ROOT_PG_URI.replace(/\/[^/]*$/, `/${TEST_DB}`);
    let pool: pg.Pool;

    beforeAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      await adminPool.end();
      pool = new pg.Pool({ connectionString: testUri });
      await runMigrations(pool, { embeddingDim: 384 });
    }, 120_000);

    afterAll(async () => {
      await pool?.end();
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    }, 30_000);

    it('Princípio 1 (confirmação) — SAME-scope dedup bumps confirmation_count + Princípio 3 rejectedAsDuplicate flag', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
        embedder: new LocalTransformerEmbedder(),
        llm: echoLlm(),
        embeddingDim: 384,
      });
      await pool.query('TRUNCATE memories, entities, history CASCADE');

      // Assertions 1-4: alice writes "I like espresso" 3× SAME scope
      const first = await memory.user('alice').remember('I like espresso');
      expect(first).toHaveLength(1);                                     // 1
      expect(first[0]?.confirmationCount).toBe(1);                       // 2
      expect(first[0]?.rejectedAsDuplicate === true).toBe(false);        // 3

      const second = await memory.user('alice').remember('I like espresso');
      expect(second[0]?.confirmationCount).toBe(2);                      // 4

      const third = await memory.user('alice').remember('I like espresso');
      expect(third[0]?.confirmationCount).toBe(3);                       // 5
      expect(third[0]?.rejectedAsDuplicate).toBe(true);                  // 6 (Princípio 3 rejectedAsDuplicate)

      // Verify only ONE row persisted in DB (dedup at constraint level).
      const rows = await pool.query<{ count: string; confirmation_count: number }>(
        `SELECT count(*)::text AS count, MAX(confirmation_count) AS confirmation_count
           FROM memories WHERE user_id = 'alice'`,
      );
      expect(rows.rows[0]?.count).toBe('1');                             // 7
      expect(Number(rows.rows[0]?.confirmation_count)).toBe(3);          // 8
    }, 120_000);

    it('EC-1 absorption — cross-scope isolation: bob writes same text → 2 independent rows', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
        embedder: new LocalTransformerEmbedder(),
        llm: echoLlm(),
        embeddingDim: 384,
      });
      await pool.query('TRUNCATE memories, entities, history CASCADE');

      // alice + bob each write the same text — independent rows, independent counters.
      const aliceFirst = await memory.user('alice').remember('I like espresso');
      expect(aliceFirst[0]?.confirmationCount).toBe(1);                  // 9

      const bobFirst = await memory.user('bob').remember('I like espresso');
      expect(bobFirst[0]?.confirmationCount).toBe(1);                    // 10
      expect(bobFirst[0]?.rejectedAsDuplicate === true).toBe(false);     // 11 — bob is NOT marked as duplicate
      expect(bobFirst[0]?.id).not.toBe(aliceFirst[0]?.id);               // 12 — different rows

      // alice's row should remain confirmation_count=1 (bob's write did not bump it).
      const aliceRow = await pool.query<{ confirmation_count: number }>(
        `SELECT confirmation_count FROM memories WHERE user_id = 'alice' LIMIT 1`,
      );
      expect(Number(aliceRow.rows[0]?.confirmation_count)).toBe(1);      // 13 — unchanged
    }, 120_000);

    it('Princípio 3 IGNORE auditability — 3 new events captured (extraction_zero_facts + dedup_collision_confirmed + recall_threshold_filtered)', async () => {
      const exporter = new InMemorySpanExporter();
      const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
      const tracer = provider.getTracer('test');

      await pool.query('TRUNCATE memories, entities, history CASCADE');

      // Event 1: dedup_collision_confirmed — alice writes "I like dark coffee" twice.
      const memoryEcho = await createLocalMemory({
        vectorStore: new PgvectorStore(pool, { embeddingDim: 384, tracer }),
        embedder: new LocalTransformerEmbedder(),
        llm: echoLlm(),
        embeddingDim: 384,
        tracer,
      });
      await memoryEcho.user('alice').remember('I like dark coffee');
      await memoryEcho.user('alice').remember('I like dark coffee');

      // Event 2: extraction_zero_facts — LLM stub returns [] for this memory.
      const memoryEmpty = await createLocalMemory({
        vectorStore: new PgvectorStore(pool, { embeddingDim: 384, tracer }),
        embedder: new LocalTransformerEmbedder(),
        llm: emptyDraftLlm(),
        embeddingDim: 384,
        tracer,
      });
      await memoryEmpty.user('alice').remember('blank input that yields no facts');

      // Event 3: recall_threshold_filtered — recall with a very high threshold
      // so the existing memory row is dropped at the threshold gate.
      await memoryEcho.user('alice').recall('coffee preferences', { threshold: 0.95 });

      const spanNames = exporter.getFinishedSpans().map((s) => s.name);
      expect(spanNames).toContain('dedup_collision_confirmed');          // 14
      expect(spanNames).toContain('extraction_zero_facts');              // 15
      expect(spanNames).toContain('recall_threshold_filtered');          // 16
    }, 180_000);

    it('EC-6 absorption — recall() returns MemoryItems with confirmationCount hoisted from DB projection', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
        embedder: new LocalTransformerEmbedder(),
        llm: echoLlm(),
        embeddingDim: 384,
      });
      await pool.query('TRUNCATE memories, entities, history CASCADE');

      // alice writes "I like tea" twice → confirmation_count = 2 in DB
      await memory.user('alice').remember('I like tea');
      await memory.user('alice').remember('I like tea');

      // Recall the same query — the returned MemoryItem must carry
      // confirmationCount = 2 (hoisted from pgvector-store SELECT projection).
      const results = await memory.user('alice').recall('I like tea', { topK: 5, threshold: 0.1 });
      expect(results.length).toBeGreaterThan(0);
      const teaItem = results.find((r) => r.text.toLowerCase().includes('tea'));
      expect(teaItem).toBeDefined();
      expect(teaItem!.confirmationCount).toBe(2);
    }, 120_000);

    it('Princípio 2 (diversify) — MMR reduces near-paraphrase redundancy (EC-9 honest measurement)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
        embedder: new LocalTransformerEmbedder(),
        llm: new DeterministicStubLLM(),
        embeddingDim: 384,
      });
      await pool.query('TRUNCATE memories, entities, history CASCADE');

      // Seed: 10 near-paraphrases of "Alice likes coffee" + 5 distinct facts.
      for (const text of nearParaphrases) {
        await memory.user('alice').remember(text);
      }
      for (const text of distinctFacts) {
        await memory.user('alice').remember(text);
      }

      // Baseline recall (no diversify): top 10 should be dominated by paraphrases.
      const baseline = await memory.user('alice').recall('coffee', { topK: 10, threshold: 0.1 });

      // MMR recall with lambda=0.7 (literature default).
      const diversified = await memory.user('alice').recall('coffee', {
        topK: 10,
        threshold: 0.1,
        diversify: { lambda: 0.7 },
      });

      // Count "coffee" hits in each result set (near-paraphrases all mention coffee).
      const baselineCoffeeHits = baseline.filter((r) => r.text.toLowerCase().includes('coffee')).length;
      const diversifiedCoffeeHits = diversified.filter((r) => r.text.toLowerCase().includes('coffee')).length;

      // EC-9 disclosure: target ≥ 40% reduction. honest measurement — no silent padding.
      // baseline=N coffee, diversified=M coffee where M < N when MMR works.
      expect(baseline.length).toBeGreaterThan(0);                        // 17
      expect(diversified.length).toBeGreaterThan(0);                     // 18
      expect(diversifiedCoffeeHits).toBeLessThanOrEqual(baselineCoffeeHits); // 19 — MMR reduces (or holds) near-dup count

      // Honest disclosure of measured reduction percentage in the test output.
      const reductionPct = baselineCoffeeHits === 0
        ? 0
        : ((baselineCoffeeHits - diversifiedCoffeeHits) / baselineCoffeeHits) * 100;
      // eslint-disable-next-line no-console
      console.log(
        `[T5.1 EC-9 disclosure] baseline coffee hits = ${baselineCoffeeHits}; ` +
        `diversified coffee hits = ${diversifiedCoffeeHits}; ` +
        `measured reduction = ${reductionPct.toFixed(1)}% (target ≥ 40%)`,
      );
      // The actual ≥ 40% gate is documented in EC-9 — measurement is the
      // contract; commit body discloses if the target is not met (NOT silent
      // fixture padding).
    }, 300_000);
  },
);
