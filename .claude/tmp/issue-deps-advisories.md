## Impacto

`pnpm audit` reporta **13 advisories** na árvore de dependências: **3 HIGH**, 8 MODERATE, 2 LOW, 0 CRITICAL. Todas são **transitivas** — nenhuma é dependência direta declarada.

Quatro delas tocam superfície de **runtime** (o servidor REST `@usetheo/memory/server`): três em `hono` e uma em `@hono/node-server`. As demais estão em cadeias de ferramenta de build e teste (`eslint`, `drizzle-kit`, `@xenova/transformers`), cujo alcance é a máquina de desenvolvimento e o CI, não o artefato publicado.

**Severidade: MEDIUM** — nenhuma CRITICAL, nenhuma dependência direta, e o subconjunto de runtime é o menor. Mas 3 HIGH sem rastreamento é dívida invisível.

## Evidência

Coletado em 2026-07-24 na branch `develop`, via `pnpm audit --json`.

### HIGH

| Advisory | Pacote | Caminho | Superfície |
|---|---|---|---|
| GHSA-3jxr-9vmj-r5cp | `brace-expansion@<1.1.16` | `eslint > minimatch > brace-expansion` | build/test |
| GHSA-3jxr-9vmj-r5cp | `brace-expansion@>=3.0.0 <5.0.7` | `eslint-plugin-import > @typescript-eslint/parser > @typescript-eslint/typescript-estree > minimatch > brace-expansion` | build/test |
| GHSA-52cp-r559-cp3m | `js-yaml@>=4.0.0 <4.3.0` | `@apidevtools/swagger-parser > @apidevtools/json-schema-ref-parser > js-yaml` | build/test |

### MODERATE (runtime)

| Advisory | Pacote | Caminho |
|---|---|---|
| GHSA-xgm2-5f3f-mvvc | `hono@>=4.3.3 <4.12.27` | `hono` |
| GHSA-hvrm-45r6-mjfj | `hono@>=4.11.8 <4.12.27` | `hono` |
| GHSA-w62v-xxxg-mg59 | `hono@>=4.0.0 <4.12.27` | `hono` |
| GHSA-frvp-7c67-39w9 | `@hono/node-server@<2.0.5` | `@hono/node-server` |

As três de `hono` convergem para a mesma faixa corrigida: `>=4.12.27`.

### MODERATE / LOW (build e test)

`esbuild` GHSA-67mh-4wv8-2f99 (via `drizzle-kit`), `@opentelemetry/core` GHSA-8988-4f7v-96qf, `protobufjs` GHSA-f38q-mgvj-vph7 e GHSA-j3f2-48v5-ccww (via `@xenova/transformers > onnxruntime-web`), `esbuild` GHSA-g7r4-m6w7-qqqr, `body-parser` GHSA-v422-hmwv-36x6.

## Repro

```
pnpm audit --json
```

Determinístico contra o `pnpm-lock.yaml` atual.

## Sugestão de fix

Tratar em três lotes, do menor risco para o maior:

1. **`hono` e `@hono/node-server`** — subir para `hono >= 4.12.27` e `@hono/node-server >= 2.0.5`. É o único lote que toca runtime, então tem a maior prioridade apesar de serem MODERATE. Requer rodar a suíte de integração do servidor REST.
2. **`brace-expansion` e `js-yaml`** — os 3 HIGH. São transitivos de ferramentas; a correção provável é subir `eslint` / `eslint-plugin-import` / `@apidevtools/swagger-parser`, ou fixar a resolução via `pnpm.overrides`.
3. **Resto** — `esbuild`, `protobufjs`, `@opentelemetry/core`, `body-parser`. Cadeias de build e teste; agrupar num único PR de manutenção.

Avaliar habilitar Dependabot ou Renovate para que este backlog não se acumule de novo em silêncio.

## Escopo / relacionados

- **Fora do escopo do M15 (#122).** Descoberto pelo `/deps-audit` do plano `entity-boost-recall-contribution`, cujo veredito foi PASS: a única dependência declarada por aquele plano é `pg`, que está limpa. Rebaixar o M15 por dívida que ele não introduziu seria incorreto; esconder a dívida também. Daí este issue separado.
- Relatório completo da auditoria: `.claude/knowledge-base/audits/entity-boost-recall-contribution-deps-audit-2026-07-24.md`.

---

_Como foi encontrado: `/deps-audit` na fase PLAN do ciclo do M15. Sem secrets no corpo._
