# ADR-0040: An empty extraction gets a second, narrow look

Status: Accepted (2026-11-13).

## Context

A fact a person states about themself was not stored when a question carried it. "As someone
who lives in Velmora, which bank should I pick?" came back from the extractor with an empty list
in five writes of six (#282). On two case sets written for this, the fact was stored in 12 of 72
writes when it sat inside a question and in 55 to 70 of 72 when it sat inside a request; stated
plainly, as a reason, as an aside or among several facts it was stored nearly always (Observed).

The extraction prompt says that a turn which only asks something yields no fact, and its first
example is a question with an empty output. The model applies both to a question that also states
something.

Changing that prompt was tried first and rejected. A rule in prose changed nothing. Examples fixed
the shape and moved other outputs: an example written with `user` made the extractor write `user`
for an author named in the text, and an example with a name made it give the author a fact about
someone else. One variant went to a held-out set and failed a guard written before the run.

## Decision

When extraction returns an empty list, the write path makes one more call for each message a
user wrote, with a prompt of its own. It asks only what the author states about themself as
already true, wherever the statement sits, and excludes what the author asks about, considers, or
says about someone else.

- The call returns, for each fact, what is true of the author as a phrase with no subject, the
  exact words that state it, and whether it lasts. The code writes the subject, so it is the
  speaker token `user` in every language.
- A fact is kept only when its quote is found in the message.
- The recovered facts go through the rest of the pipeline as any extracted fact does.
- A failed or malformed call recovers nothing, emits `extraction_stated_check_failed` and does
  not fail the write. Recovered facts are counted in `extraction_stated_check_recovered`.

The extraction prompt is unchanged.

## Evidence

Base and arm in the same batch, three repetitions per side, `gpt-4o-mini`, on a confirmation set
drawn after the development work: 216 messages in English and Brazilian Portuguese, with six
shapes of stated fact and three control families in which the value is not true of the author
(Observed).

| Measure | Base | Arm | Paired reading |
|---|---|---|---|
| Stated values stored about the user (576) | 480 | 539 | arm 22, base 0, p < 0.0001 |
| inside a question (72) | 12 | 52 | |
| inside a request (72) | 55 | 72 | |
| Control: a question that only considers the thing, writes storing the value (72) | 0 | 0 | |
| Control: a request that involves the value (72) | 11 | 11 | |
| Control: a question about someone else (72) | 18 | 18 | |

The guards show no loss: extraction fidelity 61 against 57 cases passing with no fact from small
talk, memory-semantics with no forbidden fact, the frozen date set 145 against 144, no wrong
subject on the named-author set, nothing stored from marked reference material.

## Cost

One more call for each write whose extraction is empty. On the confirmation set that is 264 of
648 writes, a set built with many questions; in ordinary conversation the share is whatever share
of turns yields no fact. The call reads one message and returns a short list.

## Limits

- Inside a question the fact is stored in 52 of 72 writes, not all: in 20 the second call returns
  nothing either. On the development set it was 66 of 72.
- The check runs only when extraction is empty. A message from which the extractor takes one
  fact and misses another is not looked at again.
- It asks about the author only. A fact about someone else that sits inside a question is left to
  the extractor.
- The case sets come from one generator with a small space of values; attribute and value pairs
  repeat across the three draws, with new sentences each time. Sentences and the blind reading
  come from the same model family as the author of this record.
- Two controls store a value on both sides (11 and 18 of 72). Most are correct memories about a
  third person; they come from the extractor and are the same with and without this change.
