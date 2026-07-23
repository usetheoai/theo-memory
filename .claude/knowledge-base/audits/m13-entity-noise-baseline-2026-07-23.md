# M13 — Baseline de ruído de entidades (pré-backfill)

- **Data:** 2026-07-23 (~11:40 UTC)
- **Base:** themem live (app-dev), workspace `tn-f50e039ca488a1bc`
- **Método:** queries SQL abaixo, executadas via `docker exec themem_pgvector psql` — as MESMAS
  queries são re-executadas pós-backfill para o veredito do DoD (comparável por construção).

## Números (baseline)

| Métrica | Valor | Alvo DoD M13 |
|---|---|---|
| total_entities | 1658 | — |
| ALL-CAPS (`name ~ '^[A-Z]{2,}$'`) | 129 | ≤ 10 |
| Nomes ≤3 chars | 106 | ≤ 10 |
| type = PROPER (mecanismo) | 1409 | 0 em entidades novas |
| type = COMPOUND (mecanismo) | 231 | 0 em entidades novas |
| type = QUOTED (mecanismo) | 18 | 0 em entidades novas |
| Memórias vivas sem NENHUM link de grafo | 1029 | → cobertas pelo backfill |

> Nota de tendência: às ~09:00 UTC a mesma base media 839 entidades / 80 ALL-CAPS / 53 ≤3
> chars — as escritas session-scoped do dia CONTINUAM produzindo rótulos de mecanismo e
> ruído; a fonte só fecha com a tipagem semântica no write path (parte do M13).

## Queries canônicas (re-executar pós-backfill)

```sql
SELECT
  count(*) AS total_entities,
  count(*) FILTER (WHERE name ~ '^[A-Z]{2,}$') AS all_caps_tokens,
  count(*) FILTER (WHERE length(name) <= 3) AS very_short_names,
  count(*) FILTER (WHERE type = 'PROPER') AS type_proper,
  count(*) FILTER (WHERE type = 'COMPOUND') AS type_compound,
  count(*) FILTER (WHERE type = 'QUOTED') AS type_quoted
FROM entities;

SELECT count(*) AS memories_without_graph FROM memories m
WHERE m.t_invalid IS NULL AND m.kind <> 'skill'
  AND NOT EXISTS (SELECT 1 FROM memory_entities me WHERE me.memory_id = m.id);
```
