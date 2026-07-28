# Publicação no npm sem token armazenado (trusted publishing)

O `publish-npm.yml` está pronto para publicar por **OIDC**, sem segredo de longa duração.
Falta um passo que só o dono do pacote pode dar: registrar o *trusted publisher* no
npmjs.com. Enquanto ele não existir, o publish continua usando `NPM_TOKEN` — a ponte
segue funcionando, e nada quebra.

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

## O que falta — no npmjs.com

Em **Settings do pacote `@usetheo/memory` → Trusted publishers → Add**, informe:

| Campo | Valor |
|---|---|
| Organization / user | `usetheoai` |
| Repository | `theo-memory` |
| Workflow filename | `publish-npm.yml` |
| Environment | *(deixe vazio — o workflow não usa GitHub Environment)* |
| Allowed actions | `npm publish` |

O nome do workflow precisa bater **exatamente**. É ele que amarra a autorização a este
arquivo específico: outro workflow do mesmo repositório não consegue publicar.

## Como confirmar que funcionou

Rode o `publish-npm.yml` por `workflow_dispatch` com `dry_run` desligado numa versão nova.
No log do step `Publish`, o npm informa que autenticou por OIDC. Se ele cair no token, a
configuração não está valendo — reveja o nome do workflow.

## O último passo, e só depois da prova

Com um publish por OIDC comprovado:

1. Remova `NODE_AUTH_TOKEN` do step `Publish`.
2. Remova o secret `NPM_TOKEN` do repositório.
3. Revogue o token no npmjs.com — remover do GitHub não o invalida.

Fazer isso **antes** da prova quebra a próxima release. Fazer depois elimina a credencial
de verdade.

## Uma ressalva honesta

Isto **não** habilita *provenance* (`--provenance`). A geração de provenance exige
repositório público, e este é privado. São recursos distintos: o trusted publishing não
tem essa exigência. Quando o repositório abrir, `--provenance` passa a ser possível — e aí
vale um commit próprio.
