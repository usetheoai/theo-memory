<div align="center">

<img src="./assets/banner.svg" alt="Theo Memory — a camada de memória open-source para agentes de IA" width="840" />

**Persistente e multi-tenant — seus agentes lembram fatos, conversas e _skills executáveis_ entre usuários e sessões, no seu próprio Postgres.**

`remember` · `recall` · `forget` · `reflect` — um SDK TypeScript, uma API REST, um servidor MCP.
Funciona com qualquer LLM. Sem banco de grafos. Sem lock-in. Apache-2.0.

[![License](https://img.shields.io/badge/license-Apache--2.0-7C3AED?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-1%2C500%2B%20passing-brightgreen?style=flat-square)](#testes)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](#docker)
[![MCP](https://img.shields.io/badge/MCP-4%20tools-FF6B35?style=flat-square)](#loops-de-agente-via-mcp)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-6BA539?style=flat-square&logo=openapiinitiative&logoColor=white)](#api-rest)
[![Status](https://img.shields.io/badge/status-pre--release-orange?style=flat-square)](#status)

[English](./README.md) · **Português (BR)**

**Parte do [Theo](https://usetheo.dev) — a plataforma aberta para agentes de IA.** [Saiba mais →](https://usetheo.dev)

</div>

> **O [README em inglês](./README.md) é a versão canônica.** Esta tradução é mantida à mão e pode
> ficar para trás. Em caso de divergência, o inglês vence — e uma correção lá é sempre bem-vinda.

---

## Conteúdo

**Comece aqui** — [Por que](#por-que-theo-memory) · [Requisitos](#requisitos) · [Início rápido](#início-rápido) · [Recursos](#recursos)

**Use** — [SDK](#api) · [API REST](#api-rest) · [MCP](#loops-de-agente-via-mcp) · [CLI](#cli) · [Docker](#docker)

**Opere** — [Multi-tenancy e RBAC](#multi-tenancy-e-rbac) · [CI/CD](#cicd) · [Arquitetura](#arquitetura) · [Testes](#testes)

**Decida** — [O que é distintivo](#o-que-é-distintivo) · [Roadmap](#roadmap) · [Status](#status) · [Suporte](#suporte) · [Contribuindo](#contribuindo) · [Licença](#licença)

**Documentação mais profunda** — este README é o passeio; estes são os manuais:

| Documento | O que cobre |
|---|---|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Fronteiras de camada, as portas DIP, pipelines de escrita e busca |
| [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) | Deploy, migrations, rotação de chave, resposta a incidente |
| [`docs/EVALUATION.md`](./docs/EVALUATION.md) | Como a qualidade de retrieval é medida, e contra o quê |
| [`docs/adrs/`](./docs/adrs/) | Registros de decisão de arquitetura |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) · [`SECURITY.md`](./SECURITY.md) · [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) | Fluxo de contribuição, reporte de vulnerabilidade, regras da comunidade |

*(Os documentos acima estão em inglês.)*

---

## Por que Theo Memory

**Toda sessão começa do zero.** Seu agente repergunta o que o usuário já contou, esquece o último
ticket de suporte, reaprende o mesmo procedimento. O Theo Memory dá a ele **memória persistente,
escopada e pesquisável** em quatro verbos: `remember` · `recall` · `forget` · `reflect`.

Assim seu agente consegue lembrar que a Alice é vegetariana, que o último ticket era sobre cobrança,
ou que o script de deploy precisa da flag `--force` às terças — entre usuários, sessões, e até como
**skills executáveis reutilizáveis**.

- **Roda na sua infra** — Postgres + pgvector puro, sua chave de LLM. Sem banco de grafos, sem lock-in de fornecedor, Apache-2.0.
- **Três formas de plugar** — SDK TypeScript, API REST (OpenAPI 3.1), ou servidor MCP (funciona com Claude, Cursor, e qualquer agente MCP).
- **Multi-tenant desde o primeiro dia** — isolamento por workspace + RBAC `owner`/`admin`/`member`, no pacote **gratuito** (não numa camada paga).

```ts
import { createLocalMemory, PgvectorStore } from '@usetheo/memory';

const memory = await createLocalMemory({ vectorStore, embedder, llm });

// Seu agente lembra
await memory.user('alice').remember('Prefers dark mode. Speaks Portuguese.');

// Seu agente recorda
const facts = await memory.user('alice').recall('UI preferences');
// → [{ text: 'Prefers dark mode', score: 0.94 }]
```

## Recursos

- **Escopo de três camadas** — `user` (entre sessões) · `session` (conversa) · `agent` (procedural) + `skills` (biblioteca de código-como-skill)
- **API de 4 verbos** — `remember` · `recall` · `forget` · `reflect` — consistente em todas as camadas
- **Retrieval híbrido** — semântico (cosseno) + BM25 (lexical) + boost de entidade, com gate por threshold
- **Extração de fatos por LLM** — pipeline de 8 fases extrai fatos estruturados de texto livre
- **Consultas bi-temporais** — `recall({ asOf })` para snapshots de memória num instante do passado
- **Atribuição multi-peer** — rastreie quem disse o quê com `{ attributedTo: 'bob' }`
- **Filtro por categoria** — filtro `?category=` server-side com índice btree
- **Cache semântico de recall** — consultas quase idênticas reaproveitam resultados em cache (similaridade de cosseno)
- **Diversificação MMR** — reranking opcional para diversidade de resultados
- **Ciclo de vida de auth** — bearer tokens, chaves de API no formato Stripe, ponte OIDC
- **Multi-tenant + RBAC** — isolamento por workspace (acesso cross-tenant é `404`, nunca `403`) + membros/papéis (`owner`/`admin`/`member`) com guardas de último-owner e anti-escalação — veja [Multi-tenancy e RBAC](#multi-tenancy-e-rbac)
- **Três superfícies** — API REST (Hono + OpenAPI 3.1) · servidor MCP · CLI
- **Drop-in de OpenMemory** — `themory mcp --compat openmemory` serve a superfície de ferramentas do OpenMemory sobre SSE para Cursor / Claude Desktop / Windsurf / Cline
- **Embedder selecionável** — `THEOMEM_EMBEDDER=local` (Xenova MiniLM on-device) ou `openai` (`text-embedding-3-small`, sem modelo local)
- **Pronto para Docker** — imagem distroless (~170 MB comprimida / ~541 MB descomprimida no disco) com healthcheck
- **Observável** — 56 eventos OpenTelemetry tipados + spans por handler
- **Testado** — ~970 testes de contrato/unidade + 540+ de integração contra pgvector real, em 400+ arquivos de teste

## Requisitos

| | Versão | Por quê |
|---|---|---|
| Node.js | ≥ 20 | Runtime |
| PostgreSQL | ≥ 14 com [`pgvector`](https://github.com/pgvector/pgvector) ≥ 0.5 | Armazenamento e busca vetorial — a imagem padrão é `ankane/pgvector:v0.5.1` |
| Uma chave de API de LLM | — | Extração de fatos e reflexão. Qualquer endpoint compatível com OpenAI funciona via `OPENAI_BASE_URL` |
| Um embedder | — | On-device por padrão (sem chave); embeddings da OpenAI são opcionais — veja [Início rápido](#início-rápido) |

`pnpm` é necessário para buildar a partir do fonte — isto é um workspace pnpm, então `npm install` não conecta os pacotes corretamente.

## Início rápido

> **Como isto é distribuído hoje.** São dois artefatos diferentes. O **SDK** está no npm —
> `npm install @usetheo/memory`. O **servidor, o servidor MCP e o CLI `themory`** vêm na
> **imagem Docker**; não há binário npm para eles, então `npx themory` não existe.
> Rode-os a partir da imagem, ou de um clone — veja [Contribuindo](#contribuindo).

```bash
# 1. Suba Postgres + pgvector
docker run -d --name pgvector -e POSTGRES_USER=themem -e POSTGRES_PASSWORD=themem \
  -e POSTGRES_DB=themem -p 5432:5432 ankane/pgvector:v0.5.1

# 2. Suba o servidor — ele aplica as migrations pendentes antes de abrir a porta
docker run -p 8080:8080 \
  -e THEOMEM_PG_URI=postgresql://themem:themem@host.docker.internal:5432/themem \
  -e OPENAI_API_KEY=sk-... \
  -e THEOMEM_EMBEDDER=openai \
  ghcr.io/usetheoai/theo-memory:0.1.0-alpha
```

No Linux, troque `host.docker.internal` pelo IP do host ou rode os dois containers na mesma rede
Docker. A partir de um clone, o equivalente ao passo 2 é `pnpm run build && node dist/agent-tools/cli.js server`.

**Seleção do embedder** — defina `THEOMEM_EMBEDDER`:

- `local` (padrão) — Xenova MiniLM, 384 dimensões, sem chave de API. Baixa o modelo no primeiro uso.
- `openai` — `text-embedding-3-small` da OpenAI, 1536 dimensões. Exige `OPENAI_API_KEY`; não precisa de modelo on-device e não faz download do HuggingFace. Recomendado para deploys em servidor/Docker.

A dimensão da migration segue o embedder escolhido, então defina `THEOMEM_EMBEDDER` **antes** do primeiro `db:push` / da migration de startup.

Experimente:

```bash
# Escreva uma memória
curl -X POST http://localhost:8080/v1/remember \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","text":"I drink espresso every morning"}'

# Consulte
curl -X POST http://localhost:8080/v1/recall \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","query":"coffee"}'
```

## API

### Escopos

```ts
// User — persiste entre sessões
await memory.user('alice').remember('Allergic to peanuts');

// Session — escopado a uma conversa
await memory.session('conv-42').remember('Discussed pricing tier B');

// Agent — procedimentos aprendidos
await memory.agent('support-bot').remember('Check invoices before opening a refund');

// Skills — trechos de código executável
await memory.skills('my-repo').add({
  description: 'Deploy to staging',
  code: 'sh("kubectl apply -f k8s/")',
  codeLanguage: 'typescript',
});
```

### Opções de recall

```ts
// Filtre por categoria
await memory.user('alice').recall('preferences', { category: 'food' });

// Consulta num instante do passado
await memory.user('alice').recall('address', { asOf: new Date('2025-01-15') });

// Filtre por quem disse
await memory.user('alice').recall('updates', { attributedTo: 'manager-bob' });

// Diversifique os resultados (MMR)
await memory.user('alice').recall('interests', { diversify: { lambda: 0.7 } });
```

## API REST

Construída sobre [Hono](https://hono.dev), com spec [OpenAPI 3.1](https://swagger.io/specification/) gerada automaticamente.

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/v1/remember` | Grava uma memória (o LLM extrai os fatos) |
| `POST` | `/v1/recall` | Busca híbrida — o envelope da resposta carrega um `recallId` (veja esquecimento auditável) |
| `POST` | `/v1/forget` | Delete soft ou hard |
| `POST` | `/v1/reflect` | Consolida episódico → semântico |
| `GET` | `/v1/scopes/:type/:id/memories` | Lista com filtro `?category=` |
| `GET` | `/v1/recall-traces/:recallId` | Por que cada candidato foi **descartado** (esquecimento auditável; opt-in, escopado ao workspace) |
| `GET`/`POST`/`PATCH`/`DELETE` | `/v1/members` | CRUD de membros do workspace (gate de papel: `admin`) |
| `GET` | `/v1/health` | Liveness (isento de auth) |
| `GET` | `/v1/openapi.json` | Spec (isenta de auth) |

**Segurança** — auth Bearer (`THEMEMORY_API_KEY`), rate limiting (30 escritas/min, 100 leituras/min), CORS, corpo limitado a 1 MB, ponte OIDC para multi-tenant.

### Esquecimento auditável (opt-in)

Todo recall descarta candidatos — matches abaixo do threshold, quase-duplicatas redundantes. O *motivo* normalmente se perde. Ao habilitar o tracing (`THEOMEM_RECALL_TRACE=true`), cada recall persiste uma linha por candidato **descartado**, com o detalhamento completo do score (semantic / bm25 / entity / composite / threshold) e o motivo do descarte (`semantic_gate` / `sub_threshold` / `nan` / `mmr_redundant`), indexado pelo `recallId` que a resposta do recall devolve:

```bash
# o recall devolve um recallId no envelope …
curl -s $URL/v1/recall -H "Authorization: Bearer $KEY" \
  -d '{"userId":"alice","query":"preferences"}' | jq .recallId
# … depois leia POR QUE cada candidato foi descartado (escopado ao workspace; 404 entre tenants)
curl -s $URL/v1/recall-traces/<recallId> -H "Authorization: Bearer $KEY" | jq .drops
```

Desligado por padrão (o recall fica byte-a-byte igual e não escreve nada). A leitura é escopada ao workspace de quem chama, na fronteira do store — um `recallId` de outro tenant devolve `404`. Pré-release; o custo de escrita é uma linha por candidato descartado por recall.

## Multi-tenancy e RBAC

Entregue um produto multi-tenant sem parafusar um serviço de auth separado. Duas camadas — **isolamento por workspace** e **acesso por papel** — são aplicadas server-side a partir da credencial, nunca do corpo da requisição. Ambas vivem no pacote gratuito.

### Isolamento por workspace

Toda chave de API resolve para um `workspace`. O `AuthVerifier` resolve um `Principal { workspaceId, userId, role, scopes }` a partir da credencial, e **toda** query de persistência é escopada por `principal.workspaceId`:

- **De onde vem o workspace** — da credencial, nunca do corpo. As três camadas de memória (`user` / `session` / `agent`) são partições *dentro* de um workspace; `workspace_id` é a âncora externa de tenant.
- **Como o isolamento é aplicado** — em nível de aplicação: uma coluna `workspace_id` desnormalizada em toda tabela consultada diretamente (`memories`, `entities`, `history`, `recall_cache`, …), composta primeiro em todo `WHERE`. O índice de dedup de `memories` começa por `workspace_id` (o mesmo fato, sob o mesmo usuário, em dois workspaces são duas linhas distintas).
- **Acesso cross-tenant é `404`, nunca `403`** — um `forget`/`GET` por id de linha de outro workspace não revela nada (sem vazamento de existência); a linha é invisível porque o filtro de `workspace_id` a exclui.
- **Toda superfície é coberta** — o caminho primário dos 4 verbos (`remember`/`recall`/`forget`/`reflect`) **e** o cache de recall opcional (a chave é prefixada com o workspace, `ws:<id>|…` → nenhum hit cruzado), o store de skills e as passadas de eviction (COUNT + candidatos + vizinho mais próximo são todos limitados ao workspace).
- **Ponte legada** — sem credencial / com a env `THEMEMORY_API_KEY`, tudo colapsa num único workspace `default`, então deploys single-tenant existentes continuam funcionando sem mudança.

```ts
// SDK: vincule um workspace; toda operação escopada abaixo fica isolada nele.
const wsA = memory.withWorkspace('acme');
await wsA.user('alice').remember('Prefers dark mode');
await wsA.user('alice').recall('UI preferences'); // só enxerga linhas de 'acme'
```

### Membros e papéis (RBAC)

Um workspace tem membros (`users` ↔ `workspace_users`, M:N), cada um com um papel: `owner` ⊇ `admin` ⊇ `member`.

- **Resolução de papel** — uma chave de API *age como* um membro; seu papel é resolvido pelo join da chave com a associação. **Negação por padrão:** uma chave sem linha de associação resolve para o menos privilegiado, `member`, nunca `owner`.
- **Gate de rota** — rotas de gestão (`/v1/members`, `/v1/admin/keys`) exigem `requireRole('admin')` (401 precede 403); os verbos de RAG seguem abertos a qualquer membro.
- **Invariante do último owner** — um workspace **nunca pode perder seu último owner**: rebaixar/remover roda numa transação com `SELECT … FOR UPDATE` no escopo do workspace antes da checagem de contagem, então dois rebaixamentos concorrentes não conseguem correr até zero owners (o segundo devolve `409`).
- **Anti-escalação** — um admin **não pode cunhar uma chave que o supere**: vincular uma chave a um membro de papel superior é `403`, a um não-membro é `422`, a um membro igual ou inferior é `200`. A chave cunhada carrega o `workspace_id` de quem a cunhou.
- **Fail-closed** — se o backend de auth falhar durante a resolução de papel, a requisição recebe um `503` explícito — nunca um default privilegiado.

```bash
# Adicione um membro por e-mail (gate de admin). Cria o usuário global se for novo.
curl -X POST $BASE/v1/members \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"email":"bob@acme.com","role":"member"}'
# → 201 { "member": { "userId": "...", "email": "bob@acme.com", "role": "member", ... } }

# Promova a admin (seguro quanto ao último owner → 409 se fosse orfanar o workspace).
curl -X PATCH $BASE/v1/members/$USER_ID \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"role":"admin"}'

# Cunhe uma chave de API vinculada a um membro (anti-escalação: 403 se o alvo o superar).
curl -X POST $BASE/v1/admin/keys \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"name":"bob-agent","scopes":["memory:read","memory:write"],"user_id":"'$USER_ID'"}'
# → 200 { "id": "apk-…", "secret": "theo_live_…" }  (o secret aparece uma única vez)
```

> **Breaking change de pré-release.** O `AuthVerifier` evolui de `verify(token): Promise<boolean>` ("esta chave é válida?") para resolver `resolvePrincipal(token): Promise<Principal | null>` ("de quem é esta chave?") — o `Principal` carrega `{ workspaceId, userId, role, scopes }`. O `verify` permanece durante a janela de migração; implementações customizadas de verifier devem adicionar `resolvePrincipal`.

> **A gestão de chaves de admin é de nível de deploy.** Os endpoints `/v1/admin/keys/*` (com gate no scope `memory:admin`) gerenciam chaves no nível do deploy; a administração de membros por workspace é a superfície `/v1/members` acima. Trate `memory:admin` como privilégio de operador do deploy. O transporte MCP hoje vincula o workspace `default`; MCP por workspace é um follow-up rastreado.

## Loops de agente via MCP

Funciona com [Claude Code](https://claude.ai/claude-code), Claude Desktop, Cursor, e qualquer agente compatível com [MCP](https://modelcontextprotocol.io). O servidor MCP conecta os provedores **reais** (`LocalTransformerEmbedder` + `OpenAILLM`) — **não há stubs no caminho de produção**, então `OPENAI_API_KEY` é obrigatória no boot.

Adicione `themory` ao seu `.mcp.json` local do projeto (o Claude Code lê este arquivo da raiz do repositório — veja [`.mcp.json.example`](./.mcp.json.example)):

```json
{
  "mcpServers": {
    "themory": {
      "command": "node",
      "args": ["/caminho/absoluto/para/theo-memory/dist/agent-tools/cli.js", "mcp"],
      "env": {
        "THEOMEM_PG_URI": "postgresql://themem:themem@localhost:5432/themem",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

O caminho aponta para um **build a partir de um clone** (`pnpm install && pnpm run build`). Não
existe binário npm para `npx` — veja [Início rápido](#início-rápido). Para rodar o servidor MCP a
partir da imagem Docker, use o transporte streamable-HTTP abaixo em vez do stdio.

`OPENAI_BASE_URL` é respeitada para gateways compatíveis com OpenAI — por exemplo, aponte para o OpenRouter com `OPENAI_BASE_URL=https://openrouter.ai/api/v1` para usar o embedder local gratuito + um modelo de chat do OpenRouter.

**Ferramentas:** `remember` · `recall` · `forget` · `reflect`
**Transportes:** stdio (padrão) · streamable-HTTP (selecionado automaticamente quando `THEMEMORY_API_KEY` está definida)

#### streamable-HTTP sobre TLS (binds fora de localhost)

Quando o servidor MCP precisa escutar num host **fora de localhost** (por exemplo, para um container
alcançá-lo via `host.docker.internal`), HTTPS é obrigatório. Passe um par cert/key:

```bash
themory mcp --transport streamable-http --host 0.0.0.0 --port 18091 \
  --auth api-keys --tls-cert path/to/cert.pem --tls-key path/to/key.pem
```

As duas flags são obrigatórias juntas (uma sozinha falha imediatamente); fazer bind num host fora de
localhost sem elas é recusado. Bind em localhost segue em HTTP puro.

### Modo compatível com OpenMemory

Rode o servidor em modo drop-in de OpenMemory, para que clientes MCP já configurados para o OpenMemory MCP Server (Cursor, Claude Desktop, Windsurf, Cline) funcionem sem mudança:

```bash
themory mcp --compat openmemory      # ou env THEOMEM_MCP_COMPAT=openmemory
```

Isso expõe a superfície de ferramentas do OpenMemory — `add_memories` · `search_memory` · `list_memories` · `delete_memories` — como alias sobre os verbos nativos, servida pela convenção SSE do OpenMemory em `http://localhost:8765/{client}/sse/{user}` (`THEOMEM_MCP_HTTP_PORT` sobrescreve a porta). O escopo vem do caminho da URL (`{user}`); o isolamento por usuário vale nas quatro ferramentas, inclusive no delete (um usuário só apaga as próprias memórias). Sem dependência nova — reaproveita o `SSEServerTransport` do SDK de MCP. O `themory mcp` nativo permanece inalterado.

## Docker

```bash
docker pull ghcr.io/usetheoai/theo-memory:0.1.0-alpha

docker run -p 8080:8080 \
  -e THEOMEM_PG_URI=postgres://... \
  -e OPENAI_API_KEY=sk-... \
  -e THEOMEM_EMBEDDER=openai \
  ghcr.io/usetheoai/theo-memory:0.1.0-alpha
```

> A tag publicada no momento é `0.1.0-alpha`; tags de release são publicadas no GHCR pelo CI a cada tag de versão. A imagem padrão embute o embedder local (Xenova/ONNX) — defina `THEOMEM_EMBEDDER=openai` para usar a API de embedding da OpenAI (sem modelo on-device, sem download do HuggingFace em runtime).

Imagem distroless Node 22 — ~170 MB comprimida (o que o registry reporta) e ~541 MB descomprimida no disco (o que `docker images` mostra); medido em 2026-07-28 sobre `:develop`. Com gate do Trivy (zero CVE CRITICAL/HIGH) e healthcheck embutido. A imagem não tem shell, então subcomandos pontuais como `migrate` / `health` rodam sobrescrevendo o entrypoint para invocar o Node diretamente:

```bash
# Aplique migrations (ou `health`) contra a imagem distroless
docker run --rm --entrypoint /nodejs/bin/node \
  -e THEOMEM_PG_URI=postgres://... \
  ghcr.io/usetheoai/theo-memory:0.1.0-alpha /app/dist/agent-tools/cli.js migrate
```

## CI/CD

Toda imagem de release é **assinada com cosign, com verificação fixada por identidade**, e acompanha **SBOM + proveniência SLSA** — então dá para verificar o que você baixa. As imagens são publicadas no GHCR (e no Docker Hub) automaticamente a cada tag de versão.

| Gatilho | Canal | Resultado |
|---|---|---|
| push em `develop` | preview | `ghcr.io/usetheoai/theo-memory:develop` (+ `:develop-<short>`) |
| tag semver `v*` | release | `ghcr.io/usetheoai/theo-memory:<version>` — **assinada com cosign + verificação fixada por identidade** + SBOM/SLSA (+ Docker Hub `usetheo/theo-memory` quando `DOCKERHUB_TOKEN` está definida) |
| dispatch manual | smoke | build sem assinatura |

> **Imagem renomeada (2026-07-28): `themory` → `theo-memory`.** A imagem passa a carregar o nome do
> repositório, como em todos os projetos irmãos (`theo-lens`, `theo-rag`, `theo-db`).
>
> **O caminho antigo deixa de resolver — reaponte agora.** Uma versão anterior desta nota afirmava
> que as tags antigas seguiam baixáveis. Estava errado, e a medição corrigiu o registro: depois da
> renomeação, `ghcr.io/usetheoai/themory` não resolve tag alguma — nem `:develop`, nem `:0.56.0`,
> nem `:0.27.0`. O host de dev provou isso em produção, falhando toda reconciliação por 26 minutos
> até ser reapontado. Se você fixa o caminho antigo, fixe um **digest** que já tenha localmente;
> tag de lá não resolve.

> **Namespace mudou (2026-07-27).** As imagens eram publicadas em `ghcr.io/usetheodev/themory`. O
> repositório passou para a organização `usetheoai`, e um workflow rodando lá não consegue dar push
> no namespace da conta anterior, então as imagens novas vão para `ghcr.io/usetheoai/theo-memory`. **O
> pacote antigo não foi apagado** — tags históricas (por exemplo `:0.27.0`) seguem baixáveis pelo
> caminho antigo. O que o caminho antigo deixou de receber são builds novos, então fixe em
> `ghcr.io/usetheoai/...` daqui em diante.

Todo build roda um **gate do Trivy** (`severity: CRITICAL,HIGH`, `ignore-unfixed`, `exit-code: 1`,
com SHA fixado no reusable): o job falha diante de qualquer CVE CRITICAL/HIGH com correção
disponível na imagem, então uma imagem vulnerável nunca é publicada. Exceções passam pelo
[`.trivyignore`](./.trivyignore) com **data de expiração obrigatória** e justificativa — nunca um
ignore genérico.

## CLI

O `themory` é distribuído **dentro da imagem Docker**, não como binário npm. Rode-o a partir de um
clone (`node dist/agent-tools/cli.js <subcomando>`) ou contra a imagem, sobrescrevendo o entrypoint
— veja [Docker](#docker). Os comandos abaixo aparecem como `themory <subcomando>` por legibilidade.

```bash
themory server                      # Sobe a API REST
themory mcp                         # Sobe o servidor MCP (verbos nativos)
themory mcp --compat openmemory     # Servidor MCP compatível com OpenMemory sobre SSE (porta 8765)
themory migrate                     # Aplica migrations pendentes
themory health --deep               # Sonda embedder + LLM + banco

themory keys create --name app --scope memory:read,memory:write
themory keys list
themory keys revoke <id>
themory keys rotate <id>
```

### Verbos de memória

Os quatro verbos de memória são subcomandos de primeira classe — `remember`, `recall`, `forget`, `reflect`:

```bash
themory remember 'Likes espresso' --user alice
themory recall 'coffee' --user alice --top-k 5
themory forget <id> --hard
themory reflect --user alice
```

### Rotação de chave de API

Rotação sem downtime em 3 passos:

```bash
# 1. Crie uma chave nova (a antiga continua valendo)
themory keys create --name app-v2 --scope memory:read,memory:write

# 2. Aponte seu consumidor para a chave nova
#    (defina THEMEMORY_API_KEY no ambiente da sua aplicação)

# 3. Revogue a antiga assim que os consumidores migrarem
themory keys revoke <old-key-id>
```

As duas chaves valem ao mesmo tempo entre os passos 1 e 3 — sem janela de indisponibilidade. Para rotação atômica (criar + revogar numa chamada só), use `themory keys rotate <id>`.

## Arquitetura

Um workspace pnpm. `@usetheo/memory` (o SDK) é `packages/core`; todo o resto é interno.

```
packages/
├── core/              @usetheo/memory — o SDK (o único pacote publicado)
│   └── src/
│       ├── domain/dip/          23 portas DIP (um módulo por porta)
│       ├── domain/extraction/   pipeline de escrita de 8 fases
│       ├── domain/retrieval/    busca híbrida de 9 passos
│       └── infrastructure/db/   Postgres + pgvector (29 migrations)
├── api/               REST em Hono + auth + rate-limit + CORS
├── mcp/               servidor MCP (stdio + HTTP + SSE compatível com OpenMemory)
├── cli/               CLI themory (distribuído na imagem Docker, não no npm)
├── agent-core/        helpers compartilhados por cli e mcp
└── eval/              harness de qualidade de retrieval
```

**Caminho de escrita:**
```
Texto → Contexto → Recupera existentes → LLM extrai → Embed → Dedup → Persiste → Auditoria
```

**Caminho de busca:**
```
Query → Embed → ANN semântico → BM25 → Boost de entidade → Score → Threshold → Formata
```

As fronteiras de camada, cada porta DIP e cada fase dos pipelines estão documentadas em
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). As decisões e seus porquês vivem em
[`docs/adrs/`](./docs/adrs/).

## Testes

```bash
npm test                    # ~970 testes de contrato/unidade
npm run test:integration    # 540+ testes de integração (pgvector real)
npm run typecheck           # Zero erros
npm run lint                # Zero warnings
```

| Métrica | Valor |
|---|---|
| Testes de contrato / unidade | ~970 passando |
| Arquivos de teste | 400+ |
| Testes de integração | 540+ (contra `ankane/pgvector:v0.5.1`) |
| Linhas de código-fonte | ~20.000 |
| Interfaces DIP | 13 |
| Migrations | 29 |

Como a qualidade de retrieval é medida — datasets, juízes, e o que os números dizem e não dizem —
está em [`docs/EVALUATION.md`](./docs/EVALUATION.md). Deploy, migrations, rotação de chave e
resposta a incidente estão em [`docs/RUNBOOK.md`](./docs/RUNBOOK.md).

## O que é distintivo

Existem vários bons projetos Apache-2.0 e auto-hospedáveis neste espaço. Em vez de pontuar uns
contra os outros, aqui está o que o Theo Memory se compromete a entregar — confira cada linha
contra o código:

| Capacidade | O que este repositório entrega |
|---|---|
| Licença | Apache-2.0, para tudo abaixo — nenhuma capacidade trancada atrás de uma camada hospedada |
| Linguagem principal | **TypeScript**, de ponta a ponta |
| Store padrão | **Postgres + pgvector puro** — sem banco de grafos para operar |
| Modelo de memória | `user` · `session` · `agent` · **`skills`** |
| Retrieval híbrido | Semântico + BM25 + boost de entidade, com score aditivo |
| Ponto no tempo / temporal | Linhas bi-temporais, consultadas com `recall({ asOf })` |
| **Memória de código-como-skill** | Uma biblioteca de skills executáveis — armazene *e* recupere procedimentos, não só fatos |
| Servidor MCP de memória | 4 ferramentas nativas, mais uma superfície drop-in no formato OpenMemory |
| API REST | Hono + OpenAPI 3.1, derivada automaticamente dos schemas zod |
| Isolamento multi-tenant + RBAC | Fronteira de workspace + `owner`/`admin`/`member`, no pacote gratuito |

<sub>Os três que apontaríamos primeiro: memória de **código-como-skill** (uma camada para
procedimentos executáveis), **multi-tenancy com RBAC completo no pacote OSS**, e um deploy em **Postgres
puro**. O Theo Memory em si está em
**[pré-release](#status)** — veja Status para o que exatamente isso significa.</sub>

## Roadmap

| Versão | Marco | Status |
|---|---|---|
| v0.1 | Core + runtime local | **Entregue** |
| v0.3 | Ferramentas MCP de agente | **Entregue** |
| v0.4 | Pipelines de reflexão + esquecimento | **Entregue** |
| v0.6 | Biblioteca de skills | **Entregue** |
| v0.7 | Destilação episódico → semântico | **Entregue** |
| v1.1 | Multi-peer + bi-temporal | **Entregue** |
| v1.5 | Cache semântico de recall | **Entregue** |
| — | Compatibilidade com o formato MCP do OpenMemory (drop-in sobre SSE) | **Entregue** |
| — | Embedder selecionável (`THEOMEM_EMBEDDER` local / OpenAI) | **Entregue** |
| v1.0 | Contrato estável / production-ready | Em andamento |
| — | Tool-use agêntico + sandbox de injeção/comando | Planejado |
| — | Config em camadas + subcomando `themory config` | Planejado |
| — | Reranker cross-encoder opcional (DIP `Reranker`) | Planejado |
| — | Registro de embedders + provedores adicionais | Planejado |
| v2.0 | Retrieval adaptativo + backend de grafo | Planejado |

## Status

> **Pré-release — e honesto quanto a isso.** Completo em funcionalidade para o caso de uso central, coberto por ~970 testes de contrato/unidade e 540+ testes de integração contra um pgvector real, além de evidência contínua de uso real: nosso próprio time roda em cima dele. O SDK está no npm em `0.2.0`; o contrato ainda não está congelado, então trate versões minor como breaking. O rótulo `production-ready` espera a v1.0, quando congelarmos o contrato. Até lá você pode rodar, auto-hospedar e construir em cima — só preferimos dizer isso com todas as letras a estampar um selo que ainda não conseguimos defender.

## Suporte

| Quero… | Vá para |
|---|---|
| Reportar um bug ou pedir uma funcionalidade | [GitHub Issues](https://github.com/usetheoai/theo-memory/issues) |
| Fazer uma pergunta ou mostrar o que você construiu | [Discord](https://discord.usetheo.dev/) |
| Reportar uma **vulnerabilidade de segurança** | [`SECURITY.md`](./SECURITY.md) — por favor não abra uma issue pública |
| Entender uma decisão de design | [`docs/adrs/`](./docs/adrs/) |

## Contribuindo

Isto é um **workspace pnpm** — `npm install` não vai conectar os pacotes corretamente.

```bash
git clone https://github.com/usetheoai/theo-memory.git
cd theo-memory
corepack enable          # fixa a versão do pnpm a partir do package.json
pnpm install
pnpm run build           # obrigatório num clone novo — os pacotes resolvem via dist/
docker compose up -d pgvector
pnpm test
```

Issues, PRs e feedback são bem-vindos. Veja [CONTRIBUTING.md](./CONTRIBUTING.md) para as diretrizes,
[SECURITY.md](./SECURITY.md) para reportar vulnerabilidade, e
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

**Traduções.** O README em inglês é canônico. Ao mudar algo nele, atualize esta tradução no mesmo PR
quando puder — e se não puder, tudo bem: uma tradução defasada é melhor que nenhuma, desde que este
aviso continue aqui.

## Licença

[Apache-2.0](./LICENSE) — [usetheo.dev](https://usetheo.dev)

<div align="center">

[![Discord](https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.usetheo.dev/)
[![X](https://img.shields.io/badge/X-@usetheodev-000000?style=flat-square&logo=x&logoColor=white)](https://x.com/usetheodev)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-usetheodev-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://linkedin.com/company/usetheodev)

</div>
