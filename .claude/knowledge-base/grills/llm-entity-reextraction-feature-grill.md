---
slug: llm-entity-reextraction
generated_by: roadmap-feature
date: 2026-07-23
status: completed
target_milestone: M13
---

# Grill — M13 llm-entity-reextraction (corrige #111)

## Q1 — O que é / por que agora
**Resposta (recomendada, confirmada):** Fase B do blueprint `multilingual-entity-extraction`
(SHIPPABLE 100, 2026-07-19): backfill/re-extração em batch via LLM com types SEMÂNTICOS
(PERSON/ORG/PRODUCT/CONCEPT/…) sobre a base existente (~840 entidades; memórias
verbatim/importadas sem grafo desde que a Phase A D1 removeu a extração inline do
`infer:false`). Por que agora: a análise da tela Entities (2026-07-23) MEDIU o ruído —
80 entidades ALL-CAPS (LOW/MEDIUM/HIGH/BLOCKER/UI/API…), 53 nomes ≤3 chars, fragmentos
truncados ("validation com"), types persistidos são rótulos de MECANISMO
(PROPER 734/COMPOUND 89/QUOTED 16) — dominando o ranking do dashboard e bloqueando a
coluna TYPE (#253 Fase 2). Issue: theo-memory#111.

## Q2 — Dependências
**Resposta (recomendada, confirmada):** M12 apenas (o mais recente; todos M0–M12 já [x] →
M13 elegível imediatamente). Infra consumida já shipped: entities/edges (M0–M2 do
context-graph), import (M12), ontologia (Item 15), write-pipeline LLM (Phase 2).

## Q3 — Definition of Done
**Resposta (recomendada, confirmada):**
1. Comando/job de re-extração batch (ex.: `themory reextract`) idempotente, com provenance
   (Princípio 3 — cada substituição auditável) e custo LLM bounded (batching #112-style).
2. Types SEMÂNTICOS (PERSON/ORG/PRODUCT/CONCEPT/…) persistidos nas escritas novas E no
   backfill — zero rótulos de mecanismo (PROPER/COMPOUND/QUOTED) em entidades novas.
3. Ruído medido cai na base live pós-backfill: entidades ALL-CAPS ≤10 (era 80) e nomes
   ≤3 chars ≤10 (era 53).
4. Memórias verbatim/importadas ganham grafo (blueprint D2 — o gap deixado pela Phase A D1).
5. Dashboard #253 Fase 2 desbloqueada: coluna TYPE + filtro por type na tela Entities.

## Q4 — Riscos novos
**Resposta (recomendada, confirmada):**
- R1 — Custo/latência LLM do backfill (~730 memórias + ~840 entidades): batching bounded
  (lição do #112: contagem E bytes), dry-run com estimativa de custo ANTES do commit,
  idempotência (re-rodar nunca duplica).
- R2 — Substituição destrutiva do grafo atual: a re-extração troca nós/edges existentes;
  mal feita perde provenance/edges válidas. Mitigação: supersede/soft (nunca hard-delete
  em massa), verificação fail-closed de filtros em operações em massa (lição do incidente
  #252 / memória bulk-delete-fail-closed-echo-guard).

## Out-of-scope cross-check
Sem overlap: re-extração ≠ graph-DB backend (Item 14 declinado), ≠ vendor adapters,
≠ eager per-update summaries (M13 é batch/backfill + tipagem no write — não summary eager).
