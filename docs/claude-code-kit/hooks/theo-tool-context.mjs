#!/usr/bin/env node
// theo-tool-context.mjs — PostToolUse Bash hook: erro-context (M14 T3.1).
//
// Quando um comando Bash falha (Traceback / panic / error[Exxx] / "Error" repetido), busca
// a memória desse erro — a última vez que o vimos e como resolvemos — e a injeta via
// PostToolUse.additionalContext. É a superfície de maior valor do tool-context: o erro que
// já vimos antes (blueprint T4). Espelha o `on_bash_output.sh` do kit de referência.
//
// Invariante (ADR-M14-1): a identidade vem do Principal server-side. O hook só envia a linha
// de erro (query). Sem token, NÃO busca (EC-2). Pula git commit/merge (não é bug reproduzível)
// e output curto (< 50 chars — ruído). Em QUALQUER falha, emite NADA e exit 0 (nunca bloqueia).

import { readInput, post as realPost, loadEnv } from './theo-lib.mjs';

const MIN_OUTPUT_CHARS = 50;
const TOP_K = 3;
// Comandos cujo "erro" no output não é um bug reproduzível para memorizar.
const SKIP_COMMAND = /\bgit\s+(commit|merge|rebase|push)\b/;
// Sinais fortes de erro: uma ocorrência já basta.
const STRONG_ERROR = /Traceback \(most recent call last\)|^panic:|\berror\[[A-Z]?\d+\]|\bexception\b/im;
// Linhas específicas de erro (a "ponta" acionável — ex.: `ValueError: ...`, `error[E0433]: ...`).
const ERROR_LINE =
  /^(?:[A-Z]\w*(?:Error|Exception)\b.*|error(?:\[[^\]]+\])?:.*|panic:.*|.*\bpanicked\b.*)$/;

/** Junta stdout+stderr do tool_response numa string única (tolerante à forma). */
function extractOutput(toolResponse) {
  if (typeof toolResponse === 'string') return toolResponse;
  if (!toolResponse || typeof toolResponse !== 'object') return '';
  const parts = [toolResponse.stderr, toolResponse.stdout, toolResponse.output]
    .filter((p) => typeof p === 'string' && p.length > 0);
  return parts.join('\n');
}

/** Detecta se o output carrega um erro digno de recall. */
function hasError(output) {
  if (STRONG_ERROR.test(output)) return true;
  // Fallback conservador: "Error" repetido (≥2) evita falso-positivo de um "No error".
  const errorMatches = output.match(/\bError\b/g);
  return errorMatches !== null && errorMatches.length >= 2;
}

/** A linha de erro mais acionável (a ÚLTIMA que casa — a ponta do traceback). */
function errorQuery(output) {
  const lines = output.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (ERROR_LINE.test(lines[i])) return lines[i];
  }
  // Sem uma linha "ponta" clara, usa a primeira que contém Error/panic.
  return lines.find((l) => /\bError\b|panic:/.test(l)) ?? lines[lines.length - 1] ?? '';
}

/**
 * Pure, testable core: given the PostToolUse input + injected `post`/`env`, returns the
 * additionalContext JSON string to emit, or null (nothing to inject).
 *
 * @param {{ input: object, post: Function, env: {token: string|null} }} deps
 * @returns {Promise<string|null>}
 */
export async function buildToolContext({ input, post, env }) {
  const command = typeof input?.tool_input?.command === 'string' ? input.tool_input.command : '';
  if (SKIP_COMMAND.test(command)) return null;

  const output = extractOutput(input?.tool_response);
  if (output.length < MIN_OUTPUT_CHARS) return null;
  if (!hasError(output)) return null;
  // No token → no recall (EC-2). Sem credencial não há Principal para escopar; degrada em silêncio.
  if (!env || env.token === null || env.token === undefined) return null;

  const query = errorQuery(output);
  if (query.length === 0) return null;

  const result = await post('/v1/recall', { query, topK: TOP_K });
  const items = result && Array.isArray(result.results) ? result.results : [];
  const lines = items
    .map((it) => (it && typeof it.text === 'string' ? it.text.trim() : ''))
    .filter((t) => t.length > 0)
    .map((t) => `- ${t}`);
  if (lines.length === 0) return null;

  const context = ['# theo-memory — you have seen this error before', '', ...lines].join('\n');
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
  });
}

async function main() {
  const input = await readInput();
  const env = loadEnv();
  const out = await buildToolContext({ input, post: realPost, env });
  if (out !== null) process.stdout.write(out);
}

// Only run main() when invoked as the hook (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch(() => {
      /* never surface an error to the session */
    })
    .finally(() => process.exit(0));
}
