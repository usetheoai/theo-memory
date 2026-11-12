# ADR-0033: Supersession on write is confirmed by a separate check

Status: Proposed

## Context

Supersession on write (ADR-0029) lets the extractor list existing memories a new fact replaces,
and the write invalidates them. The extractor lists more than real updates (#252):

- a fact about another period: "Oscar donated blood 3 times in 2023" replaced by "5 times in 2024";
- another occurrence of an event: a gran fondo in May and another in September;
- another attribute of the same subject: "Rafael's daughter is named Clara" replaced by "Rafael
  switched accountants".

The invalidated fact drops out of current recall. It is a true fact the user stated, lost without
any error.

Two attempts that relied on the extraction call failed. A `state`/`event` label written by the
extractor in the same call let a cross-attribute replacement through and shifted the language of
an unrelated fact. A period guard (de8f16b) refuses a replacement when the two texts name periods
that cannot overlap. It removed every period loss on its case set, but it reads periods from the
text: a year used as an adjective ("the 2023 Douro competition") escapes it, and it cannot see a
cross-attribute replacement at all. The lesson recorded on #252 and #245 is that a label the
extractor gives itself in the same call is not a reliable gate.

## Decision

After the period guard, every replacement the extractor proposes goes to one verification call
per write. It is a separate call that sees only the two texts of each pair, the older A and the
newer B, never the conversation or the extraction draft. For each pair it answers `replaces` when B
gives a new value of the same attribute of the same subject that A describes, so that A is no
longer true (a new address, employer, price or schedule, or a correction of A). It answers `both`
when the two can be true together: different periods, different occurrences of an event, or
different attributes.

Only pairs answered `replaces` are invalidated. A pair answered `both` is refused with
`supersession_rejected` and reason `not_confirmed`. The check fails closed. When the call fails or
the answer is malformed, no pair of that write is invalidated, and `supersession_rejected` has
reason `unverified`. Keeping a stale value next to its update is recoverable and visible, since both
are recalled and `history` has both. Invalidating a true fact is silent.

The period guard stays in front of the check. It costs nothing, and it refuses the period pairs
before any call.

## Evidence before the decision

A development probe used the 84 distinct pairs that earlier runs on the consolidation case sets
superseded (`judge-cases.json`, `-multi`, `-period`, `-anchor`), labelled by hand as 49 real
updates and 35 wrong replacements. It asked `gpt-4o-mini`, one pair per call, the question above.
It kept 47 of the 49 updates and refused 33 of the 35 wrong ones. The two updates it refused are a
scooter fact whose subject the extractor had already swapped (#257: "user owns ..." against "Hana
owns ..."), so refusing them is defensible. Of the two wrong pairs it let through, the period guard
already refuses one (April 2023 against April 2024). The other is the adjective year ("the 2023
Douro competition" against "the 2024 Douro competition"). These sets were used before, so the
probe motivates the decision and does not validate it.

## Consequences

- A write whose extraction proposes no replacement costs nothing extra. A write that proposes some
  costs one call, for all its pairs.
- Every refusal is an event with its reason, so an update the check wrongly refuses is visible.
- The prompt of the check is generic and written from the definition in ADR-0029. It names no case
  and is not tuned on a case set.
- The reflect judge (#237) makes the same confusion. It is out of scope here, but the same check
  could serve it.

## Validation

On a case set committed before any run, against the current code, three runs per arm: distinct
facts lost to supersession at 0 in every run; updates in order still resolved, with no stale value
in the top-5 of current answers beyond the current code's; `asOf` answers unchanged; extra LLM calls
reported. The criteria are fixed in the benchmark log before the first run.

## Alternatives

- A label from the extraction call (`state`/`event`). Measured and reverted (#252).
- Only the period guard. In place, but blind to cross-attribute replacements and adjective years.
- A validity interval stored as data for every fact, with replacement allowed only between facts
  whose intervals and relation match. It would also settle the dated correction ("born in 2015" to
  "2016"), which the period guard now refuses. It changes the write contract and the schema, and no
  measured failure needs it yet beyond that one case. Deferred.
- Embedding similarity between A and B above a threshold. A threshold would have to be fitted, and
  "3 times in 2023" and "5 times in 2024" are close in any embedding.
