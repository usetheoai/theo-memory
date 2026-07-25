# Edge Case Review — pipeline-decomposition-behavior-frozen (M19)

Date: 2026-07-25
Tasks analyzed: 8 (T1.1..T1.6, T2.1, T2.2)
Cases found: 3 (EDGE: 1, NEGATIVE: 2 | MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 1)

Refactor comportamento-preservador — não há novas fronteiras de input/I/O; o "input" é o código
sendo movido. Os riscos reais são de EXTRAÇÃO (closure capture, ciclo de import, reuso de call
site), não de runtime. Todos já mapeados nos Drawbacks do plano; este review confirma que os testes
de shape + o congelamento por suíte/benchmark os cobrem.

## SHOULD TEST

### EC-1: `rowToItem` closure capture (`scope`, `now`) muda de valor na extração
- **Affected task:** T1.6
- **Kind:** NEGATIVE (extração incorreta produz DTO com valor errado)
- **Suggested test:** `test_row_mapping_preserves_dto_fields` (já em T1.6) — DEVE passar `scope` e `now`
  como argumentos e asserir que o DTO tem os mesmos campos hoisted (attributed_to, confirmation_count,
  created_at) e o mesmo `scope`/`createdAt` que a versão inline. Já previsto; confirmar que o teste
  fixa `now` (injetado) para determinismo, não `new Date()` dentro do teste.

### EC-2: `filterAtThreshold` reuso nos 2 call sites diverge após extração
- **Affected task:** T1.1, T1.4
- **Kind:** NEGATIVE (a extração quebra a reutilização — inicial vs adaptive-relax)
- **Suggested test:** a suíte de adaptive-relax já exercita ambos os passes; confirmar que o teste de
  não-eliminação (`ranking.test.ts` threshold 0.8) e o de relax continuam verdes com o
  `filterAtThreshold` importado do módulo. O congelamento por benchmark (T2.2) captura qualquer
  divergência de ordem.

## DOCUMENT

### EC-3: ciclo de import entre `stages/` e `pipeline.ts`
- **Kind:** EDGE (limite da estrutura de módulos)
- **Accepted risk:** `threshold-filter` é folha (não importa os outros estágios); `adaptive-relax`
  importa `threshold-filter`; `pipeline` importa todos. Grafo acíclico por construção. Se o typecheck
  detectar um ciclo (ex: um estágio importando `pipeline`), a extração está errada — o `tsc` falha
  alto, então não é preciso teste dedicado.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 0 | 1 | 0 | 1 | 0 |
| T1.4 | 0 | 1 | 0 | 1 | 0 |
| T1.6 | 0 | 1 | 0 | 1 | 0 |
| (estrutura) | 1 | 0 | 0 | 0 | 1 |

**Verdict:** PLAN OK — zero MUST-FIX. Os dois SHOULD TEST já estão nas tasks (T1.6 DTO-preservation,
T1.1/T1.4 reuse via suíte). O congelamento por benchmark (T2.2) é a rede que captura qualquer
divergência de comportamento que a leitura do diff não pegaria.
