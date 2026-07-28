/**
 * e2e-qa — LongMemEval 4-phase QA harness wired to TheMemory.
 *
 * Faithfully replicates the published LongMemEval
 * end-to-end QA methodology, but the memory layer is TheMemory
 * (`createLocalMemory` + real pgvector + LocalTransformerEmbedder + OpenAILLM
 * harness. See this stage's README section.
 *
 *   Phase 1 — Ingest    haystack turns via `remember` (scoped per example,
 *                       chronological, capped at TURN_CAP total turns).
 *   Phase 2 — Search    `recall(question)` top-k.
 *   Phase 3 — Generate  answer prompt, temperature=0.
 *   Phase 4 — Judge     judge prompt, temperature=0 → binary yes/no.
 *
 * Metric: accuracy = fraction judged 'yes' (overall + per question_type +
 * abstention subset). ABSOLUTE binary — no partial credit.
 *
 * Model: openai/gpt-4o-mini via OpenRouter (a small/cheap model — scores are NOT
 * leaderboard-comparable; this measures whether TheMemory answers LongMemEval).
 *
 * Run (key-gated — SKIPs cleanly without a key or the dataset):
 *   # .env.local: OPENAI_API_KEY=<sk-or-…> + OPENAI_BASE_URL=https://openrouter.ai/api/v1 + OPENAI_CHAT_MODEL=openai/gpt-4o-mini
 *   export THEOMEM_PG_URI=postgresql://themem:themem@localhost:5442/themem
 *   pnpm --filter @usetheo/memory-eval eval:e2e-qa
 */
import { appendFileSync, existsSync } from 'node:fs';

import pg from 'pg';
import OpenAI from 'openai';

import { createLocalMemory, LlmJudgedMergeConflictPolicy, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { ConflictResolutionPolicy, DisposableMemory } from '@usetheo/memory';
import { LocalTransformerEmbedder } from '@usetheo/memory/embedders/local';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import {
  loadOracleDataset,
  selectRunSubset,
  isAbstention,
  type LongMemEvalExample,
} from './longmemeval-loader.js';
import { shouldAbstain } from './coverage-gate.js';
import { abstentionIsMiss } from './scoring.js';
import { mapWithConcurrency, runSafely } from './concurrency.js';
import { buildAnswerPrompt, buildJudgePrompt, parseJudgeVerdict } from './prompts.js';
import { report, failedResult, type ExampleResult } from './report.js';

// ---- Config -----------------------------------------------------------------

const ADMIN_PG_URI =
  process.env['THEOMEM_PG_URI'] ??
  'postgresql://themem:themem@localhost:5442/themem';
const ISOLATED_DB = process.env['E2E_QA_DB'] ?? 'themem_e2e_qa'; // overridable → distinct DB per run
// Scope-isolated examples → safe to parallelise (default 1 = serial); >1 makes the full run feasible.
const CONCURRENCY = Math.max(1, Number.parseInt(process.env['E2E_QA_CONCURRENCY'] ?? '1', 10) || 1);
const EMBEDDING_DIM = 384; // Xenova/all-MiniLM-L6-v2
const TURN_CAP = 40; // max turns ingested per example (cost bound)
const RECALL_TOP_K = 10;
// #140 — conservative pre-answer coverage gate: abstain when the best recalled
// memory scores below this. Provisional (blueprint: the abstention subset is too
// small to tune τ with confidence); env-overridable for experiments.
const COVERAGE_TAU = Number(process.env['E2E_QA_COVERAGE_TAU'] ?? '0.15');
const ABSTAIN_ANSWER = "I don't have that information.";
const CHAT_MODEL = process.env['OPENAI_CHAT_MODEL'] ?? 'openai/gpt-4o-mini';
// LongMemEval_oracle is NOT vendored (license + size). Drop the file at the default
// path below, or point E2E_QA_DATASET at your own copy. Absent => the stage SKIPs.
const DATASET_PATH =
  process.env['E2E_QA_DATASET'] ?? 'benchmarks/data/longmemeval_oracle.json';
// Incremental per-example persistence so an interrupted run is salvageable.
const OUT_JSONL = process.env['E2E_QA_JSONL'] ?? '';

// ---- Helpers ----------------------------------------------------------------

function isolatedUri(): string {
  const u = new URL(ADMIN_PG_URI);
  u.pathname = `/${ISOLATED_DB}`;
  return u.toString();
}

async function provisionIsolatedDb(): Promise<void> {
  const admin = new pg.Pool({ connectionString: ADMIN_PG_URI });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB}`);
    await admin.query(`CREATE DATABASE ${ISOLATED_DB}`);
  } finally {
    await admin.end();
  }
}

/** Parse a LongMemEval date string like "2023/04/10 (Mon) 23:07" → epoch ms. */
function parseHaystackDate(s: string): number {
  const cleaned = s.replace(/\([A-Za-z]{3}\)/, '').replace(/\s+/g, ' ').trim();
  const t = Date.parse(cleaned);
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/** Flatten sessions chronologically (by haystack_dates) into a capped turn list. */
function chronologicalTurns(
  example: LongMemEvalExample,
): Array<{ role: string; content: string }> {
  const indexed = example.haystack_sessions.map((session, i) => ({
    session,
    date: parseHaystackDate(example.haystack_dates[i] ?? ''),
    order: i,
  }));
  indexed.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date - b.date));

  const turns: Array<{ role: string; content: string }> = [];
  for (const { session } of indexed) {
    for (const turn of session) {
      if (turns.length >= TURN_CAP) return turns;
      turns.push({ role: turn.role, content: turn.content });
    }
  }
  return turns;
}

function extractAnswerText(raw: string): string {
  const after = raw.split(/<\/mem_thinking>/i).pop() ?? raw;
  const cleaned = after.replace(/<\/?mem_thinking>/gi, '').trim();
  return cleaned.length > 0 ? cleaned : raw.trim();
}

/** Single temperature=0 completion against the answerer/judge model. */
async function chatComplete(client: OpenAI, prompt: string): Promise<string> {
  const resp = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });
  return resp.choices[0]?.message.content ?? '';
}

// ---- Per-example pipeline ---------------------------------------------------

async function runExample(
  memory: DisposableMemory,
  client: OpenAI,
  ex: LongMemEvalExample,
  conflictPolicy: ConflictResolutionPolicy,
): Promise<ExampleResult> {
  const scoped = memory.user(`lme_${ex.question_id}`);
  const turns = chronologicalTurns(ex);

  // Phase 1 — Ingest (chronological; fail-soft per turn).
  let ingestErrors = 0;
  for (const turn of turns) {
    try {
      await scoped.remember(`${turn.role}: ${turn.content}`);
    } catch {
      ingestErrors += 1;
    }
  }

  // Phase 1.5 — Consolidate (#144, M24): OPT-IN reflect before recall (bounded
  // per-anchor consolidation supersedes stale values). See docs/benchmarks/m24-*.md.
  if (process.env['E2E_QA_REFLECT'] === '1') {
    try {
      await scoped.reflect({ conflictResolution: conflictPolicy });
    } catch (err) {
      console.error(`[e2e-qa] reflect failed for ${ex.question_id}:`, err);
    }
  }

  // Phase 2 — Search. M22 #141: recencyCollapse prunes near-duplicate stale values.
  const recalled = await scoped.recall(ex.question, {
    topK: RECALL_TOP_K,
    recencyCollapse: {},
  });
  const memoriesBlock =
    recalled.length === 0
      ? '(no memories found)'
      : [...recalled]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((m) => `- ${m.text}`)
          .join('\n');

  // Phase 3 — Generate. #140: abstain deterministically when recall coverage is
  // thin (empty OR best score < τ) BEFORE the LLM call, so the answerer cannot
  // fabricate an answer from insufficient evidence (recall was honest; the
  // answerer discipline is the fix — blueprint D2).
  const modelAnswer = shouldAbstain(recalled, COVERAGE_TAU)
    ? ABSTAIN_ANSWER
    : extractAnswerText(
        await chatComplete(
          client,
          buildAnswerPrompt({
            question: ex.question,
            questionDate: ex.question_date,
            memories: memoriesBlock,
          }),
        ),
      );

  // Phase 4 — Judge. #148: an abstention on a NON-abstention question is a miss
  // by definition (the model did not produce the gold value) — score it NO
  // deterministically, WITHOUT the demonstrably-lenient LLM judge.
  const correct = abstentionIsMiss(isAbstention(ex), modelAnswer, ABSTAIN_ANSWER)
    ? false
    : parseJudgeVerdict(
        await chatComplete(
          client,
          buildJudgePrompt({
            question: ex.question,
            answer: ex.answer,
            response: modelAnswer,
          }),
        ),
      );

  return {
    questionId: ex.question_id,
    questionType: ex.question_type,
    abstention: isAbstention(ex),
    question: ex.question,
    goldAnswer: ex.answer,
    modelAnswer,
    correct,
    ingestedTurns: turns.length,
    recalledCount: recalled.length,
    ingestErrors,
  };
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  // Key-gated (like the LLM-measured tier): honest SKIP (exit 0), never a
  // fabricated result and never a keyless CI failure. Set OPENAI_API_KEY via
  // `.env.local` (env-shift an OpenRouter key: OPENAI_API_KEY=<sk-or-…>,
  // OPENAI_BASE_URL=https://openrouter.ai/api/v1, OPENAI_CHAT_MODEL=openai/gpt-4o-mini).
  const openrouterKey = process.env['OPENAI_API_KEY'] ?? '';
  if (openrouterKey === '') {
    console.log('[e2e-qa] SKIP: OPENAI_API_KEY not set (key-gated eval; no keyless run).');
    return;
  }
  // The dataset is not vendored (see DATASET_PATH) — absent in CI. SKIP
  // cleanly rather than fail when it is not present.
  if (!existsSync(DATASET_PATH)) {
    console.log(`[e2e-qa] SKIP: dataset not found at ${DATASET_PATH} (set E2E_QA_DATASET to override).`);
    return;
  }

  const dataset = loadOracleDataset(DATASET_PATH);
  const limitEnv = process.env['E2E_QA_LIMIT'] ?? '';
  const subset = selectRunSubset(dataset, limitEnv);
  const mode = limitEnv.trim() === '' ? 'subset-12' : limitEnv.trim().toLowerCase();
  const absN = subset.filter(isAbstention).length;
  console.log(
    `[e2e-qa] loaded ${String(dataset.length)} examples; selected ${String(subset.length)} (${String(absN)} abstention) [mode=${mode}] model=${CHAT_MODEL} dim=${String(EMBEDDING_DIM)} turn_cap=${String(TURN_CAP)} top_k=${String(RECALL_TOP_K)} conc=${String(CONCURRENCY)}`,
  );

  await provisionIsolatedDb();
  const pool = new pg.Pool({ connectionString: isolatedUri(), max: CONCURRENCY + 4 });
  await runMigrations(pool, { embeddingDim: EMBEDDING_DIM });

  const client = new OpenAI({
    apiKey: openrouterKey,
    baseURL: process.env['OPENAI_BASE_URL'] ?? 'https://openrouter.ai/api/v1',
  });

  const memory = (await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM }),
    embedder: new LocalTransformerEmbedder(),
    llm: new OpenAILLM(),
    embeddingDim: EMBEDDING_DIM,
    // reflectionPolicy omitted → factory default `{ kind: 'manual' }` (auto-reflect off);
    // Phase 1.5 drives reflect() explicitly. #144, M23.
  })) as DisposableMemory;

  // #144 (M23): the LLM-judged supersession policy used by the Phase 1.5 reflect. Reuses
  // the same OpenAILLM (key-gated at main); the judge picks a keeper + rejects the stale
  // duplicates → persistConsolidations sets t_invalid → recall stops surfacing them.
  const conflictPolicy = new LlmJudgedMergeConflictPolicy({ llm: new OpenAILLM() });

  let done = 0;
  const results = await mapWithConcurrency(subset, CONCURRENCY, async (ex) => {
    // Fail-safe per example: a transient 5xx / context overflow scores a miss with
    // an `error` field, never aborting the whole run (a bench must survive one bad row).
    const r = await runSafely(
      () => runExample(memory, client, ex, conflictPolicy),
      (message) => failedResult(ex, message),
    );
    done += 1;
    if (OUT_JSONL !== '') appendFileSync(OUT_JSONL, JSON.stringify(r) + '\n');
    const tag = r.error !== undefined ? ` ERROR=${r.error.slice(0, 60)}` : '';
    console.log(
      `[e2e-qa] (${String(done)}/${String(subset.length)}) ${r.questionId} type=${r.questionType} recalled=${String(r.recalledCount)} → ${r.correct ? 'YES' : 'no'}${tag}`,
    );
    return r;
  });

  await memory.dispose();
  await pool.end();

  report(results);
}

main().catch((err: unknown) => {
  console.error('[e2e-qa] FATAL:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
