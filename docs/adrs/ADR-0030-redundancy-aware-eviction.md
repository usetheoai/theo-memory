# ADR-0030: Redundancy-aware victim selection in eviction

Status: Implemented

## Context

`TriadicScoringPolicy` scores each candidate as a weighted sum of recency, access frequency and
importance, multiplied by `clamp(0.1, 1, isolation / mean_isolation)`, where isolation is the
cosine distance to the nearest live neighbour in scope. `selectVictims` then takes the bottom
fraction by score.

The multiplier protects isolated memories by penalising clustered ones, and it penalises every
member of a cluster equally. A fact the user stated several times is stored as several close
paraphrases, so all of them land at the bottom together and one pass removes the fact. In
production the other two signals rarely separate them: `llm_importance_score` is never written
(#238), and paraphrases of one fact tend to have the same access history.

Measured on a copy of a database holding 2,584 memories ingested from the 76 LongMemEval Oracle
knowledge-update questions, evicting 30% of each scope with the production policy, then
replaying recall without an LLM: the short gold answer was still in the recalled evidence for
35 of 61 questions. Random eviction of the same count kept 49 (exact McNemar p = 0.0005). In the
15 questions lost only by the policy, it had evicted 48 of the 56 memories containing the
answer, and every copy in 12 of them. The criteria were fixed before the run.

## Decision

Within one pass, a memory is not selected when its nearest neighbour is already selected, and a
memory that a selected victim names as its nearest neighbour is protected. Candidates are walked
in score order; among equal scores, memories fewer candidates point at go first, so a group of
copies keeps the one the others are nearest to. If the rule cannot fill the quota, the rest is
taken in score order: capacity stays a hard bound. No parameter was added.

The neighbour's id comes from the same query that already yields the isolation distance, through
a new optional `NearestNeighborProvider.nearest`. A provider that implements only `distance`
keeps the plain bottom-fraction selection.

On the same measurement, fixed before implementing: the corrected policy kept 48, against 35
before (p = 0.0010) and 49 for random (p = 1.0).

## Alternatives considered

- Dropping the multiplier. It is what protects isolated, rarely accessed memories (the long-tail
  guardrail test), so removing it trades this failure for the one it was added to prevent.
- Keeping the most confirmed copy of each cluster by `confirmation_count`. Exact duplicates are
  already merged on write, so paraphrases mostly carry a count of 1 and the signal would not
  separate them.
- Clustering candidates by a distance threshold and keeping one per cluster. It needs a
  threshold, and any value would be chosen against this measurement.

## Consequences

The policy no longer does worse than random on this corpus, and it does not do better: with
importance inert and no access history, it has nothing to discriminate on. Making eviction
better than chance depends on #238 and #239.

The rule looks only at each memory's single nearest neighbour. A fact with several copies can
still lose most of them in one pass. Later passes thin it further until one copy is left, and
that copy is then isolated, so the multiplier protects it.
