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

import { knowledgeUpdateStageScore, runKnowledgeUpdate } from './run.js';

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
