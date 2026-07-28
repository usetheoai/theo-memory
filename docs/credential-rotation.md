# Rotação de credenciais

Procedimento para quando uma credencial deste projeto for exposta — em log, em chat, num
fork, num screenshot. Vale independentemente de quão restrito pareça o alcance: uma
credencial que saiu do cofre é uma credencial comprometida.

## Ordem que importa

Remover a credencial do GitHub **não a revoga**. O valor continua válido no emissor até
alguém revogá-lo lá. Fazer só a primeira metade dá a sensação de resolvido sem resolver.

```
1. Emitir a nova          ← primeiro, para não haver janela sem serviço
2. Atualizar quem consome
3. Revogar a antiga no EMISSOR   ← é isto que efetivamente fecha
4. Confirmar que a antiga morreu
```

## Por tipo

### Token do npm (`NPM_TOKEN`)

| Passo | Onde |
|---|---|
| Revogar | npmjs.com → Access Tokens → revoke |
| Substituir | `gh secret set NPM_TOKEN -R usetheoai/theo-memory` |

**O destino é não ter token.** Com trusted publishing configurado, o publish autoriza por
OIDC e o segredo deixa de existir — não há o que rotacionar. Ver
[`npm-trusted-publishing.md`](./npm-trusted-publishing.md).

### Chave de API (`theo_live_*`)

Há **três populações distintas** com o mesmo prefixo, e revogar na errada não faz nada:

| População | Emitida por | Revogada em |
|---|---|---|
| Cliente | dashboard do control plane | control plane |
| Platform-admin | bootstrap | `DELETE /v1/admin/keys/{id}` |
| Por tenant | TheMemory, a pedido do gateway | `DELETE /v1/admin/keys/{id}` |

O servidor guarda **hash SHA-256**, não o valor — então não há como recuperar uma chave
perdida, só cunhar outra. Isso é por design.

### Chave SSH

Remover o secret do GitHub não revoga nada: o acesso vem do `authorized_keys` do host. A
revogação real é remover a chave pública **lá**.

### `OPENAI_API_KEY`

Revogar na plataforma do provedor. Rotacionar aqui sem revogar lá deixa a chave antiga
funcionando indefinidamente.

## Verificar o alcance antes de entrar em pânico

Uma credencial que passou em conversa é diferente de uma que entrou no histórico do git —
a segunda é pública para sempre em cada clone, e reescrever histórico é proibido pelas
regras do projeto.

```bash
git log --all -S'<fragmento distintivo>' --oneline
```

Zero resultados: o alcance é a conversa. Basta rotacionar.
Resultados: a credencial está no histórico — rotacione **e** trate como pública.

## O que já protege

- **Gate de gitleaks no CI** — bloqueia chave `theo_live_` hardcoded (#126).
- **Scrub canônico** com sentinela de paridade de bytes (`tests/unit/scrub-parity.test.ts`)
  — redige tokens `npm_*` e `theo_live_*` nas saídas do CLI.

Nenhum dos dois cobre o que passa por fora da ferramenta. Colar credencial em conversa
continua sendo o vetor que nenhum gate pega.
