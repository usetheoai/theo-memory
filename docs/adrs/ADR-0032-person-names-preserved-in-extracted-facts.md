# ADR-0032: A stored fact keeps the people its source names

Status: Rejected (2026-11-12, after two measured implementations; see Outcome)

## Context

Extraction writes each fact as free text in `memory[].text`. Who the fact is about, and whom a
named relative belongs to, live only inside that text. Two failures follow (#257):

- a fact about a named person is stored about the speaker: "Kwabena drives a Tesla Model 3."
  becomes "user drives a Tesla Model 3";
- a relative loses the person they belong to: "Ruairi's daughter Saoirse is a dentist." becomes
  "Saoirse is a dentist", and "My brother Callum is a chef." becomes "Callum is a chef".

Both make recall wrong, not just untidy: the first files a third party's fact under the user, and
the second leaves a question such as "What is Ruairi's daughter?" with nothing to match.

Three prompt rules were measured against criteria fixed before each run, on case sets committed
before any run (`judge-cases-third-person*.json`), and all three were reverted. Each removed one
form of the error and introduced another. The last one stored "user's irmã Josefina ..." for a
named third person, a relationship the message never states. The results are recorded in
`docs/benchmarks/m30-longmemeval-local.md` (H102 to H113) and on #257.

The write path already has the pieces a deterministic check needs. Each fact may carry
`evidence.sourceQuote`, which `prepareExtractedEvidence` keeps only when it is an exact excerpt of
a new message. The same extraction call returns `entities`, each with a type, `PERSON` among them.

## Decision

After extraction and evidence grounding, the write path checks each fact that has a grounded
`sourceQuote`: every word of the quote that starts with a capital letter must also occur in the
fact text (case-insensitive, whole word, possessive `'s` ignored), unless it is a first-person word
of one of the supported languages ("I", "My", "Eu", "Minha", "Je", "Mon", "Ich", "Mein", "Yo",
"Mi", "Io", "Mio", "Ik", "Mijn" and their other forms) or an article ("The", "La", "Die", "Het"
and the others). The first-person words are the ones the speaker token "user" replaces, and an
article starts many sentences capitalised and is never a name. Both lists are closed grammatical
classes per supported language (`ISO6391_TO_NAME`), written from the grammar and not from a case
set. One-letter parts of a word are elisions ("J'", "L'") and are not checked.

A fact that fails the check goes to one repair call, together with the other failing facts of the
same write. For each one the model gets the quote, the fact and the missing words. It answers
which of those words name a person (whom the fact is about, or whom a relative belongs to) and, if
any do, the fact rewritten to keep them. A lexical check cannot tell those cases apart: in
"Kwabena drives a Tesla." and in the Italian "Guido una Autobianchi." ("I drive an Autobianchi")
the first word is missing from the fact and "user" took its place. The write path keeps the fact
when the model names none of the words, and takes the rewrite when it contains every word the
model named. Only words from the missing list count as named. A rewrite that leaves out a named
word, a malformed answer and a failed call all leave the fact as it was extracted. Each checked fact emits `extraction_fact_names_checked` with `outcome`
(`repaired`, `kept`, `repair_incomplete` or `repair_failed`) and the missing words' count, never
the words. The fact is never dropped, and `remember()` never fails because of the check.

Facts without a grounded quote are unchanged. Translating the speaker token is out of scope for
this check (#258).

### Why capitalised words and not `PERSON` entities

A diagnostic run of the current code on a case set already used for #257
(`judge-cases-third-person-two.json`, one run, raw extractor answers logged) gave 66 facts, all
with a grounded quote, and 6 facts that dropped a name. A check on `PERSON` entities named in the
quote would catch 4 of the 6. The other two ("user keeps ferrets", "Prue grows dahlias") came with
the person missing from `entities`. A check on capitalised words catches all 6. Without the
first-person list it would also fire on 18 correct first-person facts ("I drive a Polestar." stored
as "user drives a Polestar"). With the list, it fires on none of them in that run.

## Consequences

- A swap or a lost owner can no longer reach the store silently. Every repair is visible as an
  event, which `MEMORY_EVENTS` gains.
- The common path costs nothing: no extra call when the check passes. A write with failing facts
  costs one repair call.
- The check depends on the extractor quoting the source. A fact with an ungrounded quote passes
  through as today.
- A capitalised word that is not a name (a German noun, a product, a place) also has to survive.
  When the fact paraphrases it, the check fires and costs a repair call that was not needed. The
  measurement below reports how often the check fires.
- A first-person word that is also a name ("Mia" in Italian) is never checked. That is a known
  blind spot of the list.
- When the repair fails the error stays in the store, as it does today, and the event records it.
- In a language that drops the subject (Italian, Spanish, Portuguese) a sentence often starts with
  a capitalised verb, so the check fires on correct first-person facts and spends a call the model
  answers with "keep". The measurement reports how often.

## Validation

Before merge, on a case set committed before any run and not used to write this ADR: subject
swaps and lost owners at 0 in 3 of 3 runs, with no rise in wrong-language memories or in misses
among the top 5 recall results compared with the current code, and the extra LLM calls reported.
The criteria are fixed in the benchmark log before the first run, like H102 to H113.

## Alternatives

- A further prompt rule. Rejected after three measured attempts, for the reasons above.
- A structured subject field in the extraction schema (`subject: "speaker" | <name>`), with the
  text rendered from it. It changes the extraction contract and every custom `LLM` that returns
  facts, and the model can fill the field as wrongly as it fills the text. The check uses output
  the extractor already returns.
- Checking `PERSON` entities only. Misses 2 of 6 failures in the diagnostic run above.
- An LLM verification call on every fact. It costs a call per write on the pass path too.
- Rejecting the failing fact. It loses a fact the user stated to protect one detail of it.
- Storing the quote when the repair fails. Measured (H114 to H117) and rejected: the quote is in the
  first person and has no "user", and a failed repair is most often a false trigger on a verb.
- Requiring the rewrite to contain every missing word. Measured and rejected: the model pasted a
  verb into the fact ("Sono user è intollerante al lattosio"). The rewrite now has to contain only
  the words the model says are names.

## Outcome

Two implementations were measured against criteria fixed before each run, on case sets committed
before any run (`judge-cases-third-person-four.json`, `judge-cases-third-person-five.json`), three
runs per arm against the current code. Both were reverted.

- The first version (store the quote when a repair fails) removed every subject swap and lost owner
  (4 per run to 0). It regressed on lost speakers, top-5 recall and wrong-language memories. In
  Italian, Spanish and Portuguese a sentence often starts with a capitalised verb, the check fired
  on it, and failed repairs stored first-person quotes without "user".
- The amended version (the model lists which missing words are names) cut lost owners from 5 or 6
  per run to 2. It did not reach 0. Of 21 to 23 facts sent to the repair per run, the model listed a
  name and returned the fact unchanged 5 to 8 times, took verbs ("Sofro", "Dirijo") for names, and
  some accepted rewrites duplicated the fact.

The check finds the right facts. The repair by the extraction model is what fails, and the lexical
check alone cannot tell a name from a sentence-initial verb. A next design needs a signal that
separates the two without asking the extraction model. #257 stays open.

