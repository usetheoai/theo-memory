/**
 * e2e-qa — LongMemEval-inspired 4-phase QA harness wired to TheMemory.
 *
 * Uses the benchmark's session-history/answer/judge structure, with a
 * Theo-specific extractor, retriever, answer prompt and judge prompt. This is
 * a diagnostic harness, not a verbatim reproduction of the official protocol;
 * scores must not be presented as directly comparable leaderboard results.
 * The memory layer is TheMemory
 * (`createLocalMemory` + real pgvector + LocalTransformerEmbedder + OpenAILLM
 * harness. See this stage's README section.
 *
 *   Phase 1 — Ingest    haystack turns via `remember` (scoped per example,
 *                       chronological; the full run uses every source turn).
 *   Phase 2 — Search    `recall(question)` top-k.
 *   Phase 3 — Generate  answer prompt, temperature=0.
 *   Phase 4 — Judge     judge prompt, temperature=0 → binary yes/no.
 *
 * Metric: accuracy = fraction judged 'yes' (overall + per question_type +
 * abstention subset). ABSOLUTE binary — no partial credit.
 *
 * Generation/judging use OPENAI_CHAT_MODEL via OPENAI_BASE_URL. The default is
 * a small model; scores are diagnostic and not leaderboard-comparable.
 *
 * Run (key-gated — SKIPs cleanly without a key or the dataset):
 *   # .env.local: OPENAI_API_KEY=... + OPENAI_CHAT_MODEL=gpt-4o-mini-2024-07-18
 *   export THEOMEM_PG_URI=postgresql://themem:themem@localhost:5442/themem
 *   pnpm --filter @usetheo/memory-eval eval:e2e-qa
 */
import { appendFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import OpenAI from 'openai';

import { createLocalMemory, LlmJudgedMergeConflictPolicy, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { ConflictResolutionPolicy, DisposableMemory } from '@usetheo/memory';
import { LocalTransformerEmbedder } from '@usetheo/memory/embedders/local';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import {
  loadLongMemEvalDataset,
  selectRunSubset,
  isAbstention,
  chronologicalSessions,
  parseHaystackDate,
  type LongMemEvalExample,
} from './longmemeval-loader.js';
import { mapWithConcurrency, runSafely } from './concurrency.js';
import {
  buildLongMemEvalAnswerPrompt,
  buildLongMemEvalJudgePrompt,
  parseJudgeVerdict,
} from './prompts.js';
import { assessRunIntegrity, describeIngestError, failedResult, report, type ExampleResult } from './report.js';

// ---- Config -----------------------------------------------------------------

const ADMIN_PG_URI =
  process.env['THEOMEM_PG_URI'] ??
  'postgresql://themem:themem@localhost:5442/themem';
const ISOLATED_DB = process.env['E2E_QA_DB'] ?? 'themem_e2e_qa'; // overridable → distinct DB per run
// Answer again over a database an earlier run already ingested: no re-creation, no ingestion.
// Recall and answering can then be compared without the extraction noise of a second ingest.
const REUSE_DB = process.env['E2E_QA_REUSE_DB'] === '1';
// Scope-isolated examples → safe to parallelise (default 1 = serial); >1 makes the full run feasible.
const CONCURRENCY = Math.max(1, Number.parseInt(process.env['E2E_QA_CONCURRENCY'] ?? '1', 10) || 1);
const EMBEDDING_DIM = 384; // Xenova/all-MiniLM-L6-v2
const TURN_CAP = Number(process.env['E2E_QA_TURN_CAP'] ?? '40'); // 0 means all source turns
if (!Number.isInteger(TURN_CAP) || TURN_CAP < 0 || TURN_CAP > 1_000_000) {
  throw new Error('E2E_QA_TURN_CAP must be an integer in 0..1000000 (0 means unlimited)');
}
const RECALL_TOP_K = Math.max(1, Number.parseInt(process.env['E2E_QA_TOP_K'] ?? '20', 10) || 20);
const INGEST_MODE = process.env['E2E_QA_INGEST_MODE'] === 'session' ? 'session' : 'turn';
const CHAT_MODEL = process.env['OPENAI_CHAT_MODEL'] ?? 'gpt-4o-mini-2024-07-18';
// Dataset files are NOT vendored. The default is Oracle; point E2E_QA_DATASET
// to the official S/M file for those variants. Absent => the stage SKIPs.
const DATASET_PATH =
  process.env['E2E_QA_DATASET'] ??
  fileURLToPath(new URL('../../../../../benchmarks/data/longmemeval_oracle.json', import.meta.url));
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

/** The session date as `observedAt`, or nothing when the dataset gives no parseable date. */
function observedAtOption(sourceDate: string): { observedAt?: Date } {
  const ms = parseHaystackDate(sourceDate);
  return ms === Number.MAX_SAFE_INTEGER ? {} : { observedAt: new Date(ms) };
}

// ---- Per-example pipeline ---------------------------------------------------

async function runExample(
  memory: DisposableMemory,
  client: OpenAI,
  ex: LongMemEvalExample,
  conflictPolicy: ConflictResolutionPolicy,
): Promise<ExampleResult> {
  const scoped = memory.user(`lme_${ex.question_id}`);
  const availableTurns = ex.haystack_sessions.reduce((sum, session) => sum + session.length, 0);
  const sessions = chronologicalSessions(ex, TURN_CAP);
  const turns = sessions.flatMap((session) => session.turns.map((turn) => ({ ...turn, sourceDate: session.sourceDate })));

  // Phase 1 — Ingest (chronological; fail-soft per turn).
  let ingestErrors = 0;
  let ingestedMemories = 0;
  const ingestErrorTypes: string[] = [];
  const batches = INGEST_MODE === 'turn'
    ? turns.map((turn) => ({ turns: [turn], sourceDate: turn.sourceDate }))
    : sessions;
  for (const batch of REUSE_DB ? [] : batches) {
    try {
      // Preserve the source speaker as authoritative attribution. Without this,
      // assistant hallucinations in the benchmark transcript are ingested as
      // user assertions and can later contaminate profile facts/reflection.
      const roles = new Set(batch.turns.map((turn) => turn.role));
      if (batch.turns.some((turn) => turn.role !== 'user' && turn.role !== 'assistant')) {
        throw new Error('LongMemEval contains a role unsupported by memory ingestion');
      }
      const options = {
        ...(roles.size === 1 ? { attributedTo: batch.turns[0]!.role } : {}),
        strictExtraction: true,
        ...(batch.sourceDate !== '' ? { metadata: { source_date: batch.sourceDate } } : {}),
        // When the session was said, so relative dates and replaced facts anchor to it (ADR-0028).
        ...observedAtOption(batch.sourceDate),
      };
      const messages = batch.turns.map((turn) => ({ role: turn.role as 'user' | 'assistant', content: turn.content }));
      // Builds without `rememberMessages` (older commits measured as a baseline) get the same
      // turns as role-labelled text, the form their own runner used, with the same options.
      const canRememberMessages = typeof (scoped as Partial<typeof scoped>).rememberMessages === 'function';
      ingestedMemories += (
        canRememberMessages
          ? await scoped.rememberMessages(messages, options)
          : await scoped.remember(messages.map((m) => `${m.role}: ${m.content}`).join('\n'), options)
      ).length;
    } catch (err) {
      ingestErrors += 1;
      ingestErrorTypes.push(describeIngestError(err));
    }
  }

  // Phase 1.5 — Consolidate (#144, M24): OPT-IN reflect before recall (bounded
  // per-anchor consolidation supersedes stale values). See docs/benchmarks/m24-*.md.
  let reflectionError: string | undefined;
  if (process.env['E2E_QA_REFLECT'] === '1') {
    try {
      await scoped.reflect({ conflictResolution: conflictPolicy });
    } catch (err) {
      reflectionError = err instanceof Error ? `${err.name}: ${err.message}` : 'UnknownError';
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
          .map((m) => {
            const sourceDate = m.metadata['source_date'];
            const sourceTag = typeof sourceDate === 'string' ? ` source_date=${sourceDate}` : '';
            return `- [source=${m.attributedTo ?? 'unknown'}${sourceTag}] ${m.text}`;
          })
          .join('\n');

  // Phase 3 — Generate, with the published LongMemEval answer template.
  const modelAnswer = extractAnswerText(
    await chatComplete(
      client,
      buildLongMemEvalAnswerPrompt({
        question: ex.question,
        questionDate: ex.question_date,
        memories: memoriesBlock,
      }),
    ),
  );

  // Phase 4 — Judge, with the published category-specific judge templates.
  const correct = parseJudgeVerdict(
    await chatComplete(
      client,
      buildLongMemEvalJudgePrompt({
        questionType: ex.question_type,
        question: ex.question,
        answer: ex.answer,
        response: modelAnswer,
        abstention: isAbstention(ex),
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
    availableTurns,
    ingestedMemories,
    recalledCount: recalled.length,
    recallEvidence: recalled.map((m) => ({ id: m.id, text: m.text, score: m.score })),
    ingestErrors,
    ingestErrorTypes,
    ...(reflectionError === undefined ? {} : { reflectionError }),
  };
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  // Key-gated: honest SKIP (exit 0), never a fabricated result or keyless CI failure.
  // Set OPENAI_API_KEY; OPENAI_BASE_URL may point to a compatible provider.
  const apiKey = process.env['OPENAI_API_KEY'] ?? '';
  if (apiKey === '') {
    console.log('[e2e-qa] SKIP: OPENAI_API_KEY not set (key-gated eval; no keyless run).');
    return;
  }
  // The dataset is not vendored (see DATASET_PATH) — absent in CI. SKIP
  // cleanly rather than fail when it is not present.
  if (!existsSync(DATASET_PATH)) {
    console.log(`[e2e-qa] SKIP: dataset not found at ${DATASET_PATH} (set E2E_QA_DATASET to override).`);
    return;
  }

  const dataset = loadLongMemEvalDataset(DATASET_PATH);
  const limitEnv = process.env['E2E_QA_LIMIT'] ?? '';
  const idsEnv = process.env['E2E_QA_IDS'] ?? '';
  const subset = selectRunSubset(dataset, limitEnv, idsEnv);
  const mode = idsEnv.trim() !== ''
    ? `ids:${String(subset.length)}`
    : limitEnv.trim() === '' ? 'subset-12' : limitEnv.trim().toLowerCase();
  const absN = subset.filter(isAbstention).length;
  console.log(
    `[e2e-qa] dataset=${basename(DATASET_PATH)} loaded ${String(dataset.length)} examples; selected ${String(subset.length)} (${String(absN)} abstention) [mode=${mode}] prompt_mode=official-longmemeval ingest_mode=${INGEST_MODE} model=${CHAT_MODEL} dim=${String(EMBEDDING_DIM)} turn_cap=${TURN_CAP === 0 ? 'unlimited' : String(TURN_CAP)} top_k=${String(RECALL_TOP_K)} conc=${String(CONCURRENCY)}`,
  );

  if (REUSE_DB) {
    console.error(`[e2e-qa] E2E_QA_REUSE_DB=1: reusing ${ISOLATED_DB}; ingestion skipped`);
  } else {
    await provisionIsolatedDb();
  }
  const pool = new pg.Pool({ connectionString: isolatedUri(), max: CONCURRENCY + 4 });
  await runMigrations(pool, { embeddingDim: EMBEDDING_DIM });

  const client = new OpenAI({
    apiKey,
    baseURL: process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1',
  });

  const memory = (await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM }),
    embedder: new LocalTransformerEmbedder(),
    llm: new OpenAILLM(),
    embeddingDim: EMBEDDING_DIM,
    // reflectionPolicy omitted → factory default `{ kind: 'manual' }` (auto-reflect off);
    // Phase 1.5 drives reflect() explicitly. #144, M23.
  }));

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
  const integrity = assessRunIntegrity(results);
  if (!integrity.valid) {
    console.error(
      `[e2e-qa] INVALID RUN: ${String(integrity.invalidExamples)} examples had ingestion, reflection, or pipeline errors. Do not use the aggregate as a benchmark score.`,
    );
    process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  console.error('[e2e-qa] FATAL:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
