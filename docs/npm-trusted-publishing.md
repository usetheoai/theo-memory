# Publicação no npm sem token armazenado (trusted publishing)

O `publish-npm.yml` publica por **OIDC**. Não há segredo de longa duração no caminho de
publicação.

**Estado (2026-07-28):** o *trusted publisher* está registrado no npmjs.com
(`usetheoai/theo-memory` → `publish-npm.yml`, sem environment, permissões `npm publish` +
`npm stage publish`), e `NODE_AUTH_TOKEN` foi removido do workflow. Falta uma coisa: um
publish real que **prove** o caminho OIDC ponta a ponta.

## Por que isso importa

`NPM_TOKEN` é uma credencial de longa duração guardada no GitHub. Ela vaza como qualquer
segredo armazenado vaza: por log, por fork, por engano humano. O trusted publishing troca
uma **identidade efêmera** do próprio run por autorização de publish — não há valor
guardado para vazar, e a rotação deixa de existir como tarefa, porque não há o que
rotacionar.

## O que já está feito no repositório

| Peça | Onde |
|---|---|
| `id-token: write` | `permissions` do `publish-npm.yml` |
| `actions/setup-node` v6 | o npm só repassa o token OIDC a partir dessa versão |
| Node 22.14+ | abaixo disso o recurso não existe |
| npm ≥ 11.5.1 | passo explícito — o Node 22 embarca npm 10.x |

## A configuração no npmjs.com (feita)

Em **Settings do pacote `@usetheo/memory` → Trusted publishers**:

| Campo | Valor |
|---|---|
| Organization / user | `usetheoai` |
| Repository | `theo-memory` |
| Workflow filename | `publish-npm.yml` |
| Environment | *(vazio — o workflow não usa GitHub Environment)* |
| Allowed actions | `npm publish`, `npm stage publish` |

Três coisas amarram a autorização, e as três são verificadas por
`tests/integration/publish-npm-workflow.test.ts`: o **nome do arquivo** (renomear quebra o
publish, e o erro não diz que foi o rename), a **ausência de environment** (declarar um faz
o claim divergir) e `id-token: write` **sem sobrescrita no nível do job** — permissions de
job substituem as do workflow em vez de somar, e a falha resultante aparece como erro de
autenticação, o que manda quem investiga para o lado errado.

## Por que o token foi removido antes da prova

`NODE_AUTH_TOKEN` saiu do step de publish junto com o registro do publisher, em vez de
ficar como rede de segurança. A razão: **ele não seria rede, seria venda nos olhos.** Com o
token presente, o npm pode autenticar por ele e o publish passa mesmo com a configuração
OIDC errada — a migração pareceria concluída, e a descoberta viria no dia em que o token
fosse revogado, ou seja, no pior dia possível.

Falha ruidosa vale mais que sucesso ambíguo. O rollback é uma linha.

## Como provar

Rode `publish-npm.yml` por `workflow_dispatch` com `dry_run` **desligado** numa versão nova.
O `dry_run` não serve como prova: ele pula o step de publish inteiro, então não exercita
autenticação nenhuma.

## Depois da prova

1. `gh secret delete NPM_TOKEN -R usetheoai/theo-memory` — hoje ele já não é referenciado
   por workflow algum; segue no repositório só como caminho de rollback.
2. Revogue os tokens no npmjs.com. **Remover do GitHub não os invalida** — enquanto não
   forem revogados no emissor, continuam válidos para quem os tiver.

## Uma ressalva honesta

Isto **não** habilita *provenance* (`--provenance`). A geração de provenance exige
repositório público, e este é privado. São recursos distintos: o trusted publishing não
tem essa exigência. Quando o repositório abrir, `--provenance` passa a ser possível — e aí
vale um commit próprio.
