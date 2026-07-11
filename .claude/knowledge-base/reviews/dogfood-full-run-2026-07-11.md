# /dogfood full — complete run report (2026-07-11)

**Verdict: EVIDENCE_SUFFICIENT** — all 32 anchor journeys (Q1 all-anchor) driven AS A HUMAN
to real, fresh, green evidence across the four surfaces. `run_journey_audit.py` over the real
catalog × evidence dir emits `EVIDENCE_SUFFICIENT` with `reds: []`.

## Coverage (32/32)

| Surface | Count | How driven |
|---|---|---|
| SDK | 12/12 | vitest integration suites against real `ankane/pgvector` (themem_pgvector); SDK snippets where no suite (J-SDK-7/8/9) |
| API | 7/7 | real `curl` against a booted `themory server` (OpenRouter LLM, themem_dogfood DB); `themory` CLI verbs (J-API-7) |
| MCP | 4/4 | real `@modelcontextprotocol/sdk` client (native stdio + streamable-http + OpenMemory SSE compat) |
| UI | 9/9 | real Google Chrome via chrome-devtools MCP against the theo-cloud dev-stack (vite :5173 → gateway :13002 Model B → themory :18081), user dev@theo.local |

## UI highlights (M1/M2 proven through the full stack)

- **J-UI-5** Playground live remember→recall: "Alice manages the platform team in Lisbon." recalled as top hit (0.581) through gateway→themory→OpenRouter.
- **J-UI-6** Entities SUMMARY (M2): Bob → "drives → Tesla; left → Google; lives_in → Berlin; works_at → Meta".
- **J-UI-7** Graph superseded toggle (M1): 6 → 7 relations when "Include superseded edges" enabled (superseded Bob-works-at-Google active=false).
- **J-UI-8** Skills curation: create (BFF 201) → renders → Forget dialog → confirmed → gone (BFF count 0).

## Honesty notes (Rule 3)

- Evidence records key PREFIXES only (EC-2 redaction); the gate's secret scan passed.
- SDK integration suites run against real pgvector; no mocked memory engine. LLM extraction is the real OpenAI/OpenRouter API.
- The gate is the same one under 50 green unit tests; SUFFICIENT means every journey's newest evidence is outcome:pass with a non-empty machine oracle, fresh (≤30d), secret-free.
