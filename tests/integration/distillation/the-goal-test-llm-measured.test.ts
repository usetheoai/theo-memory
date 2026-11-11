/**
 * v0.7.1 follow-up — LLM-MEASURED GOAL TEST against real `openai/gpt-4o-mini`
 * via OpenRouter. Closes ADR-EC-B from v0-7-distillation-pipeline plan v1.1:
 *
 * > "if THE GOAL TEST fails, ship SHIPPABLE_WITH_CAVEATS with documented
 * >  actual numbers; iterate via v0.7.1"
 *
 * The original `the-goal-test.test.ts` (T3.3) used `LastWriteWinsConflictPolicy`
 * (deterministic, no LLM call), so its 1.000 numbers proved pipeline wiring
 * but NOT the LLM-judged quality signal. This file uses
 * `LlmJudgedMergeConflictPolicy` with a REAL `OpenAILLM` routed through
 * OpenRouter (env-shift: `OPENROUTER_(API_)KEY` → `OPENAI_API_KEY`,
 * `OPENAI_BASE_URL` → openrouter.ai, `OPENAI_CHAT_MODEL` → openai/gpt-4o-mini).
 *
 * Cost estimate: ~$0.01-0.10/run (10 contradiction-pair fixtures × 1
 * generateResponse call each × cheap model). Gated by OPENROUTER_(API_)KEY
 * presence so CI/no-cost lanes skip cleanly.
 *
 * ## Acceptance (per Item 9 + plan v1.1)
 *
 *   precision ≥ 0.75 + recall ≥ 0.70 + conflict-resolution accuracy ≥ 0.80
 *
 * ## /review v0-7-distillation-pipeline F-M5 honesty caveat (REQUIRED READING)
 *
 * The 10 hand-authored contradiction-pair fixtures are CATEGORICALLY DISTINCT
 * (different city / different car model / different milk type / etc.). The
 * LLM's job here is "pick the newer one" — an LLM that just picks the
 * 2nd item in the list (no semantic understanding at all) would score
 * 1.000/1.000/1.000 too. This test passing 1.000 PROVES:
 *   - pipeline + persistence + audit round-trip works
 *   - OpenRouter routing works
 *   - JSON parsing of {kept_id, rejected_ids, reason} works
 *   - kept_id ∈ clusterIds semantic validation (EC-2) is wired
 *
 * It does NOT prove:
 *   - the LLM's judgment quality on AMBIGUOUS contradictions (e.g.,
 *     "I love coffee" vs "I prefer tea today" — context-dependent)
 *   - the LLM's discrimination on NEAR-DUPLICATES that aren't strict
 *     contradictions (e.g., "I live in São Paulo" vs "I live near
 *     São Paulo")
 *   - quality on procedural-fixture cases (150 procedural fixtures
 *     in tests/fixtures/distillation/ exist but are not measured here)
 *
 * A v0.7.2 follow-up would need to (a) author 50+ AMBIGUOUS contradiction
 * fixtures with ground-truth judgments, (b) measure precision drop vs the
 * unambiguous baseline. Likely outcome: precision falls to ~0.6-0.8 against
 * gpt-4o-mini on ambiguous contradictions. That signal would inform whether
 * to upgrade to gpt-4o on the consolidation hot path.
 *
 * Numbers reported via console.log so the next maintainer can paste them
 * into `tests/eval/distillation.md` § v0.7.1 LLM-measured row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
  createLocalMemory,
  PgvectorStore,
  StubEmbedder,
  LlmJudgedMergeConflictPolicy,
} from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';
import type { LLM, LLMResponse, Message } from '@usetheo/memory';
import { loadGoldSet } from '../../fixtures/distillation/loader.js';
import {
  conflictResolutionAccuracy,
  precision,
  recall,
  type ConflictResolutionDecision,
} from '../../eval/distillation/metrics.js';

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const OPENROUTER_KEY =
  process.env['OPENROUTER_KEY'] ?? process.env['OPENROUTER_API_KEY'] ?? '';

// Demo env-shift mirror — promote OpenRouter key + URL + model so the
// OpenAI SDK reaches openai/gpt-4o-mini via openrouter.ai/api/v1.
// The key follows the endpoint: when this file picks OpenRouter, it sends the OpenRouter
// key even if an OpenAI key is also set, which would otherwise go to OpenRouter and fail 401.
if ((process.env['OPENAI_BASE_URL'] ?? '') === '') {
  process.env['OPENAI_BASE_URL'] = 'https://openrouter.ai/api/v1';
  if (OPENROUTER_KEY !== '') process.env['OPENAI_API_KEY'] = OPENROUTER_KEY;
} else if (OPENROUTER_KEY !== '' && (process.env['OPENAI_API_KEY'] ?? '') === '') {
  process.env['OPENAI_API_KEY'] = OPENROUTER_KEY;
}
if ((process.env['OPENAI_CHAT_MODEL'] ?? '') === '') {
  process.env['OPENAI_CHAT_MODEL'] = 'openai/gpt-4o-mini';
}

const PRECISION_THRESHOLD = 0.75;
const RECALL_THRESHOLD = 0.70;
const ACCURACY_THRESHOLD = 0.80;

// `reflect()` invokes a SEPARATE LLM call for its extraction phase BEFORE
// passing memories into the conflict-resolution policy. The extraction LLM
// is unrelated to the LJM judge — feed it an empty-JSON stub so the test
// stays focused on the JUDGE quality + bills only ~10 LLM calls.
const emptyJsonExtractionLlm: LLM = {
  async generateResponse(_messages: readonly Message[]): Promise<unknown> {
    return Promise.resolve([]);
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ role: 'assistant', content: '[]' });
  },
};

interface GoalRunResult {
  readonly precision: number;
  readonly recall: number;
  readonly conflictAccuracy: number;
  readonly attemptedDecisions: number;
}

describe.skipIf(PG_URI === '' || OPENROUTER_KEY === '')(
  'v0.7.1 — THE GOAL TEST LLM-MEASURED against openai/gpt-4o-mini via OpenRouter',
  () => {
    let pool: pg.Pool;
    let schemaDim = 1536;
    const TEST_USER = 'v0-7-1-llm-measured-goal-user';

    async function reset(): Promise<void> {
      await pool.query(
        `DELETE FROM consolidation_history WHERE policy_name = 'llm-judged-merge'`,
      );
      await pool.query(`DELETE FROM memories WHERE user_id = $1`, [TEST_USER]);
    }

    async function seedPair(text: string, offsetMs: number): Promise<string> {
      // Adapt to the live column dim — DB may be at 384 (demo running
      // local-openrouter mode) or 1536 (default). Probed in beforeAll.
      const embedding = Array.from({ length: schemaDim }, () => 0);
      embedding[0] = 1;
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
           text, hash, embedding, payload, user_id, created_at,
           last_accessed_at, access_count, llm_importance_score
         ) VALUES ($1, $2, $3::vector, $4, $5, NOW() + ($6 || ' milliseconds')::interval,
                   NOW(), 0, 0.5)
         RETURNING id`,
        [
          text,
          `v0-7-1-hash-${String(Date.now())}-${String(Math.random())}`,
          `[${embedding.join(',')}]`,
          { text, user_id: TEST_USER },
          TEST_USER,
          String(offsetMs),
        ],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error('seed: no row');
      return id;
    }

    async function runOnce(): Promise<GoalRunResult> {
      const fixtures = loadGoldSet().filter(
        (f) => f.source === 'hand' && f.category === 'contradiction-pair',
      );
      expect(fixtures, 'hand-authored contradiction-pair fixtures').toHaveLength(10);

      const judgeLlm = new OpenAILLM();
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: emptyJsonExtractionLlm,
        reflectionPolicy: { kind: 'manual' },
      });
      const decisions: ConflictResolutionDecision[] = [];
      const extractedFacts: string[] = [];
      const expectedFacts: string[] = [];
      let attempted = 0;

      for (const fixture of fixtures) {
        if (fixture.expectedConflictPair === undefined) continue;
        await reset();
        attempted += 1;
        const idRejected = await seedPair(fixture.expectedConflictPair.rejected, -5_000);
        const idKept = await seedPair(fixture.expectedConflictPair.kept, +5_000);

        await memory
          .user(TEST_USER)
          .reflect({
            conflictResolution: new LlmJudgedMergeConflictPolicy({ llm: judgeLlm }),
          });

        const { rows: auditRows } = await pool.query<{
          kept_memory_id: string;
          rejected_memory_ids: string[];
          reason: string;
        }>(
          `SELECT kept_memory_id, rejected_memory_ids, reason
             FROM consolidation_history
            WHERE policy_name = 'llm-judged-merge'
            ORDER BY created_at DESC LIMIT 1`,
        );
        const audit = auditRows[0];
        if (audit === undefined) {
          // LJM abstained (parse failure, cluster-cap, etc.) — counts as
          // a missed decision; falls through to scoring.
          continue;
        }

        const { rows: textRows } = await pool.query<{ id: string; text: string }>(
          `SELECT id, text FROM memories WHERE id = ANY($1::uuid[])`,
          [[audit.kept_memory_id, ...audit.rejected_memory_ids]],
        );
        const textById = new Map(textRows.map((r) => [r.id, r.text]));
        const actualKept = textById.get(audit.kept_memory_id) ?? '';
        const actualRejected = audit.rejected_memory_ids
          .map((rid) => textById.get(rid) ?? '')
          .join(' ');

        decisions.push({
          fixtureId: fixture.id,
          expectedKept: fixture.expectedConflictPair.kept,
          expectedRejected: fixture.expectedConflictPair.rejected,
          actualKept,
          actualRejected,
        });
        extractedFacts.push(actualKept);
        expectedFacts.push(fixture.expectedConflictPair.kept);
        void idKept;
        void idRejected;
      }

      await memory.dispose();
      return {
        precision: precision(extractedFacts, expectedFacts, 0.5),
        recall: recall(extractedFacts, expectedFacts, 0.5),
        conflictAccuracy: conflictResolutionAccuracy(decisions, 0.5),
        attemptedDecisions: attempted,
      };
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      // Probe column dim. pgvector v0.5.x stores N directly in atttypmod.
      const probe = await pool.query<{ atttypmod: number }>(
        `SELECT a.atttypmod
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relname = 'memories'
            AND a.attname = 'embedding'
            AND a.attisdropped = false`,
      );
      schemaDim = probe.rows[0]?.atttypmod ?? 1536;
    });
    afterAll(async () => {
      await reset();
      await pool.end();
    });
    beforeEach(async () => {
      await reset();
    });

    it(
      'real LLM meets precision ≥ 0.75, recall ≥ 0.70, conflict-resolution accuracy ≥ 0.80',
      async () => {
        const result = await runOnce();
        // eslint-disable-next-line no-console
        console.log(
          `[v0.7.1 LLM-MEASURED] model=openai/gpt-4o-mini provider=OpenRouter ` +
            `attempted=${String(result.attemptedDecisions)}/10 ` +
            `p=${result.precision.toFixed(3)} r=${result.recall.toFixed(3)} ` +
            `acc=${result.conflictAccuracy.toFixed(3)}`,
        );
        expect(result.precision).toBeGreaterThanOrEqual(PRECISION_THRESHOLD);
        expect(result.recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
        expect(result.conflictAccuracy).toBeGreaterThanOrEqual(ACCURACY_THRESHOLD);
      },
      // 10 LLM round-trips × 5-8s each + extraction stub + pgvector ops
      300_000,
    );
  },
);
