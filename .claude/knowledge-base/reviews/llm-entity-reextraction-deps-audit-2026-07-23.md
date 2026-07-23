# Deps Audit — llm-entity-reextraction (M13)

Date: 2026-07-23 · Verdict: **PASS**

Plano declara ZERO dependência nova; as 4 consumidas já estão instaladas e pinadas:
`openai ^4.77.0`, `zod ^3.25.0`, `pg ^8.13.0`, `commander` (cli). `pnpm audit --prod`:
0 CRITICAL / 0 HIGH; nenhuma CVE (nenhum nível) nas deps declaradas.

Nota honesta (fora do escopo deste plano): 6 MODERATE pré-existentes no workspace —
`hono` (3), `@hono/node-server` (1), `protobufjs` (2) + 1 LOW `body-parser` — deps do
servidor REST não tocadas por este plano; rastrear em ciclo de manutenção próprio.
