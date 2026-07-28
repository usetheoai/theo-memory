/**
 * knowledge-update (#141) — LLM-free runner for the recall-time most-recent-wins
 * collapse. Mirrors the extraction stage: `createLocalMemory` with the in-memory
 * store + a deterministic stub embedder, real numbers, Zod-validated result,
 * fail-closed. NO LLM key (writes use `infer: false`; StubLLM is never called).
 *
 * The runner writes the two ADD-only duplicates with an INJECTED clock (a
 * `created_at` metadata stamp, older strictly before newer), then recalls twice:
 * once WITHOUT the collapse (the recency-blind path that surfaces the stale
 * value — the #141 bug) and once WITH `recencyCollapse: {}` (the fix — the fresh
 * value survives; the older row becomes an auditable `superseded_recency` drop).
 */
import {
  createLocalMemory,
  InMemoryVectorStore,
  StubLLM,
  type DisposableMemory,
  type Embedder,
  type RecallTraceBatch,
  type RecallTraceStore,
} from '@usetheo/memory';

import { StageScoreSchema, type StageScore } from '../../schema.js';

import { KNOWLEDGE_UPDATE_FIXTURE, KNOWLEDGE_UPDATE_REAL_FIXTURE } from './golden.js';
import { realFixtureEmbedder } from './supersession-support.js';

/** Maps each fixture text to its hand-chosen vector; any other text → probe vector. */
function fixtureEmbedder(): Embedder {
  const f = KNOWLEDGE_UPDATE_FIXTURE;
  const byText = new Map<string, readonly number[]>([
    [f.older.text, f.older.embedding],
    [f.newer.text, f.newer.embedding],
    [f.query, f.queryEmbedding],
  ]);
  const embedOne = (text: string): readonly number[] => byText.get(text) ?? f.probeEmbedding;
  return {
    embed: (text) => Promise.resolve(embedOne(text)),
    embedBatch: (texts) => Promise.resolve(texts.map(embedOne)),
  };
}

export interface KnowledgeUpdateResult {
  /** Top result text of a DEFAULT recall (no collapse) — expected to be the STALE value. */
  readonly plainTopText: string;
  /** Top result text WITH `recencyCollapse` — expected to be the FRESH value. */
  readonly collapsedTopText: string;
  /** Result ids WITH collapse — expected to be exactly one (the stale row pruned). */
  readonly collapsedIds: readonly string[];
  /** Whether the collapse recorded a `superseded_recency` recall-trace drop. */
  readonly supersededRecencyDrop: boolean;
}

export async function runKnowledgeUpdate(): Promise<KnowledgeUpdateResult> {
  const f = KNOWLEDGE_UPDATE_FIXTURE;
  const dropReasons: string[] = [];
  const trace: RecallTraceStore = {
    record: (batch: RecallTraceBatch) => {
      for (const row of batch.rows) dropReasons.push(row.dropReason);
      return Promise.resolve();
    },
    getByRecallId: () => Promise.resolve([]),
  };

  const memory = (await createLocalMemory({
    vectorStore: new InMemoryVectorStore(),
    embedder: fixtureEmbedder(),
    llm: new StubLLM(),
    embeddingDim: f.embeddingDim,
    recallTrace: trace,
  }));

  try {
    const scope = memory.user('kb_update');
    // Injected clock: older strictly before newer (distinct `created_at`).
    await scope.remember(f.older.text, { infer: false, metadata: { created_at: f.older.createdAt } });
    await scope.remember(f.newer.text, { infer: false, metadata: { created_at: f.newer.createdAt } });

    const plain = await scope.recall(f.query);
    const collapsed = await scope.recall(f.query, { recencyCollapse: {} });

    return {
      plainTopText: plain[0]?.text ?? '',
      collapsedTopText: collapsed[0]?.text ?? '',
      collapsedIds: collapsed.map((m) => m.id),
      supersededRecencyDrop: dropReasons.includes('superseded_recency'),
    };
  } finally {
    await memory.dispose();
  }
}

/**
 * StageScore adapter for the eval CLI/regression gate. `accuracy = 1` ONLY when
 * the fixture is non-vacuous: the default recall surfaces the STALE value (the
 * bug is present) AND the collapse surfaces the FRESH value with the older row
 * pruned as a `superseded_recency` drop (the fix works). Any deviation → 0.
 */
export interface RealReadTimeCounterProof {
  /** Texts returned by `recall({ recencyCollapse: {} })` over the REAL fixture. */
  readonly collapsedTexts: readonly string[];
  /** True when the STALE "27:12" value is STILL present after recencyCollapse. */
  readonly staleStillPresent: boolean;
  /** True when the FRESH "25:50" value is present. */
  readonly freshPresent: boolean;
}

/**
 * knowledge-update-supersession (#144, M23) — the honest READ-TIME COUNTER-PROOF the
 * M22 fixture lacked. In-memory, keyless, real strings + FROZEN real embeddings
 * (cos(older,newer)=0.5117 ≪ 0.9). `recall({ recencyCollapse: {} })` CANNOT collapse
 * the different-wording pair, so the STALE "27:12" survives — proving read-time collapse
 * structurally cannot fix the #144 case (only reflect-time LLM supersession can).
 */
export async function runRealReadTimeCounterProof(): Promise<RealReadTimeCounterProof> {
  const f = KNOWLEDGE_UPDATE_REAL_FIXTURE;
  const memory = (await createLocalMemory({
    vectorStore: new InMemoryVectorStore(),
    embedder: realFixtureEmbedder(),
    llm: new StubLLM(),
    embeddingDim: f.embeddingDim,
  }));

  try {
    const scope = memory.user('m23_readtime');
    await scope.remember(f.older.text, { infer: false, metadata: { created_at: f.older.createdAt } });
    await scope.remember(f.newer.text, { infer: false, metadata: { created_at: f.newer.createdAt } });

    const collapsed = await scope.recall(f.query5k, { recencyCollapse: {} });
    const collapsedTexts = collapsed.map((m) => m.text);
    return {
      collapsedTexts,
      staleStillPresent: collapsedTexts.some((t) => t.includes('27:12')),
      freshPresent: collapsedTexts.some((t) => t.includes('25:50')),
    };
  } finally {
    await memory.dispose();
  }
}

export async function knowledgeUpdateStageScore(): Promise<StageScore> {
  const start = Date.now();
  const r = await runKnowledgeUpdate();
  const bugPresent = r.plainTopText.includes('27:12');
  const fixed =
    r.collapsedTopText.includes('25:50') && r.collapsedIds.length === 1 && r.supersededRecencyDrop;
  const accuracy = bugPresent && fixed ? 1 : 0;
  return StageScoreSchema.parse({
    stage: 'knowledge-update',
    precision: accuracy,
    recall: accuracy,
    accuracy,
    n: 1,
    runtimeMs: Date.now() - start,
  });
}
