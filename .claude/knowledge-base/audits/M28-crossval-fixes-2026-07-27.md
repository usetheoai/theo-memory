# M28 — Cross-validation fixes (recall #157 + MCP identity)

**Date:** 2026-07-27

## (1) Recall #157 — DELIVERED (theo-memory)
Root cause: the write path normalizes the speaker to `user`; a PT query "profissão do **usuário**"
fails to lexically match (BM25 `plainto_tsquery` + entity key) the speaker's own facts (stored under
`user`) and instead matches unrelated facts containing "usuário". Fix: `retrieval/speaker-alias.ts`
appends the `user` token to the BM25 + entity match (NOT the semantic embed) for speaker-referring
queries. Unit 5/5; retrieval suite 72/72; `pipeline.ts` stays 300 LoC. Benchmark: `docs/benchmarks/m28-recall-crossval-vs-mem0.md` (live P@1 measured post-deploy).

## (2) MCP identity — NO theo-memory work; theo-cloud companion (issue usetheodev/theo-cloud#256)
The theo-memory MCP ALREADY resolves the user correctly: precedence `_meta` > edge-resolved user >
`THEOMEM_MCP_DEFAULT_USER_ID`, PROVEN by `packages/mcp/src/server-scope-merge.test.ts` ("prefers the
edge-resolved user over the deployment default" — its comment names the exact dashboard-invisibility
symptom). The deployed gap is entirely the theo-cloud gateway not injecting the authenticated user
into the MCP request (Model B) — filed as usetheodev/theo-cloud#256. Honest scope: M28's theo-memory
deliverable is the recall fix; identity is a cross-repo companion (like M27's dashboard column).
