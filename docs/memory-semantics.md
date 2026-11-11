# Exact records, evidence, and contextual memory

Theo Memory keeps context an agent can recall across sessions. Calendar events, orders and
wishlist state belong to application tables, queried by domain IDs and exact predicates.
A memory of a purchase is evidence of a statement; the order system owns purchase state.
Both stores can use the same Postgres database. An exact miss remains empty; never replace
it with an approximate vector match. See the runnable [wishlist example](../examples/wishlist/README.md).

The architecture applies the [provided video transcript](transcripts/8C4bh59FtsI.en.md):

| Information | Storage and access | Write timing |
|---|---|---|
| Operational facts | Application SQL tables; exact lookup | Immediately, before acknowledging the operation |
| Preferences and interpreted patterns | Contextual memories; semantic recall | Extract asynchronously with enough evidence |
| Working context | Session scope, optionally explicit `expiresAt` | As needed; session scope alone has no TTL |
| Raw audio/video | Separate application media storage | Only for an explicit application purpose |

## Evidence and independent sources

`RememberOptions.evidence` and `MemoryItem.evidence` accept `kind` (`stated`, `inferred`, or
`observed`), optional `sourceId`, `originSourceId`, `sourceQuote`, `modality` (`text`, `audio`,
`video`) and `confidence` (0–1). None means verified. Confidence is a subjective estimate.
References do not fetch or retain raw sources.

For `infer:false`, the caller declares evidence. For extraction, caller source references are
preserved while the model classifies each fact. The extractor drops temporary and tentative
preferences before persistence. Purchases, returns and profile changes can be durable events
without becoming permanent preferences. A stated fact needs a quote present in the submitted
input; invalid quotes are stripped and the fact becomes inferred. Presence checks do not
prove that an interpretation is correct. Reflection-derived memories are inferred.

The first persisted evidence remains the memory's primary `evidence`. Additional citations
are retained in `memory_evidence`. `distinctSourceCount` counts identified original sources;
`confirmationCount` counts same-hash assertions. Neither is a statistical confidence score.
Use `originSourceId` when a summary references an existing source, so the summary does not
become another independent confirmation. Reflection inherits the union of original sources.
There is one ledger entry per memory and original source. Repeating that source does not add
another entry. Legacy rows start with unknown (`null`) source count; migrations invent no
provenance. Unidentified new writes have zero identified sources.

```ts
const first = await memory.user('alice').remember('I prefer simple clothes.', {
  infer: false,
  idempotencyKey: 'request-42',
  evidence: { kind: 'stated', sourceId: 'conversation-7:turn-2' },
});
// Replaying the identical request returns the canonical result with idempotentReplay:true.
// A different request under the same key raises IdempotencyConflict (HTTP 409).
```

Postgres SDK writes with `idempotencyKey` replay before extraction, preserve the original
expiry and counters, and skip remember hooks. Scope, input and effective options form the
request identity. Stores without the replay capability reject that option rather than
promise idempotence. Write receipts are retained for 30 days by the durable worker's pruning.
Do not rely on replay protection after receipt retention or hard erasure.

`PgMemoryEvidenceStore.list(memoryId, filters, {limit, offset})` reads audit evidence, including
expired memories, with trusted workspace/user filters. Default page size is 20, maximum 100;
`nextOffset` indicates another page. REST exposes
`GET /v1/scopes/{type}/{id}/memories/{memoryId}/evidence`. Unauthorized memories return 404.
Hard deletion removes the ledger through its foreign key and redacts related job content.

`SessionToGlobalConsolidationPolicy` requires at least two distinct identified origins by
default (configurable upward). High assertion counts, unknown origins and expired memories do
not qualify. This intentionally tightens older assertion-count promotion behavior.

## Explicit expiration

SDK `expiresAt` is a future `Date`; JSON APIs accept an ISO timestamp with timezone. Omission
means no expiration. Current recall, listing, counts, episodes, graph context and promotion
exclude expired memories. Historical `asOf` reads compare against the deadline at that instant.
Caches cannot keep a result beyond its earliest deadline. Derived memories inherit the earliest
source expiry; inaccessible or expired sources cannot create new derived context.

Deduplication and retries preserve the persisted deadline. Once an expired occurrence is
reasserted, its old version is closed at its expiry and a new version is inserted. Expiration
normally retains historical rows. `themory worker --purge-expired` optionally deletes them
physically, making historical reads of those rows unavailable.

```ts
await memory.session('dinner-42', 'alice').remember('The invitation says formal attire.', {
  infer: false,
  expiresAt: new Date(Date.now() + 60_000),
  evidence: { kind: 'observed', sourceId: 'invitation-42', modality: 'text' },
});
```

## Observation time and raw messages

`observedAt` says when the remembered messages were sent; JSON APIs accept an ISO timestamp
with timezone. It becomes the memory's valid-from instant (`MemoryItem.tValid`), while
`createdAt` stays the time the system stored it. Importing last year's conversation therefore
answers `recall({ asOf })` for last year. When a duplicate is confirmed, the earlier of the two
observations wins. A time more than five minutes in the future is rejected. The extractor
resolves relative dates ("last Friday") against `observedAt`; without it, they stay as written.

Every write also lands in the scope's raw message log, linked to the memories it produced, and
the next write's extractor sees the last 10 turns of the same scope as context. A hard forget
erases the memory's source messages, including their citations of other memories; a soft
forget keeps them. `Memory.reset(scope)` deletes the scope's memories and every message logged
for it, including turns that produced no memory; a session reset leaves the user's global
memories alone. `recall(query, { includeSources: true })` returns each memory with those
messages, so the caller can check the fact against what was said.
`searchMessages(query)` searches those messages directly (BM25, five by default), which
reaches a turn extraction kept no fact of; it matches words, not meaning.
`createLocalMemory({ messageLog: false })` turns the log off. See ADR-0027
and ADR-0028.

```ts
await memory.user('anna').remember('Last Friday I took my sister to a pottery class', {
  observedAt: new Date('2023-07-23T18:46:00Z'),
});
```

## Replaced facts

When a new fact gives the same attribute of the same subject a different value ("I moved to
Lisbon" after "I live in Porto"), the write marks the old memory as no longer true from the
new observation time. It leaves current recall; `recall({ asOf })` before that instant still
returns it, and `history` keeps a `supersede` row with both texts. The returned item lists the
replaced ids in `supersedes`. The extractor decides, so a wrong call can hide a true memory
from current recall; it is never deleted. `createLocalMemory({ supersedeOnWrite: false })`
turns this off. See ADR-0029.

## Loading both contexts and saving off the live path

`MemorySession` coordinates an authenticated `ScopedMemory` with an application
`SessionFactStore` implementing exact `lookup` and `write`. Construct it per authenticated
session with both adapters bound to the correct identity.

```ts
const session = new MemorySession({ memory: memory.user('alice'), facts });
const context = await session.loadContext({ itemId: 'blue-jacket' }, 'Dinner preferences');
// Keep context.facts and context.memories distinct in prompt composition.
await session.writeFact({ itemId: 'blue-jacket', name: 'Blue jacket' });
await session.close();
```

Its optional `enqueueUnderstanding` is a bounded in-process queue, with completion results,
`flush` and draining `close`. It is useful for a single process but acceptance can be lost on
crash. For durable acceptance use [memory jobs](memory-jobs.md), which persist before returning
202, prepare outside the request and atomically commit the resulting memories and job receipt.

`remember(..., {strictExtraction:true})` surfaces malformed responses, missing embeddings and
incomplete writes. A valid empty extraction is success. Direct strict extraction can partially
persist on adapter failure; use the durable processor when multi-effect atomicity is required.
`MemorySession` enables strict mode but does not make its in-process queue durable.

## Raw perception and validation

Session observations and durable jobs accept textual meaning and source references, not raw
media fields. Binary input, unknown fields, empty text and text above 100,000 characters are
rejected. The lower-level string-based `remember` does not detect base64: extract meaning
before calling it. Media retention, replay permissions and raw-source deletion belong to the
application.

Deterministic tests cover extraction gates; actual Postgres tests cover evidence, temporal
reads, authorization, recovery and transaction boundaries. The [live evaluation](memory-semantics-validation.md)
measures one configured model against 60 bilingual fixtures. It is a regression gate, not a
guarantee for every future input or provider.
