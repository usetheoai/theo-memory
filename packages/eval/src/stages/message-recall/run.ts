/**
 * Live message-recall evaluation. Ingests hand-written conversations through the real write
 * pipeline into an isolated Postgres database, then asks, per question: did extraction keep a
 * fact holding the answer, does `recall` return it, and does `searchMessages` reach the raw turn?
 *
 * Criteria are fixed in docs/benchmarks/m30-longmemeval-local.md ("Busca no registro de
 * mensagens") before any run. Required env: OPENAI_API_KEY, OPENAI_CHAT_MODEL,
 * MESSAGE_RECALL_OUT (report path). Optional: THEOMEM_PG_URI (admin URI), MESSAGE_RECALL_DB.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { OpenAICompatibleEmbedder } from '@usetheo/memory/embedders/openai-compatible';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import { caseFileSchema, formViolations, matchesPattern, summarize, type QuestionResult } from './scoring.js';

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
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`MESSAGE_RECALL_DB must be a plain identifier, got '${dbName}'`);

const cases = caseFileSchema.parse(JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')));
const violations = formViolations(cases);
if (violations.length > 0) throw new Error(`Case file is malformed:\n${violations.join('\n')}`);

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
  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM }),
    embedder: new OpenAICompatibleEmbedder({ apiKey, baseUrl: 'https://api.openai.com/v1', model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIM }),
    llm: new OpenAILLM(),
    embeddingDim: EMBEDDING_DIM,
  });

  const rows: (QuestionResult & { facts: string[]; messages: string[]; factsTop: string[] })[] = [];
  for (const user of cases.users) {
    const scope = memory.user(user.id);
    for (const conversation of user.conversations) await scope.rememberMessages(conversation);
    const stored = (await scope.getAll({ topK: 1000 })).map((item) => item.text);
    console.log(`[message-recall] ${user.id}: ${String(user.conversations.length)} conversations -> ${String(stored.length)} facts`);
    for (const q of user.questions) {
      const before = await scope.recall(q.query, { topK: FACT_LIST_SIZE });
      const messages = await scope.searchMessages(q.query, { limit: MESSAGE_LIST_SIZE });
      const after = await scope.recall(q.query, { topK: FACT_LIST_SIZE });
      rows.push({
        user: user.id,
        query: q.query,
        form: q.form,
        lostByExtraction: !stored.some((text) => matchesPattern(q.pattern, text)),
        messagesHit: messages.some((m) => matchesPattern(q.pattern, m.content)),
        factsHit: before.some((item) => matchesPattern(q.pattern, item.text)),
        recallUnchanged: JSON.stringify(before.map((i) => i.id)) === JSON.stringify(after.map((i) => i.id)),
        facts: stored,
        factsTop: before.map((i) => i.text),
        messages: messages.map((m) => m.content),
      });
    }
  }

  const summary = summarize(rows);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({
    config: { chatModel, embeddingModel: EMBEDDING_MODEL, messageListSize: MESSAGE_LIST_SIZE, factListSize: FACT_LIST_SIZE },
    summary,
    rows,
  }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await pool.end();
}
