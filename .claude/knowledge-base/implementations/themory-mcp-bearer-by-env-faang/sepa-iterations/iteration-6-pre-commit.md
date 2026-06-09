# SEPA — Iteration 6 / Task T5.1 / Phase Pre-COMMIT

## Plan recap
- T5.1 adds 33-LoC subsection to README § Agent loops via MCP documenting env-driven Bearer auto-flip + .mcp.json template + precedence table + R4 warning.

## Audit (7/7 PASS)
1. Conventional commit format `docs(mcp): ... (T5.1)` valid.
2. Banned-token scope: commit subjects are technical-internal (like CHANGELOG/ADRs/source) per CLAUDE.md § Voice and Tone § "Does NOT apply to". Plan DoD literal "Mem0-DX" is acceptable in subject; README BODY clean (uses "industry-standard SDK auth convention"). Option B (verbatim plan DoD) preserves audit traceability.
3. T5.1 DoD 6/6 satisfied — subsection + .mcp.json template + 4-row precedence + R4 warning + env name + clean banned-token diff.
4. PRIORITY 0 4-point rationale required in body.
5. No Co-Authored-By trailer.
6. Wiring triad docs-class: pillar (a) N/A, pillar (b) self-via-3-sentinel-grep, pillar (c) N/A per v1.2 (no metrics).
7. Voice & tone: README body uses neutral phrasing — Rule 9 honored.

## Verdict
PROCEED with Option B subject verbatim: `docs(mcp): document env-driven Mem0-DX uniform-auth path (T5.1)`.
