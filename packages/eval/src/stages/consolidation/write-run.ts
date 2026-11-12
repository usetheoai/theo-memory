/**
 * Live evaluation of supersession on write (ADR-0029) on the consolidation judge's case files.
 * Every fact is written with extraction on (`infer: true`) in the file's logging order and at its
 * `observedAt`; no reflect runs. Each question is then asked with the same top-5 recall the judge
 * runner uses, and every `supersede` row in `history` is reported with both texts.
 *
 * Env: OPENAI_API_KEY, OPENAI_CHAT_MODEL, CONSOLIDATION_WRITE_OUT (output JSON),
 * CONSOLIDATION_JUDGE_CASES (default judge-cases.json), THEOMEM_PG_URI,
 * CONSOLIDATION_WRITE_DB (default themem_consolidation_write; dropped and recreated).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { OpenAICompatibleEmbedder } from '@usetheo/memory/embedders/openai-compatible';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

import { loadJudgeCases, matches, questionKind, type JudgeQuestion, type QuestionKind } from './judge-cases.js';

const FACT_LIST_SIZE = 5;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const outPath = requiredEnv('CONSOLIDATION_WRITE_OUT');
const apiKey = requiredEnv('OPENAI_API_KEY');
requiredEnv('OPENAI_CHAT_MODEL');
const adminUri = process.env['THEOMEM_PG_URI'] ?? 'postgresql://themem:themem@localhost:5442/themem';
const dbName = process.env['CONSOLIDATION_WRITE_DB'] ?? 'themem_consolidation_write';
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`CONSOLIDATION_WRITE_DB must be a plain identifier, got '${dbName}'`);
const caseFile = process.env['CONSOLIDATION_JUDGE_CASES'] ?? 'judge-cases.json';
const cases = loadJudgeCases(caseFile);

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

  const questions: { user: string; query: string; asOf: string | undefined; kind: QuestionKind; answer: boolean; stale: boolean; top: string[] }[] = [];
  const supersessions: { user: string; replaced: string; by: string; replacedKind: string | null; byKind: string | null }[] = [];
  const memories: { user: string; text: string; factKind: string | null; current: boolean }[] = [];
  const relations: { user: string; relation: string }[] = [];
  const stored: { user: string; facts: number; memories: number; current: number }[] = [];

  const ask = async (scope: ReturnType<typeof memory.user>, q: JudgeQuestion) => {
    const items = await scope.recall(q.query, { topK: FACT_LIST_SIZE, ...(q.asOf === undefined ? {} : { asOf: new Date(`${q.asOf}T12:00:00Z`) }) });
    const top = items.map((i) => i.text);
    return { answer: top.some((t) => matches(q.pattern, t)), stale: q.stalePattern !== undefined && top.some((t) => matches(q.stalePattern!, t)), top };
  };

  for (const user of cases.users) {
    const scope = memory.user(user.id);
    const ids: string[] = [];
    // File order is the logging order: an update marked loggedOutOfOrder lists its newer fact first.
    for (const f of user.facts) {
      const items = await scope.remember(f.text, { infer: true, observedAt: new Date(`${f.observedAt}T12:00:00Z`) });
      ids.push(...items.map((i) => i.id));
    }
    const { rows: memRows } = await pool.query<{ total: string; current: string }>(
      `SELECT COUNT(*)::text AS total, COUNT(*) FILTER (WHERE t_invalid IS NULL)::text AS current FROM memories WHERE user_id = $1`,
      [user.id],
    );
    stored.push({ user: user.id, facts: user.facts.length, memories: Number(memRows[0]!.total), current: Number(memRows[0]!.current) });
    // fact_kind is read from the payload when the write path stores it (#252); null otherwise.
    const { rows: hist } = await pool.query<{ prev_text: string | null; new_text: string | null; replaced_kind: string | null; by_kind: string | null }>(
      `SELECT h.prev_text, h.new_text, m.payload->>'fact_kind' AS replaced_kind,
              (SELECT n.payload->>'fact_kind' FROM memories n WHERE n.user_id = $1 AND n.text = h.new_text LIMIT 1) AS by_kind
         FROM history h JOIN memories m ON m.id = h.memory_id
        WHERE h.event = 'supersede' AND m.user_id = $1 ORDER BY h.id`,
      [user.id],
    );
    for (const h of hist) supersessions.push({ user: user.id, replaced: h.prev_text ?? '', by: h.new_text ?? '', replacedKind: h.replaced_kind, byKind: h.by_kind });
    const { rows: mems } = await pool.query<{ text: string; fact_kind: string | null; current: boolean }>(
      `SELECT text, payload->>'fact_kind' AS fact_kind, t_invalid IS NULL AS current FROM memories WHERE user_id = $1 ORDER BY created_at`,
      [user.id],
    );
    for (const m of mems) memories.push({ user: user.id, text: m.text, factKind: m.fact_kind, current: m.current });
    // Relation labels carry the language of the input too (#254); entity names are proper names and do not.
    const { rows: rels } = await pool.query<{ relation: string }>(`SELECT relation FROM entity_edges WHERE user_id = $1 ORDER BY created_at`, [user.id]);
    for (const r of rels) relations.push({ user: user.id, relation: r.relation });
    for (const q of user.questions) {
      const result = await ask(scope, q);
      questions.push({ user: user.id, query: q.query, asOf: q.asOf, kind: questionKind(user, q), ...result });
    }
    console.log(`[consolidation-write] ${user.id}: ${String(ids.length)} memories written, ${String(hist.length)} supersessions`);
  }

  const byKind = (kind: QuestionKind) => {
    const xs = questions.filter((q) => q.kind === kind);
    return { total: xs.length, answer: xs.filter((q) => q.answer).length, stale: xs.filter((q) => q.stale).length };
  };
  const distinctMissing = questions.filter((q) => q.kind === 'distinct' && !q.answer);
  const summary = {
    questions: { distinct: byKind('distinct'), current: byKind('current'), asOfBeforeChange: byKind('asOf-before-change'), asOfAfterChange: byKind('asOf-after-change') },
    distinctMissing: distinctMissing.map((q) => ({
      question: `${q.user}: ${q.query}`,
      // A distinct answer lost to supersession: its pattern matches the text of a replaced memory.
      replacedBy: supersessions.filter((s) => s.user === q.user && matches(cases.users.find((u) => u.id === q.user)!.questions.find((x) => x.query === q.query)!.pattern, s.replaced)).map((s) => s.by),
    })),
    supersessions: supersessions.length,
    factKinds: Object.fromEntries(['state', 'event', 'none'].map((k) => [k, memories.filter((m) => (m.factKind ?? 'none') === k).length])),
    stored,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ caseFile, model: process.env['OPENAI_CHAT_MODEL'], factListSize: FACT_LIST_SIZE, summary, supersessions, memories, relations, questions }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await pool.end();
}
