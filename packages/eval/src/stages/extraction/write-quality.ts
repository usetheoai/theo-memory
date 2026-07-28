/**
 * M27 T6.1 — write-quality parity metric.
 *
 * The DoD number: the fraction of stored items that are a SINGLE THIRD-PERSON durable fact.
 * The predicate `isSingleThirdPersonFact` is imported from `@usetheo/memory` — the SAME single
 * source of truth the write-path gate uses (DRY; the review flagged a duplicated regex). The
 * metric therefore measures the exact DoD property the gate enforces; its VALUE as evidence comes
 * from scoring REAL LLM output (the pipeline's stored rows on the deployed instance), not from
 * being independent of the gate. The benchmark harness records the ratio across ≥ 3 runs.
 */
import { isSingleThirdPersonFact } from '@usetheo/memory';

export { isSingleThirdPersonFact };

export interface WriteQualityMetric {
  readonly total: number;
  readonly singleThirdPersonFacts: number;
  readonly ratio: number;
}

/** Compute the single-third-person-fact ratio over a set of stored rows. */
export function singleThirdPersonFactRatio(
  storedTexts: readonly string[],
): WriteQualityMetric {
  const total = storedTexts.length;
  if (total === 0) return { total: 0, singleThirdPersonFacts: 0, ratio: 1 };
  const clean = storedTexts.filter(isSingleThirdPersonFact).length;
  return { total, singleThirdPersonFacts: clean, ratio: clean / total };
}

/**
 * The dogfound pollution fixture — the exact inputs that produced bad memories on the deployed
 * dashboard (session 93959d08). The benchmark feeds these through a REAL extraction and scores the
 * output ratio, comparing against the recorded "before" (the polluted dashboard rows).
 */
export const WRITE_QUALITY_FIXTURE: readonly string[] = [
  'Quer que eu prossiga com o escopo estreito (IA metrificada) + allowlist do advisory, ou prefere outro corte?',
  'Minha recomendação: allowlist com sunset <= 90 dias, registrando os dois motivos, e o bump major como item próprio.',
  'Atualizei o hono de 4.12.25 para 4.12.31, fechando tres advisories MODERATE, e o alvo de deploy e container Linux, e o theo-rag nao serve arquivo estatico por esse adapter.',
  'Ok, vou continuar.',
];
