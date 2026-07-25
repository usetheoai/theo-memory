/**
 * knowledge-update (#141) — deterministic RED→GREEN proof of the recall-time
 * most-recent-wins collapse. LLM-free; runs under `pnpm --filter
 * @usetheo/memory-eval test` with no key.
 *
 * RED evidence (in-test): a DEFAULT recall surfaces the STALE "27:12" value
 * first — the recency-blind bug the collapse fixes. GREEN: `recencyCollapse`
 * returns the FRESH "25:50" value, prunes the stale row, and records it as a
 * `superseded_recency` recall-trace drop.
 */
import { describe, expect, it } from 'vitest';

import { StageScoreSchema } from '../../schema.js';

import { KNOWLEDGE_UPDATE_REAL_FIXTURE } from './golden.js';
import {
  knowledgeUpdateStageScore,
  runKnowledgeUpdate,
  runRealReadTimeCounterProof,
} from './run.js';

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    ma += ai * ai;
    mb += bi * bi;
  }
  return dot / (Math.sqrt(ma) * Math.sqrt(mb));
}

describe('knowledge-update (#141) — recency-collapse fixture', () => {
  it('test_knowledge_update_recency_collapse_returns_newer_value', async () => {
    const r = await runKnowledgeUpdate();

    // RED evidence: without the collapse the STALE value out-ranks the fresh one.
    expect(r.plainTopText).toContain('27:12');
    expect(r.plainTopText).not.toContain('25:50');

    // GREEN: recencyCollapse returns the FRESH value; the stale duplicate is gone.
    expect(r.collapsedTopText).toContain('25:50');
    expect(r.collapsedIds).toHaveLength(1);

    // The older row is an auditable superseded_recency recall-trace drop (Princípio 3).
    expect(r.supersededRecencyDrop).toBe(true);
  });

  it('emits a valid StageScore (accuracy 1 — RED→GREEN proven, non-vacuous)', async () => {
    const score = await knowledgeUpdateStageScore();
    expect(() => StageScoreSchema.parse(score)).not.toThrow();
    expect(score.stage).toBe('knowledge-update');
    expect(score.n).toBe(1);
    expect(score.accuracy).toBe(1);
  });
});

describe('knowledge-update-supersession (#144, M23) — real strings, keyless', () => {
  // T1 empirical grounding — the REAL different-wording pair is cosine-FAR, so the
  // M22 read-time recencyCollapse (cosine@0.9) STRUCTURALLY cannot collapse them.
  it('test_real_different_wording_cosine_far', () => {
    const f = KNOWLEDGE_UPDATE_REAL_FIXTURE;
    const cosStaleFresh = cosine(f.older.embedding, f.newer.embedding);
    // "personal best" ↔ "PB": far below the 0.9 recencyCollapse threshold.
    expect(cosStaleFresh).toBeGreaterThan(0.4);
    expect(cosStaleFresh).toBeLessThan(0.6);
    expect(cosStaleFresh).toBeLessThan(0.9);
    // The STALE value out-ranks the FRESH one for the query (the #141/#144 bug):
    // cos(query, stale) > cos(query, fresh).
    const cosQueryStale = cosine(f.query5kEmbedding, f.older.embedding);
    const cosQueryFresh = cosine(f.query5kEmbedding, f.newer.embedding);
    expect(cosQueryStale).toBeGreaterThan(cosQueryFresh);
  });

  // T2 case 1 — the honest read-time COUNTER-PROOF the M22 fixture lacked: with the
  // real pair, recencyCollapse leaves the STALE "27:12" present (read-time cannot fix
  // the different-wording knowledge-update; only reflect-time supersession can — see
  // supersession.pg.test.ts).
  it('test_readtime_recencycollapse_still_returns_stale', async () => {
    const proof = await runRealReadTimeCounterProof();
    expect(proof.staleStillPresent).toBe(true); // RED for read-time: stale survives.
    expect(proof.freshPresent).toBe(true); // both remain — no collapse happened.
    expect(proof.collapsedTexts.length).toBe(2);
  });
});
