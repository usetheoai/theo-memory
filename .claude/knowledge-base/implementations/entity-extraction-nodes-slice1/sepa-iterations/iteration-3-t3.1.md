# SEPA — T3.1 (iteration 3)
pre-RED (VERBOSE): 2-port design (EntityExtractor + persist-only MemoryEntityStore.upsertAndLink); ALL orchestration in pipeline; WHOLE-Phase-7 single try/catch fail-soft (mirror history_persist_failed); reuse deps.embedder (1 embedBatch, EC-5); optional deps + triple-gate; cap→drop→embed→persist; no new scope helper (DRY); record 6th/7th DIP vs ADR-0008.
post-GREEN (VERBOSE): GREEN sound, all 8 invariants hold, 5 unit tests honest. COMMIT.
  Non-blocking follow-ups: (1) T5.1 integration GOAL test MUST cover EC-4 default-ON AND entityBoost:false negative vs real pgvector. (2) ADR-0008 count honesty — recorded below.

## ADR-0008 honesty note (Rule 3)
ADR-0008 titled "5 DIP" with prose "introducing a sixth DIP later is a contract change at v1.x". That prose is ALREADY stale (prior cycles shipped RecallCacheStore=13th DIP etc.). This slice adds EntityExtractor + MemoryEntityStore. Pre-release; acceptable. The DIP count growth is recorded here + in the commit body, NOT silent. A full ADR-0008 supersession footer is deferred (it was already superseded by earlier cycles; not new debt from this slice).
