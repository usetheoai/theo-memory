# ADR-0039: Material a message passes along is not extracted

Status: Accepted (2026-11-13).

## Context

A write takes messages and extracts facts from them. Callers also send, in those messages, text
the author did not say: a pasted email, a web page, a tool result. The extractor reads all of it
the same way.

Measured on requests sent together with pasted material, 70 cases in English and Brazilian
Portuguese, three repetitions, `gpt-4o-mini` (Observed, held-out set):

- a value that appears only in the material was stored in 65 of 120 writes, almost always as a
  fact about "the customer", a subject tied to nobody, and once as a fact about the user;
- each pasted piece of material left about four memories of content the author never said.

A survey for this work reports that writing through untrusted content succeeds in a third to
nearly all attempts depending on the agent, that detectors miss most well-formed false facts, and
that the defence with the best measured result admits memories by where they came from (Reported;
the notes are in the working tree, not in the repository).

## Decision

`Message` gains an optional `reference`: true when the content is material the author passed
along and not something they said.

A message marked this way stops at the entry of the write pipeline. It is not shown to the
extractor, not written to the message log and not embedded. A write made only of such messages
calls no model, stores nothing and emits `extraction_reference_only`.

Nothing depends on a model following an instruction: the material is never read by one on the
write path.

## Evidence

Base: request and material in one message, as a caller without the mark sends them. Arm: the
material in its own message, marked. Same cases, three repetitions per side (Observed).

| | Base | Arm |
|---|---|---|
| Value found only in the material, stored (120 writes) | 65 | 0 |
| Value the author states in the request, stored about the user (90 writes) | 63 | 64 |
| Facts stored per write, material cases | 3.6 | 0 |
| Facts stored per write, author cases | 4.4 | 1.0 |

On the author's own statement the base wins 4 cases and the arm 3 (p = 1.0).

## Alternative measured and rejected

Showing the marked material to the extractor under a heading that says it is context only. On
the development set the extractor then returned nothing at all for most writes, and the author's
own statement was stored in 53 of 90 writes against 73 without the change.

## What this does not cover

- Material pasted inside the same message as the request, with no mark. Nothing changes for it;
  the numbers of the base column are what happens.
- An instruction written in the material and addressed to the assistant. No case set with such
  instructions was run. With the mark the outcome follows from the design, since the material is
  not read; without the mark it is not measured.
- A statement that needs the material to be understood ("that date works for me"). The extractor
  no longer sees the material, so such a statement is extracted from its own words alone. This was
  not measured.
- The author's own statement was not found in 26 to 27 of 90 writes on both sides. That count is
  inflated by the case set: the Portuguese cases carry one kind of value in English, the extractor
  rewrites it, and the score looks for the value word for word. In at least 12 of the 26 arm
  writes a stored fact does mention it. In 14 writes nothing was stored at all; that omission is
  real, is the same on both sides, and is not addressed here.
- The mark is available on the SDK (`rememberMessages`). The REST and MCP surfaces take text, not
  message lists.
