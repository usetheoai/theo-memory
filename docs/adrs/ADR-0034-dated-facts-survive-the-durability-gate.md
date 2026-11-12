# ADR-0034: A stated fact dated to a calendar period is kept by the durability gate

Status: Withdrawn (2026-11-12, the defect did not reproduce on its validation sets; see Outcome)

## Context

`prepareExtractedEvidence` drops every extracted draft whose `evidence.durability` is not
`durable` (ADR-0025). The rule is meant to keep passing moods and undecided trials out of long-term
memory ("feels like wearing green just for this morning"). The label comes from the extractor, and
it also marks as `temporary` a dated past event whose duration was short (#245):

| Input | Draft | durability |
|---|---|---|
| `Ines visited Seville for a weekend in March 2024.` | `Ines visited Seville for a weekend in March 2024` | temporary |
| `Ines visited Granada for a weekend in May 2024.` | `Ines visited Granada for a weekend in May 2024` | temporary |

Both are dropped in every write run, so "Which city did Ines visit in March 2024?" has no memory to
find. The model reads the length of the event ("a weekend") as the time the fact stays true.

Three earlier attempts on #245 changed the extractor's prompt or added a type field to the draft.
All three were measured and reverted: a label the extractor gives itself in the same call moved
output in other families and still let a forbidden mood through.

## Decision

The gate keeps a draft labelled `temporary` when all of these hold:

- it is `stated`;
- its `sourceQuote` is grounded in the new input (the check the gate already makes);
- the grounded quote names an absolute calendar period: a year after a temporal preposition, a month
  with its year, or a quarter with its year, read by the same `periodAnchors` that the supersession
  period guard uses (#252), in English, Portuguese, Spanish, Italian, French and German. A period introduced by "since" does
  not count.

Such a draft is kept, and the gate emits `extraction_evidence_kept_dated`. Every other non-durable
draft is dropped as today. `tentative` drafts are always dropped: a dated plan someone is unsure
about ("maybe in May 2025") stays out.

The reason is semantic, not a fit to a case. "Short-lived" in ADR-0025 means a fact that is true now
and stops being true later. A statement scoped to a stated period does not stop being true: "Ines
visited Seville in March 2024" is as true next year as today. The anchor comes from the user's own
words, which the gate has already checked, not from the extractor's label.

## Consequences

- Dated past events and dated measurements labelled `temporary` reach the store.
- A passing state the user dates ("I had a cold in January 2024") is kept too. It is a true
  historical statement scoped to its period; recall can still rank it.
- Plans with a relative day ("on Thursday"), ongoing states ("has been sneezing") and advice stay
  dropped. They are part of #245 and are not addressed here.
- The three evaluation sets that guard the gate (`memory-semantics`, `extraction-fidelity`,
  `message-recall`) contain no absolute anchor, so the rule cannot change their results. The
  validation below needs its own case set.

## Validation

On a case set committed before any run, against the current code, three runs per arm: dated facts
the extractor labels `temporary` become answerable; facts the current code answers stay answered;
anchored tentative statements stay out of the store. The criteria are fixed in the benchmark log
before the first run.

## Alternatives

- A prompt rule or a fact type on the draft. Measured three times and reverted (#245).
- Keep every `stated`, grounded draft regardless of durability. Simulated offline on the
  `memory-semantics` drafts: it would store 7 forbidden moods and 11 suggestions attributed to the
  user.
- A relative anchor ("today", "on Thursday") as the signal. Passing moods carry relative anchors as
  often as plans do ("just for this morning"), so it does not separate them.

## Outcome

Withdrawn before implementation. The validation required the current code to lose dated facts
first. On two case sets committed before any run, it did not: `judge-cases-dated.json` (events
months or years before the observation) and `judge-cases-dated-recent.json` (events observed a few
days after they happened, as in the failing case). Three runs each, 30 dated questions per run,
answered 30 of 30 in every run. The extractor labelled every dated event `durable`.

The two failing facts in `judge-cases-period.json` are the only ones measured, and that user has
other memories that the extractor sees in its prompt. A fix for a defect that two case sets of its
own could not reproduce would not be validated by anything. #245 stays open for the plans, ongoing
states and advice it lists.

