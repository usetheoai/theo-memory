# SEPA — Iteration 6 / Task T5.1 / Phase Pre-RED

## Plan recap
- Add "Uniform Bearer auth across REST + MCP HTTP (FAANG-DX)" subsection to README documenting env-driven THEMEMORY_API_KEY auto-flip + .mcp.json template + ADR D1 precedence + R4 warning.

## Findings
- [MAJOR] public-copy.md bans "Mem0-clone"/"wrapper around Mem0"; allows "Mem0-shape architecture". Plan's "Mem0-DX" risks tripping warn hook. AVOID "Mem0" token in README body — use "industry-standard SDK Bearer-token convention" / "uniform Bearer DX". Header "FAANG-DX" neutral, OK.
- [MAJOR] Voice: Quickstart-class is technical-direct (matches existing § Agent loops via MCP). Match.
- [MAJOR] Insertion point: NOT § Quickstart but END of § Agent loops via MCP (after TLS paragraph, adjacent existing .mcp.json template). VERIFY greps don't anchor to section.
- [MAJOR] R4 warning text MUST be near-verbatim per plan ADR to satisfy grep assertion.
- [INFO] TDD shape: bash grep VERIFY accepted per shape gate; no .test.ts sentinel required.
- [INFO] Precedence table from ADR D1 → markdown table with @see ADR D1.

## Recommended action
- Insert at end of § Agent loops via MCP (after TLS paragraph).
- Header: "### Uniform Bearer auth across REST + MCP HTTP (FAANG-DX)".
- Body: (1) prose explainer, (2) .mcp.json template, (3) precedence table, (4) R4 WARNING block near-verbatim.
- Avoid Mem0 token in body; use neutral framing.
