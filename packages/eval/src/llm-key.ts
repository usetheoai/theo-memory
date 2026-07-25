/**
 * T5.1 — OpenRouter key detection for the LLM-measured tier gate (ADR D4).
 *
 * The LLM-free structural tier always runs. The LLM-measured tier + its
 * baseline gate run ONLY when an OpenRouter key is present, and SKIP honestly
 * otherwise — the strongest signal fires only when a key is configured, and a
 * missing key never fabricates a passing score. Mirrors the existing
 * `the-goal-test-llm-measured.test.ts` gating (OPENROUTER_KEY / OPENROUTER_API_KEY).
 */
type Env = Record<string, string | undefined>;

export function openrouterKey(env: Env = process.env): string {
  return env['OPENROUTER_KEY'] ?? env['OPENROUTER_API_KEY'] ?? '';
}

export function hasLlmKey(env: Env = process.env): boolean {
  return openrouterKey(env) !== '';
}
