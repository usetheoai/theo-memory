/**
 * Live check of recall-time recency collapse on hand-written pairs (#249). For each pair, the
 * older and the newer fact are stored verbatim in a fresh in-memory scope with real embeddings,
 * their creation times set at the adapter seam, and `recall({ recencyCollapse: {} })` is asked for
 * the older text. An update pair should come back as the newer fact alone; a distinct-event pair
 * must keep both. Criteria H34 to H36 are fixed in docs/benchmarks/m30-longmemeval-local.md
 * before the code change.
 *
 * Required env: OPENAI_API_KEY, COLLAPSE_PAIRS_OUT (report path).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

import { createLocalMemory, InMemoryVectorStore, StubLLM, type Embedder } from '@usetheo/memory';
import { OpenAICompatibleEmbedder } from '@usetheo/memory/embedders/openai-compatible';

const EMBEDDING_DIM = 1536;
const pairSchema = z.object({ older: z.string().min(1), newer: z.string().min(1) });
const pairs = z.object({ updates: z.array(pairSchema).min(1), distinct: z.array(pairSchema).min(1) })
  .parse(JSON.parse(readFileSync(new URL('./collapse-pairs.json', import.meta.url), 'utf8')));

const outPath = process.env['COLLAPSE_PAIRS_OUT'];
const apiKey = process.env['OPENAI_API_KEY'];
if (outPath === undefined || outPath === '' || apiKey === undefined || apiKey === '') {
  throw new Error('COLLAPSE_PAIRS_OUT and OPENAI_API_KEY are required');
}
const provider = new OpenAICompatibleEmbedder({ apiKey, baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', dimensions: EMBEDDING_DIM });
// Each text is embedded once; recall embeds the stored texts again, so the cache keeps it cheap.
const cache = new Map<string, readonly number[]>();
const embedder: Embedder = {
  embed: async (text) => (await embedder.embedBatch([text]))[0]!,
  embedBatch: async (texts) => {
    const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
    if (missing.length > 0) (await provider.embedBatch(missing)).forEach((v, i) => cache.set(missing[i]!, v));
    return texts.map((t) => cache.get(t)!);
  },
};

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return dot / Math.sqrt(na * nb);
}

async function collapses(pair: z.infer<typeof pairSchema>) {
  const vectorStore = new InMemoryVectorStore();
  const memory = await createLocalMemory({ vectorStore, embedder, llm: new StubLLM(), embeddingDim: EMBEDDING_DIM, entityBoost: false, messageLog: false });
  try {
    const scope = memory.user('pairs');
    const stamps = ['2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'];
    for (const [index, text] of [pair.older, pair.newer].entries()) {
      const [saved] = await scope.remember(text, { infer: false });
      const row = await vectorStore.get(saved!.id);
      await vectorStore.update(saved!.id, [...(await embedder.embed(text))], { ...row!.payload, created_at: stamps[index]! });
    }
    const texts = (await scope.recall(pair.older, { recencyCollapse: {} })).map((m) => m.text);
    const [a, b] = await embedder.embedBatch([pair.older, pair.newer]);
    return { ...pair, cosine: cosine(a!, b!), returned: texts, collapsedToNewer: texts.length === 1 && texts[0] === pair.newer };
  } finally {
    await memory.dispose();
  }
}

const updates = [];
for (const pair of pairs.updates) updates.push(await collapses(pair));
const distinct = [];
for (const pair of pairs.distinct) distinct.push(await collapses(pair));
const TAU = 0.9;
const updatesAboveTau = updates.filter((u) => u.cosine >= TAU);
const summary = {
  h34: { wrongMerges: distinct.filter((d) => d.returned.length < 2).length, total: distinct.length },
  h35: { collapsed: updatesAboveTau.filter((u) => u.collapsedToNewer).length, aboveTau: updatesAboveTau.length, total: updates.length },
};
const verdict = { ...summary, h34Pass: summary.h34.wrongMerges === 0, h35Pass: summary.h35.collapsed === summary.h35.aboveTau };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ verdict, updates, distinct }, null, 2));
console.log(JSON.stringify(verdict, null, 2));
