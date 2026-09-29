# Gaps conhecidos da auditoria de CI/CD

Auditoria de **2026-07-28**. Este documento existe para que o que **não** foi
fechado seja rastreável — não para justificar o que ficou aberto.

Um ponto que não está aqui e não está corrigido no código simplesmente não foi
visto. Se você encontrar um, adicione a linha antes de corrigir: a lista é o
contrato, o commit é a consequência.

## O que a auditoria não cobre

Delimitar isto importa mais que a lista de gaps. Um leitor que assume cobertura
maior do que existe confia em garantia que ninguém deu.

- **Conteúdo da imagem.** O gate do Trivy barra CVE CRITICAL/HIGH no build. A
  auditoria olhou como a imagem é **construída e publicada**, não o que existe
  dentro dela ao longo do tempo — uma CVE divulgada depois do build não é vista
  por ninguém até o próximo push.
- **Código da aplicação.** SAST e varredura de segredo rodam no `security-sast`,
  mas a auditoria não revisou o código-fonte em si.
- **Custo real da frota.** Os minutos não transitam pelo billing do GitHub, então
  o custo é **estimado a partir de segundos de runner**, nunca medido no extrato.
  Qualquer número de custo neste repositório carrega essa ressalva.

## Gaps

Cada linha abre com o **ID do achado** da auditoria de 2026-07-28 que a originou.
Sem o ID não há rastro: a próxima auditoria re-descobre tudo do zero, e este
documento vira prosa solta em vez de continuidade.


| Gap | Por que não foi fechado agora | Quem decide | Como sair daqui |
|---|---|---|---|
| `DO-D1-no-branch-protection` · `DO-D5-no-segregation` — não existe branch protection. Medido: a API responde `403 — Upgrade to GitHub Pro or make this repository public`. Nenhum check é obrigatório; um PR pode ser mergeado com a suíte vermelha. | Não é um defeito de configuração — é um limite do plano da conta. Nenhuma mudança neste repositório o resolve. | Dono da organização | Tornar o repositório público (o plano libera o recurso) ou migrar para um plano pago. Até lá, o hook local garante a **origem** do trabalho; nada garante a **revisão**. |
| `DO-D5-no-change-audit-trail` — **CLOSED on 2026-09-29.** `build-publish.yml` was a **vendored copy**, because the reusable lived under another owner and GitHub only shares a private reusable within one owner. The engine moved to `usetheoai`; `publish.yml` now calls `usetheoai/theo/.github/workflows/build-publish.yml` pinned by commit SHA, and the copy is deleted. | Four properties of the copy did not carry over, knowingly: `cache-to` skipped on tags, SBOM/provenance only on releases (`attest`), release-only `linux/arm64` (`platforms`), and the `digest`/`image_ref` outputs. Identity-pinned `cosign verify` is off: the shared reusable pins the identity to the caller repo while the certificate carries the reusable's path (measured on Rekor). | Platform team (owner of the shared reusable) | Add the missing inputs to the shared reusable and derive the verify identity from the reusable itself, then bump the SHA pin here. `tests/integration/publish-workflow.test.ts` refuses any input the pinned reusable does not declare. |
| `DO-D5-control-not-operating` · `DO-D5-window-too-short` — controles SOC 2 Type II não verificados. Design foi avaliado; **efetividade operacional** na janela não. | Type II exige histórico do provedor sobre a janela inteira; a auditoria rodou sobre configuração e sobre um recorte de execuções, não sobre a janela completa. | Quem conduzir a auditoria externa | Rodar a auditoria com a janela declarada e acesso à API de histórico. Até lá, todo controle deve ser lido como `not_verified`, nunca como `effective`. |
| `DO-D4-wasted-minutes` — a taxa de despejo do cache de build não foi medida. A correção da T3.3 se apoia no mecanismo documentado (teto por repositório, LRU), não numa medição deste repositório. | Não há métrica exposta para despejo de cache. Medir exigiria instrumentar os builds ao longo de semanas. | Time de plataforma | Se o tempo de build de `develop` regredir, instrumentar antes de mexer no escopo de novo — a hipótese é falsificável. |
| `DO-D2-org-wide-secret` · `DO-D2-no-rotation-evidence` — segredos removidos deste repositório continuam existindo no emissor. `GOMOD_TOKEN` saiu do workflow e `DOCKERHUB_*` nunca teve credencial, mas remover a referência não revoga nada. | Revogação é ação no emissor, fora do alcance de um commit. E o `GOMOD_TOKEN` é legítimo em outro repositório, onde há módulo Go de verdade. | Quem criou cada credencial | Seguir `docs/credential-rotation.md`. Remover a referência reduz superfície; só a revogação encerra o risco. |
| `DO-D1-mutable-release` — não existe tag versionada publicada sob o nome novo da imagem. Medido: `latest` e `develop` resolvem; `0.56.0` não. | O nome da imagem mudou recentemente e nenhuma release versionada foi cortada desde então. | Quem cortar a próxima release | Cortar uma release e então fixar `VERSION` no compose de produção, em vez de depender de `latest`. |
| `FLAKY-boot-import` — **FECHADO em 2026-07-28.** Três testes de boot falhavam por timeout de 15s de forma intermitente (medido: 0/3/4 falhas em três execuções da mesma árvore). Causa: `@usetheo/memory/recall-trace-pg` não estava mockado, e o `await import()` de cada arquivo pagava a transformação do grafo real — 14,0s em isolamento contra teto de 15s. | Fechado com o mock da fronteira nos três arquivos (nenhum teste asserta símbolo dela) — 14,0s → 5,7s medidos. Timeout explícito de 30s onde resta contenção de transformação entre os 12 workers, calibrado em ~4× o custo isolado. **Não foi "subir o teto"**: o custo evitável saiu primeiro. | — | Se voltar a estourar, quebrar a cadeia de import do boot; não subir o número de novo. Verificado: três execuções limpas consecutivas, 1529/1529. |
| `F-xval-2-multiarch` — the **multi-arch** build is no longer produced. It was release-only by design, and the shared reusable this repo calls since 2026-09-29 has no `platforms` input, so release tags are amd64-only like `:develop`. | Nothing that consumes this image runs on ARM today (measured: no ARM compute declared in the infrastructure repositories). An amd64-only image fails on a Graviton node with an obscure error. | Platform team (owner of the shared reusable) | Add a `platforms` input to the shared reusable, then pass `linux/amd64,linux/arm64` on `v*` tags here before any ARM node consumes this image. |
| `DO-D5-control-not-designed` — o pipeline valida identidade e saúde, não **comportamento**. Nada exercita um fluxo real de escrita e leitura contra a instância implantada. | Exigiria um ambiente de verificação pós-deploy que hoje não existe. | Time de plataforma | Um teste de fumaça pós-reconciliação que exerça o caminho real, não só `/v1/health`. |

## Como ler a coluna "Quem decide"

Ela nomeia **um papel**, não uma pessoa. Um gap sem dono é um gap que ninguém
cobra; um gap com dono errado é pior, porque a cobrança vai para quem não pode
resolver.
