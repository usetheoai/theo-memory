/**
 * BLEU honest deferral (Drift-T1.1-1).
 *
 * Empirical evidence 2026-06-02 (HEAD b67035f):
 *   $ find node_modules/natural -name '*bleu*' -o -name '*Bleu*'
 *   (zero matches)
 *   $ node -e "console.log(Object.keys(require('natural')).filter(k => /Bleu/i.test(k)))"
 *   []
 *
 * `natural@8.1.x` removed BLEU entirely. Per ADR D1 of v0-8-fixes-cycle-1:
 * Option A (repair `natural.BleuScore` call) is EMPIRICALLY IMPOSSIBLE.
 * Option B (vendor inline BLEU-1, ~30 LoC) deferred to a hypothetical
 * `v0-8-bleu-vendor-cycle` IFF audience demands BLEU column post-publication.
 * Option C (defer with marker) is the locked path for this fix-up cycle.
 *
 * Honesty discipline (Inquebrável Rule 3): instead of returning a silent 0
 * (the F-tests-1 BLOCKER failure mode), `calculateBleuScore` throws
 * `BleuMetricUnavailable` carrying the marker. Any caller that still
 * reaches this code path surfaces the deferral loudly. F1 + Exact Match
 * remain as the lexical metric pair; LLM-judge remains as the semantic
 * metric.
 *
 */

export class BleuMetricUnavailable extends Error {
  constructor() {
    super(
      'Drift-T1.1-1: natural@8.x dropped BLEU entirely; F1 + Exact Match cover lexical metrics for v0.8. Re-introduction deferred to a future v0-8-bleu-vendor-cycle (Option B vendor inline) IFF audience demands BLEU column post-publication.',
    );
    this.name = 'BleuMetricUnavailable';
  }
}


export function calculateBleuScore(_prediction: string, _reference: string): never {
  throw new BleuMetricUnavailable();
}
