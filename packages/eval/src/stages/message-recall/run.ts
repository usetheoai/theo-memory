/**
 * Live message-recall evaluation. Ingests hand-written conversations through the real write
 * pipeline into an isolated Postgres database, then asks, per question: did extraction keep a
 * fact holding the answer, does `recall` return it, and does `searchMessages` reach the raw turn?
 * Each question is also answered by the BM25-only ranking over the same stored messages (the
 * log searched without a query vector), so the hybrid ranking is compared on equal data.
 *
 * Criteria are fixed in docs/benchmarks/m30-longmemeval-local.md ("Busca no registro de
 * mensagens" and "Busca semântica no registro de mensagens") before any run. Required env: OPENAI_API_KEY, OPENAI_CHAT_MODEL,
 * MESSAGE_RECALL_OUT (report path). Optional: THEOMEM_PG_URI (admin URI), MESSAGE_RECALL_DB,
 * MESSAGE_RECALL_DISTRACTORS=1 to append the 300 messages of `distractors.json` to every user's
 * log (with embeddings, without extraction), for the large-scope criterion H28 to H30, and
 * MESSAGE_RECALL_CASES, a comma-separated list of case files (default: the first two sets).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import pg from 'pg';

import { createLocalMemory, PgMessageLog, PgvectorStore, runMigrations, type Embedder } from '@usetheo/memory';
import { OpenAICompatibleEmbedder } from '@usetheo/memory/embedders/openai-compatible';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import { z } from 'zod';

import { caseFileSchema, firstHitRank, formViolations, matchesPattern, rankSummary, summarize, summarizeSemantic, type SemanticResult } from './scoring.js';

/** Fixed before measuring (pre-registration): Principle 2 asks for short lists. */
const MESSAGE_LIST_SIZE = 5;
const FACT_LIST_SIZE = 10;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const outPath = requiredEnv('MESSAGE_RECALL_OUT');
const apiKey = requiredEnv('OPENAI_API_KEY');
const chatModel = requiredEnv('OPENAI_CHAT_MODEL');
const adminUri = process.env['THEOMEM_PG_URI'] ?? 'postgresql://themem:themem@localhost:5442/themem';
const dbName = process.env['MESSAGE_RECALL_DB'] ?? 'themem_message_recall';
const withDistractors = process.env['MESSAGE_RECALL_DISTRACTORS'] === '1';
const distractors = withDistractors
  ? z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) })).length(300) })
    .parse(JSON.parse(readFileSync(new URL('./distractors.json', import.meta.url), 'utf8'))).messages
  : [];
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`MESSAGE_RECALL_DB must be a plain identifier, got '${dbName}'`);

const CASE_FILES = (process.env['MESSAGE_RECALL_CASES'] ?? 'cases.json,cases-paraphrase.json').split(',').map((f) => f.trim());
for (const file of CASE_FILES) {
  if (!/^cases[a-z-]*\.json$/.test(file)) throw new Error(`MESSAGE_RECALL_CASES names an unexpected file: '${file}'`);
}
const caseSets = CASE_FILES.map((file) => {
  const cases = caseFileSchema.parse(JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')));
  const violations = formViolations(cases);
  if (violations.length > 0) throw new Error(`${file} is malformed:\n${violations.join('\n')}`);
  return { file, cases };
});
const userIds = caseSets.flatMap((set) => set.cases.users.map((u) => u.id));
// A distractor that holds an answer would score a false hit.
for (const q of caseSets.flatMap((set) => set.cases.users.flatMap((u) => u.questions))) {
  const holding = distractors.find((m) => matchesPattern(q.pattern, m.content));
  if (holding !== undefined) throw new Error(`Distractor matches the answer pattern /${q.pattern}/: '${holding.content}'`);
}
if (new Set(userIds).size !== userIds.length) throw new Error('A user id appears in more than one case file');

const admin = new pg.Pool({ connectionString: adminUri });
try {
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
} finally {
  await admin.end();
}
const uri = new URL(adminUri);
uri.pathname = `/${dbName}`;
const pool = new pg.Pool({ connectionString: uri.toString() });

try {
  await runMigrations(pool, { embeddingDim: EMBEDDING_DIM });
  const provider = new OpenAICompatibleEmbedder({ apiKey, baseUrl: 'https://api.openai.com/v1', model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIM });
  // The provider reports no token usage here, so the embedding volume is recorded as texts and characters.
  const embedded = { texts: 0, characters: 0 };
  const embedder: Embedder = {
    embed: (text) => { embedded.texts += 1; embedded.characters += text.length; return provider.embed(text); },
    embedBatch: (texts) => {
      embedded.texts += texts.length;
      embedded.characters += texts.reduce((n, t) => n + t.length, 0);
      return provider.embedBatch(texts);
    },
  };
  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM }),
    embedder,
    llm: new OpenAILLM(),
    embeddingDim: EMBEDDING_DIM,
  });
  const log = new PgMessageLog(pool);
  // Embedded once with the provider directly, so `embedded` keeps counting the system's own calls.
  const distractorVectors = distractors.length === 0 ? [] : await provider.embedBatch(distractors.map((m) => m.content));

  const rows: (SemanticResult & {
    caseFile: string; facts: string[]; messages: string[]; bm25Messages: string[]; factsTop: string[];
    hybridRank: number | null; bm25Rank: number | null; searchMs: number;
  })[] = [];
  for (const { file, cases } of caseSets) for (const user of cases.users) {
    const scope = memory.user(user.id);
    for (const conversation of user.conversations) await scope.rememberMessages(conversation);
    if (distractors.length > 0) await log.append({ workspace_id: 'default', user_id: user.id }, distractors, undefined, distractorVectors);
    const stored = (await scope.getAll({ topK: 1000 })).map((item) => item.text);
    console.log(`[message-recall] ${user.id}: ${String(user.conversations.length)} conversations -> ${String(stored.length)} facts`);
    for (const q of user.questions) {
      const before = await scope.recall(q.query, { topK: FACT_LIST_SIZE });
      const started = performance.now();
      const messages = await scope.searchMessages(q.query, { limit: MESSAGE_LIST_SIZE });
      const searchMs = performance.now() - started;
      const bm25 = await log.search({ workspace_id: 'default', user_id: user.id }, q.query, { limit: MESSAGE_LIST_SIZE });
      const after = await scope.recall(q.query, { topK: FACT_LIST_SIZE });
      rows.push({
        caseFile: file,
        user: user.id,
        query: q.query,
        form: q.form,
        lostByExtraction: !stored.some((text) => matchesPattern(q.pattern, text)),
        messagesHit: messages.some((m) => matchesPattern(q.pattern, m.content)),
        bm25Hit: bm25.some((m) => matchesPattern(q.pattern, m.content)),
        factsHit: before.some((item) => matchesPattern(q.pattern, item.text)),
        recallUnchanged: JSON.stringify(before.map((i) => i.id)) === JSON.stringify(after.map((i) => i.id)),
        facts: stored,
        factsTop: before.map((i) => i.text),
        messages: messages.map((m) => m.content),
        bm25Messages: bm25.map((m) => m.content),
        hybridRank: firstHitRank(q.pattern, messages.map((m) => m.content)),
        bm25Rank: firstHitRank(q.pattern, bm25.map((m) => m.content)),
        searchMs,
      });
    }
  }

  const bySet = Object.fromEntries(CASE_FILES.map((file) => [file, summarize(rows.filter((r) => r.caseFile === file))]));
  const lostParaphrase = rows.filter((r) => r.lostByExtraction && r.form === 'paraphrase');
  const latencies = rows.map((r) => r.searchMs).sort((a, b) => a - b);
  const percentile = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] ?? 0;
  const summary = {
    distractorsPerUser: distractors.length,
    semantic: summarizeSemantic(rows),
    lostParaphraseRanks: { hybrid: rankSummary(lostParaphrase.map((r) => r.hybridRank)), bm25: rankSummary(lostParaphrase.map((r) => r.bm25Rank)) },
    searchMs: { p50: percentile(0.5), p95: percentile(0.95) },
    bySet,
    embedded,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({
    config: { chatModel, embeddingModel: EMBEDDING_MODEL, messageListSize: MESSAGE_LIST_SIZE, factListSize: FACT_LIST_SIZE, caseFiles: CASE_FILES },
    summary,
    rows,
  }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await pool.end();
}
