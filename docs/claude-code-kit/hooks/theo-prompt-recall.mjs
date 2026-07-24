#!/usr/bin/env node
// theo-prompt-recall.mjs — UserPromptSubmit hook: recall por-PROMPT (M14 T1.1).
//
// Fecha o gap medido (79% das memórias nunca lidas): o recall antigo (theo-recall.mjs,
// SessionStart) buscava por `query: project` (constante). Este hook busca pelo PROMPT do
// usuário a cada mensagem, scoped ao Principal (workspace,user) resolvido pela credencial
// no servidor — NUNCA do argumento. Injeta o resultado via hookSpecificOutput.
//
// Invariante (ADR-M14-1): a identidade vem do Principal server-side. O hook só envia o
// PROMPT (query) e, quando presente, o session_id (M10 scope: global ∪ session). Sem token
// configurado, NÃO busca (EC-2 — defesa em profundidade; não confia que o servidor recuse).
//
// HARD REQUIREMENT (kit-wide): em QUALQUER falha ou resultado vazio, emite NADA e exit 0.
// Um outage de memória nunca bloqueia o turno.

import { readInput, post as realPost, loadEnv } from './theo-lib.mjs';

const MIN_PROMPT_CHARS = 20; // prompts curtos (ack/curtos) não valem recall (régua: < 20)
const TOP_K = 5;

/**
 * Pure, testable core: given the hook input + injected `post`/`env`, returns the
 * additionalContext JSON string to emit, or null (nothing to inject).
 *
 * @param {{ input: object, post: Function, env: {token: string|null} }} deps
 * @returns {Promise<string|null>}
 */
export async function buildRecallContext({ input, post, env }) {
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  // Skip short prompts — régua `< MIN`, alinhada ao REDACTED on_user_prompt.sh:25.
  if (prompt.length < MIN_PROMPT_CHARS) return null;
  // No token → no recall (EC-2). The Principal is resolved from the credential on the
  // server; without it we cannot scope safely, so we degrade to silent (never guess).
  if (!env || env.token === null || env.token === undefined) return null;

  const sessionId =
    typeof input.session_id === 'string' && input.session_id.length > 0
      ? input.session_id
      : undefined;

  const result = await post('/v1/recall', {
    ...(sessionId ? { sessionId } : {}),
    query: prompt,
    topK: TOP_K,
  });

  const items = result && Array.isArray(result.results) ? result.results : [];
  const lines = items
    .map((it) => (it && typeof it.text === 'string' ? it.text.trim() : ''))
    .filter((t) => t.length > 0)
    .map((t) => `- ${t}`);
  if (lines.length === 0) return null;

  const context = ['# theo-memory — relevant to your request', '', ...lines].join('\n');
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
  });
}

async function main() {
  const input = await readInput();
  const env = loadEnv();
  const out = await buildRecallContext({ input, post: realPost, env });
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
