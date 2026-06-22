/**
 * GOAL test (domain-ontologies T4.1) — domain-typed extraction end-to-end.
 *
 * Composes against a real pgvector container:
 *  - createLocalMemory({ ontology: 'medical' }) (the feature under test)
 *  - real PgvectorStore at vector(384) (via runMigrations)
 *  - a deterministic stub LLM returning a MIX of in-vocab + out-of-vocab entity
 *    types (the LLM is the deterministic INPUT; the ontology layer + pgvector
 *    persistence are REAL — same honest pattern as the reranker GOAL test).
 *
 * Asserts the two robust truths that prove the feature end-to-end:
 *   1. an in-vocab domain entity type persists in the real `entities.type` column;
 *   2. an out-of-vocab type is coerced to `OTHER` (observable `ontology_type_coerced`),
 *      and the default path (no ontology) leaves entity types untouched.
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 * @see .claude/knowledge-base/plans/domain-ontologies-plan.md § T4.1 (GOAL)
 */
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createLocalMemory, runMigrations, PgvectorStore } from '@usetheo/memory';
import { LocalTransformerEmbedder } from '@usetheo/memory/embedders/local';
import type { LLM } from '@usetheo/memory';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_ontology_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);

// Stub LLM: returns one fact + two entities — one in the medical vocab
// (Diagnosis) and one outside it (Wizard, → coerced to OTHER). The entity NAMES
// are non-English-noun tokens unlikely to collide with the compromise fallback
// extractor's nodes, so the LLM-typed entities persist with their own types.
function makeMedicalStubLlm(): LLM {
  return {
    generateResponse: async () => ({
      memory: [{ id: '0', text: 'Zylophan course recommended for the Qquib condition.' }],
      entities: [
        { name: 'Qquib', type: 'Diagnosis' }, // in medical vocab → persists as Diagnosis
        { name: 'Zylophan', type: 'Wizard' }, // NOT in vocab → coerced to OTHER
      ],
      relations: [],
    }),
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  };
}

describe.skipIf(ROOT_PG_URI === '')('domain-ontologies GOAL — typed extraction vs real pgvector', () => {
  const USER = `ontology-goal-${Date.now()}`;
  let pool: pg.Pool;

  beforeAll(async () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const adminPool = new pg.Pool({ connectionString: adminUri });
    await adminPool.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB}`);
    await adminPool.query(`CREATE DATABASE ${ISOLATED_DB}`);
    await adminPool.end();
    pool = new pg.Pool({ connectionString: PG_URI });
    await runMigrations(pool, { embeddingDim: 384 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('persists an in-vocab domain entity type + coerces out-of-vocab to OTHER + emits the event (real pgvector)', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    const tracer = provider.getTracer('ontology-goal');
    const memory = await createLocalMemory({
      vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
      embedder: new LocalTransformerEmbedder(),
      embeddingDim: 384,
      llm: makeMedicalStubLlm(),
      ontology: 'medical',
      tracer,
    });
    await memory.user(USER).remember('clinical note');

    // Read back the persisted entity types directly from the real table.
    const { rows } = await pool.query<{ name: string; type: string | null }>(
      `SELECT name, type FROM entities WHERE name = ANY($1::text[])`,
      [['Qquib', 'Zylophan']],
    );
    const byName = new Map(rows.map((r) => [r.name, r.type]));

    // (1) the in-vocab domain type reached entities.type.
    expect(byName.get('Qquib')).toBe('Diagnosis');
    // (2) the out-of-vocab type was coerced to the ontology fallback.
    expect(byName.get('Zylophan')).toBe('OTHER');
    // (3) the coercion was observable (Princípio 3) — ontology_type_coerced span emitted.
    const spans = exporter.getFinishedSpans().map((s) => s.name);
    expect(spans).toContain('ontology_type_coerced');
  }, 180_000);

  it('default path (no ontology) persists the LLM entity as the PROPER placeholder (byte-unchanged)', async () => {
    const memory = await createLocalMemory({
      vectorStore: new PgvectorStore(pool, { embeddingDim: 384 }),
      embedder: new LocalTransformerEmbedder(),
      embeddingDim: 384,
      llm: makeMedicalStubLlm(),
      // NO ontology configured — the entity-linking type-carry is gated off, so
      // LLM nodes persist as the shipped 'PROPER' placeholder (review F-dom-db-1:
      // the no-ontology dedup identity is unchanged).
    });
    const noOntUser = `${USER}-noont`;
    await memory.user(noOntUser).remember('clinical note');
    const { rows } = await pool.query<{ name: string; type: string | null }>(
      `SELECT name, type FROM entities WHERE name = $1 AND agent_id IS NULL AND session_id IS NULL AND user_id = $2`,
      ['Qquib', noOntUser],
    );
    // The domain type did NOT leak onto the default path; it's the PROPER placeholder.
    expect(rows[0]?.type).toBe('PROPER');
  }, 180_000);
});
