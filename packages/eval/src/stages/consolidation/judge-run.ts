/**
 * Live evaluation of the LLM-judged consolidation in `reflect` (#237). Writes hand-written facts
 * verbatim (no extraction) with their observation time into an isolated Postgres database, runs
 * `reflect({ conflictResolution: LlmJudgedMergeConflictPolicy })` per user, and reports:
 * which distinct facts were invalidated (each one is real memory erased), which updates were
 * resolved, missed or resolved the wrong way, and, per question, whether the answer and the stale
 * value are in the fact list before and after reflect (with `asOf` where the question names a
 * past instant).
 *
 * Required env: OPENAI_API_KEY, OPENAI_CHAT_MODEL, CONSOLIDATION_JUDGE_OUT (report path).
 * Optional: THEOMEM_PG_URI (admin URI), CONSOLIDATION_JUDGE_DB, CONSOLIDATION_JUDGE_CASES (case
 * file in this directory, default judge-cases.json).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import pg from 'pg';
import { z } from 'zod';

import { createLocalMemory, LlmJudgedMergeConflictPolicy, PgvectorStore, runMigrations } from '@usetheo/memory';
import { OpenAICompatibleEmbedder } from '@usetheo/memory/embedders/openai-compatible';
import { OpenAILLM } from '@usetheo/memory/llms/openai';

/** Fixed before measuring: Principle 2 asks for short lists. */
const FACT_LIST_SIZE = 5;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

const factSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  observedAt: z.string().date(),
  role: z.enum(['distinct', 'old', 'new']),
  update: z.string().optional(),
  loggedOutOfOrder: z.boolean().optional(),
});
const questionSchema = z.object({
  query: z.string().min(1),
  pattern: z.string().min(1),
  stalePattern: z.string().optional(),
  asOf: z.string().date().optional(),
});
const casesSchema = z.object({
  users: z.array(z.object({ id: z.string().min(1), facts: z.array(factSchema), questions: z.array(questionSchema) })),
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const outPath = requiredEnv('CONSOLIDATION_JUDGE_OUT');
const apiKey = requiredEnv('OPENAI_API_KEY');
requiredEnv('OPENAI_CHAT_MODEL');
const adminUri = process.env['THEOMEM_PG_URI'] ?? 'postgresql://themem:themem@localhost:5442/themem';
const dbName = process.env['CONSOLIDATION_JUDGE_DB'] ?? 'themem_consolidation_judge';
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`CONSOLIDATION_JUDGE_DB must be a plain identifier, got '${dbName}'`);

const caseFile = process.env['CONSOLIDATION_JUDGE_CASES'] ?? 'judge-cases.json';
if (!/^judge-cases[a-z-]*\.json$/.test(caseFile)) throw new Error(`CONSOLIDATION_JUDGE_CASES names an unexpected file: '${caseFile}'`);
const cases = casesSchema.parse(JSON.parse(readFileSync(new URL(`./${caseFile}`, import.meta.url), 'utf8')));
for (const user of cases.users) {
  const updates = new Map<string, string[]>();
  for (const f of user.facts) {
    if (f.role === 'distinct') continue;
    if (f.update === undefined) throw new Error(`${user.id}/${f.key}: an update fact needs 'update'`);
    updates.set(f.update, [...(updates.get(f.update) ?? []), f.role]);
  }
  for (const [name, roles] of updates) {
    if (roles.sort().join() !== 'new,old') throw new Error(`${user.id}: update '${name}' needs exactly one old and one new fact`);
  }
}

const matches = (pattern: string, text: string): boolean => new RegExp(pattern, 'i').test(text);

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
  const embedder = new OpenAICompatibleEmbedder({ apiKey, baseUrl: 'https://api.openai.com/v1', model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIM });
  const llm = new OpenAILLM();
  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: EMBEDDING_DIM }),
    embedder,
    llm,
    embeddingDim: EMBEDDING_DIM,
  });
  const policy = new LlmJudgedMergeConflictPolicy({ llm });

  const facts: { user: string; key: string; role: string; update: string | undefined; outOfOrder: boolean; invalidated: boolean }[] = [];
  /** distinct: about a distinct fact; current / asOf-before-change / asOf-after-change: about an update. */
  type QuestionKind = 'distinct' | 'current' | 'asOf-before-change' | 'asOf-after-change';
  const questions: {
    user: string; query: string; asOf: string | undefined; kind: QuestionKind;
    before: { answer: boolean; stale: boolean; top: string[] };
    after: { answer: boolean; stale: boolean; top: string[] };
  }[] = [];
  const reflections: { user: string; derived: number; decisions: unknown[] }[] = [];

  const ask = async (scope: ReturnType<typeof memory.user>, q: z.infer<typeof questionSchema>) => {
    const items = await scope.recall(q.query, { topK: FACT_LIST_SIZE, ...(q.asOf === undefined ? {} : { asOf: new Date(`${q.asOf}T12:00:00Z`) }) });
    const top = items.map((i) => i.text);
    return {
      answer: top.some((t) => matches(q.pattern, t)),
      stale: q.stalePattern !== undefined && top.some((t) => matches(q.stalePattern!, t)),
      top,
    };
  };

  for (const user of cases.users) {
    const scope = memory.user(user.id);
    const ids = new Map<string, string>();
    // File order is the logging order: an update marked loggedOutOfOrder lists its newer fact first.
    for (const f of user.facts) {
      const [item] = await scope.remember(f.text, { infer: false, observedAt: new Date(`${f.observedAt}T12:00:00Z`) });
      if (item === undefined) throw new Error(`${user.id}/${f.key}: remember stored nothing`);
      ids.set(f.key, item.id);
    }
    const before = await Promise.all(user.questions.map((q) => ask(scope, q)));
    const historyBefore = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM consolidation_history');
    const result = await scope.reflect({ conflictResolution: policy });
    const decisions = await pool.query(
      'SELECT kept_memory_id, rejected_memory_ids, reason FROM consolidation_history ORDER BY created_at OFFSET $1',
      [Number(historyBefore.rows[0]!.n)],
    );
    const keyOf = new Map([...ids].map(([k, id]) => [id, k]));
    reflections.push({
      user: user.id,
      derived: result.derivedMemoriesCreated,
      decisions: decisions.rows.map((r: { kept_memory_id: string; rejected_memory_ids: string[]; reason: string }) => ({
        kept: keyOf.get(r.kept_memory_id) ?? r.kept_memory_id,
        rejected: r.rejected_memory_ids.map((id) => keyOf.get(id) ?? id),
        reason: r.reason,
      })),
    });
    const { rows } = await pool.query<{ id: string; invalid: boolean }>(
      'SELECT id::text, t_invalid IS NOT NULL AS invalid FROM memories WHERE id = ANY($1::uuid[])',
      [[...ids.values()]],
    );
    const invalid = new Map(rows.map((r) => [r.id, r.invalid]));
    for (const f of user.facts) {
      facts.push({ user: user.id, key: f.key, role: f.role, update: f.update, outOfOrder: f.loggedOutOfOrder === true, invalidated: invalid.get(ids.get(f.key)!) === true });
    }
    const after = await Promise.all(user.questions.map((q) => ask(scope, q)));
    const oldTexts = user.facts.filter((f) => f.role === 'old').map((f) => f.text);
    const kindOf = (q: z.infer<typeof questionSchema>): QuestionKind => {
      if (q.stalePattern === undefined) return 'distinct';
      if (q.asOf === undefined) return 'current';
      return oldTexts.some((t) => matches(q.stalePattern!, t)) ? 'asOf-after-change' : 'asOf-before-change';
    };
    user.questions.forEach((q, i) => questions.push({ user: user.id, query: q.query, asOf: q.asOf, kind: kindOf(q), before: before[i]!, after: after[i]! }));
    console.log(`[consolidation-judge] ${user.id}: ${String(result.derivedMemoriesCreated)} derived, ${String(decisions.rowCount ?? 0)} decisions`);
  }

  const distinct = facts.filter((f) => f.role === 'distinct');
  const updateNames = [...new Set(facts.filter((f) => f.update !== undefined).map((f) => `${f.user}/${f.update!}`))];
  const updates = updateNames.map((name) => {
    const pair = facts.filter((f) => `${f.user}/${f.update ?? ''}` === name);
    const old = pair.find((f) => f.role === 'old')!;
    const recent = pair.find((f) => f.role === 'new')!;
    const outcome = recent.invalidated ? 'wrong-direction' : old.invalidated ? 'resolved' : 'missed';
    return { name, outOfOrder: old.outOfOrder, outcome };
  });
  const count = (xs: readonly { outcome: string }[], outcome: string) => xs.filter((x) => x.outcome === outcome).length;
  const byKind = (kind: QuestionKind) => {
    const xs = questions.filter((q) => q.kind === kind);
    return {
      total: xs.length,
      answerBefore: xs.filter((q) => q.before.answer).length, answerAfter: xs.filter((q) => q.after.answer).length,
      staleBefore: xs.filter((q) => q.before.stale).length, staleAfter: xs.filter((q) => q.after.stale).length,
    };
  };
  const summary = {
    distinctInvalidated: { count: distinct.filter((f) => f.invalidated).length, total: distinct.length, keys: distinct.filter((f) => f.invalidated).map((f) => `${f.user}/${f.key}`) },
    updatesInOrder: { resolved: count(updates.filter((u) => !u.outOfOrder), 'resolved'), missed: count(updates.filter((u) => !u.outOfOrder), 'missed'), wrongDirection: count(updates.filter((u) => !u.outOfOrder), 'wrong-direction'), total: updates.filter((u) => !u.outOfOrder).length },
    updatesOutOfOrder: { resolved: count(updates.filter((u) => u.outOfOrder), 'resolved'), missed: count(updates.filter((u) => u.outOfOrder), 'missed'), wrongDirection: count(updates.filter((u) => u.outOfOrder), 'wrong-direction'), total: updates.filter((u) => u.outOfOrder).length },
    questions: {
      distinct: byKind('distinct'),
      current: byKind('current'),
      asOfBeforeChange: byKind('asOf-before-change'),
      asOfAfterChange: byKind('asOf-after-change'),
    },
    answerLostByReflect: questions.filter((q) => q.before.answer && !q.after.answer).map((q) => `${q.user}: ${q.query}`),
    derived: reflections.reduce((n, r) => n + r.derived, 0),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ caseFile, model: process.env['OPENAI_CHAT_MODEL'], factListSize: FACT_LIST_SIZE, summary, updates, facts, questions, reflections }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await pool.end();
}
