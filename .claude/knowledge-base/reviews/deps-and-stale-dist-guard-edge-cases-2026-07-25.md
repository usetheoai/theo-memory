# Edge Case Review — deps-and-stale-dist-guard (M20)

Date: 2026-07-25 · Tasks: T1.1-T1.3, T2.1 · MUST FIX: 0

## SHOULD TEST
- EC-1 (T2.1, NEGATIVE): `assertDistNotStale` com `src/` ilegível (permissão) → deve ser no-op (fail-open na guarda), não crashar o boot. Já em Failure scenarios; garantir o try/catch de I/O.
- EC-2 (T2.1, EDGE): dist e src com mtime IGUAL → não-stale (só `src > dist` bloqueia). Adicionar asserção.
- EC-3 (T1.1, NEGATIVE): node-server 2.x muda `serve` → suíte falha = gate (ADR D1 fallback).

## DOCUMENT
- EC-4: mtime pode variar por checkout/cache em CI → ADR D2 (no-op sem src) já cobre o deploy; dev host-run é o alvo.

**Verdict:** PLAN OK — 0 MUST FIX; EC-1/EC-2 absorvidos nas asserções de T2.1.
