---
journey: J-MCP-3
date: 2026-07-11
operator: claude-code
outcome: pass
oracle_result: "tests/integration/openmemory exit 0; 4/4 tests passed (add_memories/search_memory/list_memories/delete_memories round-trip vs real ankane/pgvector; 10.10s)"
summary: OpenMemory MCP compat SSE round-trip green against real pgvector (T5.1 first real journey)
---

# Evidence — J-MCP-3 (OpenMemory MCP compat SSE)

Ran the J-MCP-3 oracle (`tests/integration/openmemory`) as the driver specifies, against the
live `themem_pgvector`. 4/4 tests green, exit 0. This is the first journey dogfooded under the
unified runner+gate (ADR-0019) — proves the run -> real-evidence -> audit pipeline end-to-end.
