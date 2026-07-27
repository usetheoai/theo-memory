/**
 * M27 T6.1 — write-quality parity metric (mem0 grade).
 *
 * The DoD number: the fraction of stored items that are a SINGLE THIRD-PERSON durable fact.
 * The predicate encodes the DoD definition DIRECTLY (atomic + declarative + third-person),
 * independent of the write-path gate, so the metric is not circular. Runs over the rows a real
 * extraction produced from a fixture transcript; the benchmark harness records the ratio across
 * ≥ 3 runs (mean ± std) in docs/benchmarks/.
 */

/** First-person conversational opener — the same failure class the dashboard showed. */
const FIRST_PERSON_OPENER =
  /^\s*(minha recomenda|my recommendation|quer que eu|shall i\b|se voc[eê] quer|ok,?\s*vou\b|vou\s|let me\b|here is what|aqui est[aá] o que)/i;

/** True when a stored row is a single, declarative, third-person, atomic fact. */
export function isSingleThirdPersonFact(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (t.length > 200) return false; // atomic — not a multi-paragraph dump
  if (/[?？]["'”’)\]]*\s*$/.test(t)) return false; // declarative — not a question
  if (FIRST_PERSON_OPENER.test(t)) return false; // third-person — not first-person voice
  return true;
}

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
