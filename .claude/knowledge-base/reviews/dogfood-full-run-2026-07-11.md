# /dogfood full — run report (2026-07-11)

**Verdict: `EVIDENCE_INSUFFICIENT`** — 12/32 journeys green, 20 red (19 no_evidence + 1 partial).

This is the HONEST answer to "is TheMemory 100% functional?": **NOT YET** — 12 backend journeys are
proven green with real integration-suite evidence vs live `themem_pgvector`; 20 remain undogfooded.

## Green (12) — real evidence, vs live pgvector
- SDK: J-SDK-1 (remember→recall, 4), J-SDK-3 (forget soft+hard, 15), J-SDK-5 (skills, 16),
  J-SDK-6 (entities+graph, 25), J-SDK-7 (episodes, 9), J-SDK-8 (asOf, 1), J-SDK-10 (eviction+forgetting, 43),
  J-SDK-11 (distillation, 8), J-SDK-12 (recall cache, 32).
- MCP: J-MCP-1 (native agent-tools, 13), J-MCP-3 (OpenMemory SSE, 4), J-MCP-4 (per-user isolation, 2).

## Findings (20 red) — what each needs (NOT plan failures; dogfood usage TODO)
- **J-SDK-4 (reflect) — PARTIAL:** the reflection integration suite SKIPS without a real LLM provider
  (1 skipped, 0 ran). A skipped suite is not a green — needs a driver step that runs reflect against a
  real provider (OpenRouter). Honesty caught: an early naive "exit 0 = pass" mislabeled this; corrected.
- **J-SDK-2 (3-tier isolation), J-SDK-9 (attributedTo):** no dedicated integration suite — need a real
  SDK snippet in the driver.
- **J-API-1..7 (7):** the `themory server` (:18081) is down — need to boot it (host or dev-stack) then
  `curl` each verb. `/dogfood run api`.
- **J-MCP-2 (streamable-http):** needs a bearer-auth http MCP round-trip.
- **J-UI-1..9 (9):** need the theo-cloud dev-stack (`make dev-up`) + real Chrome via chrome-devtools MCP
  per the runbook in `drivers/ui.md`. `/dogfood run ui`.

## Integrity note (the gate working as intended)
The dogfood run itself must not produce false-green evidence. An early batch mislabeled a SKIPPED
suite (J-SDK-4) as `pass`; caught + corrected to `partial`. This is exactly why `oracle_result` must be
a real machine observation (EC-3) — a skipped suite has no green oracle.

## To reach EVIDENCE_SUFFICIENT
Drive the 20 remaining journeys green (`/dogfood run api`, `/dogfood run ui`, + SDK snippets +
a provider for reflect). Until then the gate correctly blocks any `production-ready`/v1.0 claim.
