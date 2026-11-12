# ADR-0035: Every extracted fact is stored, and event time decides what recall shows

Status: Proposed (2026-11-12). Each stage below becomes Accepted when its experiment passes and is
withdrawn when it fails; the criteria are written before each run and do not change after it.

## Context

`prepareExtractedEvidence` drops every extracted draft whose `evidence.durability` is not `durable`
(ADR-0025). The rule keeps passing moods out of long-term memory. It also drops stated plans, dated
events and advice between people (#245): 5 of 15 plan cases and 5 of 12 suggestion cases of the
extraction-fidelity set are stored on `b42a017`.

Six attempts to narrow the drop were measured and reverted. The last one kept a non-durable draft
unless its `category` was `preferences`. It passed every criterion written for it and was still
withdrawn, for three reasons found afterwards:

- The label is repeatable and still wrong for the purpose. On 24 new sentences extracted 5 times
  each, the pair (category, durability) was identical in 23 cases, and "I am very sleepy right now"
  came back as `health` in all 5 runs while advice to swap coffee for mint tea came back as
  `preferences` (Observed, H175).
- A drop at write time cannot be undone, and no reference system read in source drops by category.
  Graphiti stores a plan as valid from the moment it was said and keeps the future date in the fact;
  Mem0 extracts when in doubt and hides by a caller-supplied expiration date at read time
  (Reported, source read at named commits).
- The approval method was weak. A floor of "at least 9 of 12" passes a 65% system one time in three
  (Inferred, binomial calculation).

Two more findings shape the decision:

- A stale version of a fact beside the current one is the expensive distractor: one study reports
  accuracy falling from 100% to 44.6% on a small model, while unrelated statements cost nothing
  (Reported, arXiv 2610.36308, read in part). Printing a validity interval next to the stale fact
  is not shown to be enough.
- Small models are weak at calendar arithmetic (Reported, several benchmarks; no direct measurement
  of `gpt-4o-mini` on relative weekdays was found). Today the extractor resolves relative dates
  itself against `observedAt`, and the resolved date lives only in the fact text.

Backward compatibility is not a constraint: the owner allows schema and contract changes.

## Decision

The write path stops deciding what is worth remembering by a model label. It records what was said,
when the event is, and how long the statement is expected to hold. Recall decides what to show.

### Stage 1: write

- Every grounded, stated draft is stored. `durability` becomes an attribute of the memory. The
  durable-only gate of ADR-0025 is removed; ADR-0025 is superseded when this stage is accepted.
- A memory gains a typed event time: start, end and granularity (instant, day, week, month, year,
  unknown), plus the temporal expression as it was said.
- The extractor copies the temporal expression and classifies the statement as plan, past event or
  state. Code resolves the expression against `observedAt`. The model no longer does the calendar
  arithmetic.
- `t_valid` is `observedAt` for a plan too. A future date never becomes `t_valid` or `t_invalid`.
- `expires_at` is derived for a state said with a marker of the moment ("today", "right now",
  "this afternoon"): the end of the period the marker names. A plan or a past event gets no
  `expires_at`.
- Each derivation emits an event; a draft that is dropped is dropped only for the reasons that
  remain (ungrounded quote, not stated), with the existing events.

### Stage 2: read

- Default recall excludes rows whose `expires_at` is before the query clock, and rows with a closed
  `t_invalid`, as it does today. The query clock is `asOf` when given. `recall({ asOf })` still
  reaches an expired state. Each exclusion is counted in an event.
- Before the top-K cut, candidates that are versions of the same subject and attribute collapse to
  the latest valid one, so a stale version never takes a slot beside the current one.
- Recency decay uses a half-life per durability class and is anchored on the event time or
  `observedAt`. A recall does not renew it. Eviction stops reading `last_accessed_at` as recency for
  short-lived memories.

### Stage 3: plan lifecycle

- The status of a plan is computed at read time: pending while its event time is after the query
  clock; past with unknown outcome when it is before and nothing later refers to it; cancelled,
  rescheduled or done when a later statement says so.
- Nothing is rewritten when a date passes. A cancellation, a new date or a confirmation is a new
  fact that points to the plan; a cancellation or a new date closes the plan's `t_invalid`.
- Recall presents a plan with its event date and its status.

### Stage 4: recalled value

- The extracted fact stays the unit of search, deduplication, validity and invalidation.
- Whether recall returns the fact, the source round, or both is decided by an ablation with the
  production extractor. Three studies report a loss when only the fact reaches the reader
  (Reported: LongMemEval sections 5.2 and 5.3, TriMem, arXiv 2603.02473); none used our extractor,
  and none reports an interval.

## How each stage is approved

Every comparison runs base and arm in the same batch on the same questions and is read with
`comparePaired` (exact sign test on per-question wins, Wilson interval per side). The case sets are
written before the change they judge, by a generator frozen beforehand or by someone who does not
write the change, and each has at least 100 questions. Cases used to design a rule become regression
tests and stop counting as evidence for it. LoCoMo and LongMemEval are not used to choose anything
in this ADR.

| Stage | Case set | Refuted when |
|---|---|---|
| 1 | Date resolution in six languages, exact date as the answer | resolution in code does not beat resolution by the model in the paired comparison |
| 1 | Plans, dated events and advice; momentary states; durable controls | plans and events do not gain, or the durable controls lose |
| 2 | Attribute with a stale version, with a top-K sweep | excluding the stale version does not lower the rate of answers that use it |
| 2 | Momentary state asked after its window, and with `asOf` | the expired state is still used in default recall, or `asOf` no longer reaches it |
| 2 | Questions with no time component | the filters or the decay cost answers there |
| 3 | The same plan asked before and after its date, under three histories: no follow-up, cancelled, confirmed | after the date the reader still says the event will happen, or that it happened with no confirmation, at the base rate |
| 4 | Single-session detail, assistant statement, cross-session, temporal | fact plus source does not beat fact on the first two, or loses on temporal |

An LLM judge is used only after calibration against about 200 answers labelled by people who did not
write the change (100 per class), with sensitivity and specificity reported beside each result.

## Consequences

- More rows are stored. The earlier measurement saw secondary-detail facts go from 17 to 33 on one
  family. Stage 2 has to hold recall quality on the durable controls, or stage 1 is withdrawn.
- A wrong durability label now costs a wrong window, which `asOf` can still reach, where today it
  costs the fact.
- The schema changes (event time columns, the temporal expression, a statement class). Existing rows
  carry no event time and are treated as unknown granularity.
- Linking a later statement to the right plan is the riskiest part with a small model. One paper
  reports most updated tasks lost by small models, on about 9 cases (Reported, arXiv 2609.01272).
  Stage 3 measures the linking on its own, with two or more plausible plans per person.

## What is inference here

No source measures these, and the experiments above exist to settle them: the split where the model
copies the expression and code resolves it; excluding a stale version against showing it labelled;
the state "past with unknown outcome"; fact plus source with a strong extractor.

## Alternatives considered

- Keep the drop and narrow it by a label (six attempts, all reverted). Rejected: the label does not
  separate a moment from a fact, and the drop is not reversible.
- Let the caller supply an expiration date, as Mem0 does. Rejected as the only mechanism: the caller
  of `remember` usually does not know which sentence is a passing state.
- Store plans as Graphiti does, with the date in the text only. Rejected: a date that is not typed
  cannot filter, order or derive a status without asking a model again.
