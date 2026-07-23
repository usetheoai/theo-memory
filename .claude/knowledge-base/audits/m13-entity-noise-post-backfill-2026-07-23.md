# M13 — Benchmark pós-backfill de re-extração de entidades (T4.1)

- **Data:** 2026-07-23 (janela do backfill: 14:08:33 UTC → ~15:20 UTC)
- **Base:** themem live (app-dev, host 165.227.121.20), mesma base do baseline
- **Build:** `ghcr.io/usetheodev/themory:develop` @ `b808366` (deploy 14:07:40 UTC)
- **Método:** `themory reextract` (T3.1/T3.2) executado DENTRO do container `themory_app`
  (`docker exec -w /tmp themory_app /nodejs/bin/node /app/dist/agent-tools/cli.js reextract ...`);
  queries canônicas do baseline re-executadas via `docker exec themem_pgvector psql` —
  byte-a-byte as mesmas de `m13-entity-noise-baseline-2026-07-23.md`.

## Dry-run vs execução real

| Métrica | Dry-run | Pass 1 (real) | Pass 2 dirigida (`--restart`) |
|---|---|---|---|
| targets | 1776 | 1776 | 779 |
| processed | — | 1775 (1 skip `target_skipped_empty`) | 779 |
| llmCalls | 0 | 1775 | 779 |
| estTokens | 358 961 | 1 906 894 | 737 735 |
| duração | 0,4 s | 32,8 min | 19,0 min |
| entitiesCreated (novos links) | — | 9 304 | 1 374 |
| entitiesSuperseded | — | 616 | 203 |

- **Custo real ≈ 2,64M tokens** (gpt-4o-mini) ≈ **US$ 0,40–0,60**.
- **Honestidade sobre a estimativa (EC-7):** o dry-run estima `chars/4` só do TEXTO da
  memória; o prompt real embute o template de sistema (~1K tokens/chamada), que domina o
  custo → subestimou ~5x. Follow-up: incluir o overhead do template no estimador.
- **1 `deadlock detected`** no linking da pass 1 (fail-soft; a memória afetada foi coberta
  pela pass 2). Nenhum abort; o lote nunca parou.
- Alvos da pass 2 (779) > resíduo estimado (479) porque escritas de sessão continuaram
  durante a janela E memórias re-elegíveis (link de mecanismo vivo) entram na seleção.

## Queries canônicas — baseline → pós-pass-2 (conjunto vivo, `superseded_by IS NULL`)

| Métrica | Baseline | Pós-backfill | Alvo DoD | Veredito |
|---|---|---|---|---|
| total vivo | 1658 | 9030 | — | — |
| ALL-CAPS (`^[A-Z]{2,}$`) | 129 | 378 | ≤ 10 | **NÃO ATINGIDO** (ver composição) |
| Nomes ≤ 3 chars | 106 | 469 | ≤ 10 | **NÃO ATINGIDO** (ver composição) |
| Mecanismo vivo (PROPER+COMPOUND+QUOTED) | 1658* | 1401 | — | −819 via supersede |
| Mecanismo NOVO na janela | — | **0** | 0 | ✅ **ATINGIDO** (write path D1) |
| Memórias vivas sem grafo | 1029 | 218 | 0 elegíveis | −79%; as 218 = LLM extraiu 0 entidades (não-elegíveis) OU janela de escrita |

\* baseline era 100% mecanismo (1409+231+18).

## Composição do resíduo (por que ≤10 não fechou nesta passada)

O contador ALL-CAPS bruto SUBIU porque a extração semântica cria siglas **legítimas e
tipadas** (API, CD, M13, TDD → CONCEPT/PRODUCT/ORG) — 254 das 358 ALL-CAPS da pass 1 eram
semânticas. A régua que mede o PROBLEMA do #111 (ruído mecânico visível no dashboard):

| Ruído mecânico VISÍVEL (com links vivos) | Pós-pass-1 | Pós-pass-2 |
|---|---|---|
| ALL-CAPS mecanismo | 101 | **85** |
| ≤3 chars mecanismo | 72 | **58** |

### Amostra qualitativa (20 resíduos mecânicos visíveis, pós-pass-1)

| Nome | Type | Links | Veredito |
|---|---|---|---|
| HIGH | PROPER | 5 | ruído (palavra de status) |
| READYTOMERGE | PROPER | 5 | ruído (token de verdict) |
| ML | PROPER | 4 | ambíguo (sigla real, mas link espúrio) |
| GREEN | PROPER | 3 | ruído |
| M14 | PROPER | 3 | ruído de contexto (id de milestone) |
| TDD | PROPER | 2 | sigla real com rótulo velho |
| SHIPPABLEWITHCAVEATS | PROPER | 2 | ruído |
| OK | PROPER | 2 | ruído |
| HIGH (dup escopo) | PROPER | 2 | ruído |
| RED | PROPER | 2 | ruído |
| Os | PROPER | 2 | ruído (pronome) |
| READYTOMERGE (dup) | PROPER | 2 | ruído |
| POST | PROPER | 2 | ruído (verbo HTTP) |
| INFO | PROPER | 2 | ruído |
| FORBIDDEN | PROPER | 2 | ruído |
| PASS | PROPER | 2 | ruído |
| CONFIRMED | PROPER | 2 | ruído |
| README | PROPER | 1 | ambíguo |
| ROADMAP | PROPER | 1 | ambíguo |
| HTML | PROPER | 1 | sigla real com rótulo velho |

Veredito da amostra: **17/20 ruído puro ou rótulo velho** — nenhum deles é re-emitido pelo
LLM (comportamento CORRETO), logo o supersede por identidade (ADR D2) não os alcança.

### Amostra qualitativa (10 semânticas novas)

ArangoDB→PRODUCT, Hightouch→ORG, golang-migrate→PRODUCT, Qwen3 LM→PRODUCT,
blueprint→CONCEPT, veredito→CONCEPT, drift de linha→CONCEPT, Prompt Engineering
Guide→CONCEPT, core→CONCEPT (fraco), @theokit/di→ORG (erro de type; deveria ser PRODUCT).
Qualidade: 8/10 corretas.

## Achado estrutural (honesto — NUNCA maquiar)

**O supersede por identidade re-TIPA, mas não APOSENTA.** Ruído confirmado (o LLM
re-processou a memória-fonte e NÃO re-emitiu o nome) fica vivo com os links falsos do
extrator antigo. As duas passadas esgotaram o remédio previsto no plano; o fechamento do
≤10 exige o slice **noise retirement**: remover os links falsos não-reconfirmados e
recolher as linhas órfãs pelo mesmo contrato do GC #110 (evento tipado, contagens no
relatório) — precedentes #115 (listagem live-only) + #110 (GC de órfãs). Registrado como
follow-up executável ANTES do release do M13 (mini-ciclo planejado; sem SQL manual em base
viva).

## Reprodução

```bash
# no host app-dev
docker exec -w /tmp themory_app /nodejs/bin/node /app/dist/agent-tools/cli.js reextract --dry-run --json
docker exec -w /tmp themory_app /nodejs/bin/node /app/dist/agent-tools/cli.js reextract --json
# queries: ver m13-entity-noise-baseline-2026-07-23.md (byte-a-byte)
```
