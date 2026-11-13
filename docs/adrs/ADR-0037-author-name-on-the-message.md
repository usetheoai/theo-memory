# ADR-0037: A message can carry its author's name, and facts about the author use it

Status: Accepted (2026-11-13).

## Context

The extractor calls the first-person speaker `user`. That is right for a one-to-one chat. It is
wrong when the caller knows who wrote each message, as in a group chat or a transcript: the fact
"user plays the banjo", extracted from a line Maeve wrote, is not reached by a question about
Maeve (#244). Callers worked around it by writing `Maeve: ` into the text, and the extractor then
used the name most of the time.

Measured on three case sets written for this (154 cases each, English and Brazilian Portuguese,
three repetitions, `gpt-4o-mini`), with the name written into the text by the caller, the subject
of a fact the named author states about themself was wrong in 9, 12 and 17 of 264 extractions
(Observed). Almost every wrong fact used `user`.

The reference systems read for this decision use the name when there is one and a generic token
only when there is none, and one published benchmark of group conversation describes this same
defect in another system (Reported; the notes are in the working tree, not in the repository).

## Decision

`Message` gains an optional `name`: the person who wrote the message.

- The write pipeline writes the name into the text of the message as `Name: text`, once, at its
  entry. The extractor reads that form, a source quote is checked against it, and the message log
  stores it, so later writes still see who said what.
- After extraction, a fact that says `user` takes the name of the author of the message its
  source quote comes from. A quote found under two authors, or under a message with no name,
  leaves the fact as it is. A fact with no quote in the messages takes the name only when the
  whole write has one named author.
- Entities and relations take the name only when the whole write has one named author: a relation
  does not say which message it came from.
- A message with no `name` is handled exactly as before.

Each rewrite is counted in the event `extraction_author_named`.

## Evidence

Base: the caller writes the name into the text. Arm: the name goes in the field. Same batch,
three repetitions per side (Observed).

| Set | Wrong subject, base | Wrong subject, arm | Other families |
|---|---|---|---|
| Development | 9 of 264 | 0 of 264 | no wrong subject on either side |
| Held out | 12 of 264 | 0 of 264 | no wrong subject on either side |
| Confirmation | 17 of 264 | 0 of 264 | no wrong subject on either side |

On the confirmation set the arm wins 7 pairs and the base none (exact sign test, p = 0.016).
Facts about a third person, messages with no named author, and messages that open with a label
that is not a person ("Note:", "Update:") are unchanged. Memory-semantics passes with no
forbidden fact.

The held-out set failed one criterion as it was written: it required that the base win no pair,
and the base won one because the arm did not store a value in one repetition. That criterion
mixed a wrong subject with a missing value. It was not relaxed; a corrected criterion was written
and checked on a third set drawn afterwards.

## What this does not show

- The three sets come from one generator and the same lists of names, attributes and values, with
  one sentence per fact. Sentences and the blind reading come from the same model family as the
  author of this record.
- Recall was not measured here. That a fact under `user` is hard to reach by name was observed
  once, on other data, in #244.
- Nothing here measures long, multi-turn group conversations.

## Alternatives measured and rejected

- Rewriting `user` with the name parsed from a `Name:` prefix in the text. A label that is not a
  person became the subject in 72 of 90 extractions. The name has to come from a field.
- Giving the extractor the name in a prompt directive, with the line shown as `user (Name):`. The
  wrong-subject count rose from 9 to 36 of 120 with one author and from 0 to 31 of 144 with two.

## Consequences

- In a scope where authors are named, facts are stored under the names. A first-person question
  ("what do I do?") no longer reaches them through the `user` token: recall would need to know who
  is asking. That is not built. Callers should send `name` for multi-party input and leave it out
  in a one-to-one chat.
- Two people with the same name in one scope are one subject. Identity by a stable id is not part
  of this decision.
- The `name` field exists on the SDK (`rememberMessages`). The REST and MCP surfaces take text, not
  message lists, and are unchanged.
- The word `user` inside a fact from a named author is replaced wherever it stands as a word, so a
  fact that used it as a common noun would be changed too.
