/**
 * Tokenizer DIP — token-counting contract for cost-tracking + prompt budgeting.
 *
 * supersedes Drift-T4.1-1 which said "2 consumers, rule-of-three not
 * reached"). Consumer count grew to 6 production + 5 test during the v0.8
 * `T6.1` + `T6.2` + `T6.3` vendor-adapter rollout, crossing the rule of
 * structurally depending on a sibling vendor adapter's exported interface).
 *
 * MOVE-only refactor per v0-8-fixes-cycle-1 ADR D3: interface body
 * verbatim from the prior inline declaration; zero behavior change.
 *
 * @see plan v0-8-fixes-cycle-1 § T3.1 + ADR D3 (MOVE-only)
 */

export interface Tokenizer {
  count(text: string): number;
}
