# Deps Audit: entity-boost-recall-contribution

**Date:** 2026-07-24
**Mode:** plan-bound:`entity-boost-recall-contribution` (M15 / theo-memory#122)
**Verdict:** PASS
**Hard caps triggered:** (none)

## Summary

- Ecossistemas detectados: npm (pnpm workspace)
- Deps declaradas pelo plano: 1 existente (`pg`), 0 novas, 0 removidas
- Vulnerabilidades nas deps **declaradas**: 0
- Vulnerabilidades no repositório inteiro: 3 HIGH, 8 MODERATE, 2 LOW, 0 CRITICAL
- Cobertura de auditores: `pnpm audit` rodou; `osv-scanner` instalado e disponível

## Validação do plano

| Plan dep | Seção | Confere com o manifesto? | Auditoria limpa? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `pg` `^8.13.0` | Existing | sim — `package.json:133` declara `^8.13.0`; lockfile resolve `pg@8.21.0` | sim — zero advisories para `pg` | n/a (dep já existente) | OK |
| (nenhuma nova) | New | n/a | n/a | n/a — o plano justifica explicitamente por que nenhuma dep nova é necessária: normalização de string é `String.prototype` nativo (degrau 2 da escada de parcimônia), e o blueprint confirmou que o caminho de scoring do `graphiti` não puxa dependência de scoring | OK |

Correção aplicada durante a auditoria: a v1.0 do plano declarava `pg ^8.13.1`, valor que eu não havia conferido contra o manifesto. O real é `^8.13.0`. Corrigido no plano antes de fechar o veredito — versão declarada divergente do manifesto é precisamente o que o gate `plan_dep_version_unset` existe para pegar, e deixar passar seria fabricar evidência.

## Achados fora do escopo do plano (dívida pré-existente do repositório)

Nenhum destes é introduzido, agravado ou tocado pelo M15. Todos são **transitivos**, nenhum é dep declarada deste plano. Registrados aqui porque omitir HIGH seria desonesto, mesmo quando fora de escopo.

### HIGH

| Advisory | Pacote | Caminho |
|---|---|---|
| GHSA-3jxr-9vmj-r5cp | `brace-expansion@<1.1.16` | `eslint > minimatch > brace-expansion` |
| GHSA-3jxr-9vmj-r5cp | `brace-expansion@>=3.0.0 <5.0.7` | `eslint-plugin-import > @typescript-eslint/parser > @typescript-eslint/typescript-estree > minimatch > brace-expansion` |
| GHSA-52cp-r559-cp3m | `js-yaml@>=4.0.0 <4.3.0` | `@apidevtools/swagger-parser > @apidevtools/json-schema-ref-parser > js-yaml` |

### MODERATE (8) e LOW (2)

`esbuild` (GHSA-67mh-4wv8-2f99 via `drizzle-kit`), `@opentelemetry/core` (GHSA-8988-4f7v-96qf), `protobufjs` × 2 (via `@xenova/transformers > onnxruntime-web`), `hono` × 3 (GHSA-xgm2-5f3f-mvvc, GHSA-hvrm-45r6-mjfj, GHSA-w62v-xxxg-mg59), `@hono/node-server` (GHSA-frvp-7c67-39w9), `esbuild` LOW (GHSA-g7r4-m6w7-qqqr), `body-parser` LOW (GHSA-v422-hmwv-36x6).

Os três `hono` e o `@hono/node-server` são os únicos que tocam superfície de **runtime** (o servidor REST); os demais estão em cadeias de ferramenta de build e teste. Nenhum é dep declarada do M15.

## Por que o veredito é PASS e não FAIL_INSECURE

Por `.claude/rules/deps-audit-golden-rule.md` § 2, o cap de severidade incide sobre CVE **em dep declarada pelo plano**. A única dep declarada é `pg`, com zero advisories. Os 3 HIGH são dívida transitiva pré-existente do repositório, anterior a este plano e independente dele.

Rebaixar o M15 por dívida que ele não introduziu seria tão incorreto quanto esconder a dívida. O caminho correto é o veredito honesto aqui e um issue separado rastreando o backlog de advisories.

## Próximos passos

1. Prosseguir para `/plan-confidence` — este veredito não bloqueia.
2. Rastrear os 3 HIGH em issue próprio, fora do escopo do M15.
