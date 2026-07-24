# Deps Audit: claude-code-kit-recall-parity

**Date:** 2026-07-24
**Mode:** plan-bound:claude-code-kit-recall-parity
**Verdict:** PASS (deps declaradas pelo M14 limpas) — com caveat honesto de dívida pré-existente fora de escopo
**Hard caps triggered:** [] (nenhum — as deps DECLARADAS pelo plano estão limpas em ambos os auditores)

## Summary

- Ecosystems detected: npm (único — `package.json` + `pnpm-lock.yaml`)
- Deps DECLARADAS pelo plano M14: `@modelcontextprotocol/sdk`, `pg`, `zod` (Existing) + ZERO novas
- Auditor coverage: `npm audit` ran (autoritativo para npm), `osv-scanner` ran (cross-check)
- **`npm audit` (autoritativo): ZERO vulnerabilidades.**
- **`osv-scanner`: 13 findings (3 HIGH, 8 MODERATE, 2 LOW) — NENHUM nas deps declaradas pelo M14; todas transitivas pré-existentes.**

## Validação plan-bound (o que importa para o M14)

| Plan dep | Section | npm audit | osv-scanner | Rule 9 | Verdict |
|---|---|---|---|---|---|
| `@modelcontextprotocol/sdk` | Existing | limpo | não afetado | n/a (existente) | OK |
| `pg` | Existing | limpo | não afetado | n/a | OK |
| `zod` | Existing | limpo | não afetado | n/a | OK |
| (NEW deps) | New | — | — | ZERO deps novas (blueprint § Corner 2) | OK |

**As três deps que o M14 toca estão limpas em AMBOS os auditores.** O M14 introduz zero deps externas (é composição de primitivos internos). Nada bloqueia o milestone.

## Achado pré-existente (honestidade — fora do escopo do M14, NÃO bloqueia)

O OSV reportou 3 HIGH em deps **transitivas** que o M14 NÃO toca:

| Severidade | Pacote | CVE | Natureza |
|---|---|---|---|
| HIGH | `brace-expansion@1.1.15` + `@5.0.6` | CVE-2026-13149 | transitiva (dep de glob/minimatch, ubíqua) |
| HIGH | `js-yaml@4.2.0` | CVE-2026-59869 | transitiva |
| MODERATE ×8 / LOW ×2 | `@hono/node-server`, `hono`, `body-parser`, `esbuild`, `@opentelemetry/core`, `protobufjs` | — | transitivas do servidor REST + dev-deps |

**Divergência de auditor (por que NÃO é hard cap):** o `npm audit` — autoritativo para npm por dataset (GitHub Advisory) — reporta **ZERO**. O OSV lê ranges brutos do lockfile e pode não refletir overrides do pnpm nem CVEs muito recentes (2026-xxxxx) ainda não triadas pelo GitHub Advisory. Per o golden rule anti-pattern 6 ("NEVER use osv-scanner alone for npm — pair with npm audit"), o npm audit vence para o veredito.

**Por que não bloqueia o M14:** o golden rule capa em FAIL_INSECURE quando a CVE HIGH está numa dep **DECLARADA pelo plano**. `brace-expansion`/`js-yaml` NÃO são declaradas pelo M14 — são dívida transitiva do repo, pré-existente ao milestone. Bloquear o M14 por CVEs em deps que ele não toca seria incorreto.

## Recommended next steps

1. **M14 procede** — deps declaradas limpas; verdict PASS para o plano.
2. **Follow-up (fora do M14):** rodar `/deps-audit` standalone do repo para investigar as 3 HIGH transitivas. Dado o npm audit=0, provável divergência de dataset (não exploráveis via os paths atuais), mas merece confirmação. NÃO abro issue agora: o auditor autoritativo discorda, e afirmar exploração sem confirmar seria fabricação de severidade.
3. Prosseguir para `/plan-confidence`.
