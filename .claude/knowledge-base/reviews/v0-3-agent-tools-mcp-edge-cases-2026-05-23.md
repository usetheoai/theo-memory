# Discover Edge Case Review — v0-3-agent-tools-mcp-plan v1.0

Data: 2026-05-23
Discovery plan analisado: `.claude/knowledge-base/discoveries/plans/v0-3-agent-tools-mcp-plan.md`
Research questions analisadas: 8 (Q1-Q8 across 5 corners: tests/deps/tools/techniques/prior_art)
Edge cases encontrados: 7 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: `.claude/rules/discover-web-allowlist.txt` não existe — Q2 + Q7 web citations bloqueadas

- **Question afetada:** Q2 (deps — npmjs WebFetch), Q7 (prior_art — MCP spec WebFetch)
- **Família:** Reference path / Method
- **Cenário:** Cycle-discover.md v1.1 § Hard gates #5 exige que toda URL citada venha de domínio em `.claude/rules/discover-web-allowlist.txt`. O arquivo NÃO EXISTE (verificado via `[ -f ]`) — é Downstream change #4 do cycle-discover.md v1.1 ainda não-shipado. `/discover-execute` ao tentar validar a URL contra o allowlist vai fail-closed (não há allowlist para consultar).
- **Impacto:** Q2 e Q7 não podem materializar suas WebFetches sem allowlist. /discover-execute marcaria as duas como BLOCKED com motivo "allowlist file missing". O `prior_art` corner ficaria sub-populado.
- **Fix sugerido:** Criar `.claude/rules/discover-web-allowlist.txt` com as 4 entradas mínimas necessárias para v0-3 (`anthropic.com`, `spec.modelcontextprotocol.io`, `modelcontextprotocol.io`, `npmjs.com`) ANTES de invocar `/discover-execute`. Adicionar passo ADR D6 no plano: "Pre-execute: create discover-web-allowlist.txt OR halt".

### EC-2: `.claude/knowledge-base/discoveries/snapshots/` não existe — snapshot writes bloqueados

- **Question afetada:** Q2 (npm snapshot), Q7 (MCP spec snapshot)
- **Família:** Reference path
- **Cenário:** Halt-loop checkpoints do plano dizem "snapshot file exists at `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/{sha256}.md`". Mas o diretório `snapshots/` (e o sub-dir do slug) NÃO EXISTEM (verificado via `[ -d ]`). `/discover-execute` tentando escrever em path inexistente vai falhar com ENOENT.
- **Impacto:** Q2 e Q7 BLOCKED por snapshot-write-failure. /discover-confidence subsequente teria URL citations sem snapshot → cap `snapshot_missing_or_corrupt` per discover-blueprint-golden-rule.md v1.1.
- **Fix sugerido:** Adicionar primeiro passo no halt-loop driver: `mkdir -p .claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp` ANTES da primeira WebFetch. Documentar em halt-loop checkpoints Q2/Q7. OU criar o dir manualmente como pre-flight ao invocar /discover-execute.

## SHOULD TEST

### EC-3: Q7 URL canonical lock — WebSearch retorna múltiplos resultados, snapshot precisa hash estável

- **Question afetada:** Q7 (MCP spec)
- **Halt-loop checkpoint sugerido:** Antes de escrever snapshot Q7, /discover-execute deve LOCAR uma URL canônica e logar no progress JSON. Sugerido: `test_q7_url_locked_before_snapshot — assertion: progress.questions.Q7.locked_url is non-null AND ∈ {spec.modelcontextprotocol.io, anthropic.com/news/model-context-protocol}`. Se WebSearch retorna ambos OR um terceiro, o investigador escolhe DETERMINISTICAMENTE o primeiro com header `<title>Model Context Protocol Specification</title>`. Documenta a escolha no snapshot header line 1.

### EC-4: Q3 inclui `mcp/__init__.py` que está VAZIO (0 LoC) — wasted Read call

- **Question afetada:** Q3 (tools/letta)
- **Halt-loop checkpoint sugerido:** Antes do Fase B de Q3, /discover-execute valida tamanho do arquivo via `wc -l`. Se `mcp/__init__.py` tem 0 LoC (verificado nesta review: confirmed empty), skip the Read OR document the empty-init significance (Python package marker only — sem barrel re-exports). Atualizar plan's Q3 Fase B para: "Read `base_client.py` directly (153 LoC); `__init__.py` is empty per pre-check".

### EC-5: D5 find pattern pode missar arquivos Python MCP escondidos no Mem0

- **Question afetada:** Q5 (techniques/mem0)
- **Halt-loop checkpoint sugerido:** D5 atual diz "find `.claude/knowledge-base/references/mem0 -name '*.py' -path '*mcp*'`". Isso casa apenas com paths/nomes contendo "mcp". Um arquivo nomeado `tools_server.py` que IMPLEMENTA MCP wouldn't match. Sugerido: além do `find -path '*mcp*'`, rodar `grep -rln 'tools/list\|tools/call\|@modelcontextprotocol\|JSONRPCRequest' .claude/knowledge-base/references/mem0 --include="*.py"`. Se a segunda busca retornar zero hits, a conclusão "Mem0 sem MCP first-party" fica mais forte; se retornar algum hit, ajustar Q5 para investigar esse arquivo extra.

## DOCUMENT

### EC-6: Q3 borderline corner — "tools" vs "techniques" classification

- **Risco aceito:** Q3 ("How is the tool-provider code SHIPPED?") investiga o **packaging signal** do código que expõe ferramentas. O template do cycle-discover.md define "tools" corner como "Build/test/lint tooling. CI shape. Local dev story." — packaging signal está na fronteira (build/distribute toolchain expectation). Q3 também toca em estrutura de módulo, o que seria "techniques". Aceito: classificação como "tools" porque o ÂNGULO é "como o package se distribui", não "qual algoritmo o package implementa" (esse é Q4). /discover-confidence pode flagar como "borderline" no review — ADR-style note no blueprint deixa clear a escolha + por quê.

### EC-7: `../theokit-sdk/` working state não-pinado a um SHA

- **Risco aceito:** Q8 cita arquivos em `../theokit-sdk/packages/sdk/src/` mas o sibling repo é um working tree (não um clone --depth 1 imutável como `.claude/knowledge-base/references/`). Mudanças locais no ../theokit-sdk/ poderiam invalidar as citações entre /discover-execute write e /discover-confidence read. Aceito: mesmo standard que `.claude/knowledge-base/references/` (clone-at-a-moment-in-time); per D4, paths são held to Path.exists() standard, e o blueprint pode incluir o SHA do HEAD de ../theokit-sdk/ no momento do /discover-execute (`git -C ../theokit-sdk rev-parse HEAD`) como audit-trail signal. Não bloqueia o plano; documentar o snapshot mechanism + a SHA stamping na ADR D4 do blueprint produzido.

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 (tests/letta) | 0 | 0 | 0 | 0 |
| Q2 (deps/npm) | 2 | 2 (EC-1+EC-2 shared) | 0 | 0 |
| Q3 (tools/letta+langmem) | 2 | 0 | 1 (EC-4) | 1 (EC-6) |
| Q4 (techniques/letta) | 0 | 0 | 0 | 0 |
| Q5 (techniques/mem0) | 1 | 0 | 1 (EC-5) | 0 |
| Q6 (techniques/langmem) | 0 | 0 | 0 | 0 |
| Q7 (prior_art/MCP-spec) | 3 | 2 (EC-1+EC-2 shared) | 1 (EC-3) | 0 |
| Q8 (prior_art/sdk) | 1 | 0 | 0 | 1 (EC-7) |
| **Cross-question** | EC-1 + EC-2 hit Q2 AND Q7 (counted once each) | | | |

**Veredicto:** **DISCOVERY PLAN PRECISA DE AJUSTE**

2 MUST FIX items são INFRA prerequisites (`discover-web-allowlist.txt` + `snapshots/` dir) ambos derivados do cycle-discover.md v1.1 § Downstream changes ainda não-shipados. Sem essas duas precondições, /discover-execute vai HALT na primeira tentativa de WebFetch (Q2 ou Q7). 

**Recomendação:** humano bump plan v1.0 → v1.1 absorvendo:

- **ADR D6 (NEW)**: declarar como prerequisites the allowlist file + snapshots dir. Criar o allowlist com 4 domínios mínimos (`anthropic.com`, `spec.modelcontextprotocol.io`, `modelcontextprotocol.io`, `npmjs.com`) ANTES de /discover-execute. Adicionar `mkdir -p` ao halt-loop driver de v0-3-agent-tools-mcp.
- **Atualização halt-loop checkpoints**: Q3 nota que `__init__.py` está vazio (EC-4); Q5 amplia find pattern com grep secundário (EC-5); Q7 adiciona URL-lock-before-snapshot checkpoint (EC-3).
- **Atualização ADR D4**: explicitar SHA-stamping de `../theokit-sdk/` HEAD no blueprint produzido por /discover-execute (EC-7).
- Q3 corner classification mantida como "tools" (EC-6 doc-only).

Após bump v1.0→v1.1, re-rodar `/discover-edge-cases v0-3-agent-tools-mcp` confirmar absorção, depois `/discover-execute v0-3-agent-tools-mcp`.
