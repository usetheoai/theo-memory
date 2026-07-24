#!/usr/bin/env node
// theo-block-memory-write.mjs — PreToolUse Write|Edit hook: bloqueia escrita em MEMORY.md (M14 T3.2).
//
// Evita memória fora do sistema: um MEMORY.md local é invisível ao recall (blueprint T5). Quando
// o agente tenta Write/Edit num arquivo MEMORY.md, o hook bloqueia (exit 2) e redireciona ao nosso
// `remember` / à tool MCP — a memória deve viver no theo-memory, não num arquivo local órfão.
// Espelha o `block_memory_write.sh` do kit de referência.
//
// Contrato PreToolUse do Claude Code: exit 2 = block (stderr é mostrado ao agente); exit 0 = allow.
// Qualquer erro inesperado → allow (exit 0): a guarda nunca deve travar uma escrita legítima.

import { readInput } from './theo-lib.mjs';

const REDIRECT_MESSAGE =
  'Blocked: do not write memory to MEMORY.md — it is invisible to recall. ' +
  'Use the theo-memory `remember` tool (or the MCP `remember`) so the fact is searchable and scoped.';

/**
 * Pure, testable core: decide se a escrita deve ser bloqueada.
 * Bloqueia SOMENTE o arquivo `MEMORY.md` exato (basename), não substrings (`MEMORY.md.bak`).
 *
 * @param {{ tool_input?: { file_path?: string } }} input
 * @returns {{ block: boolean, reason: string }}
 */
export function evaluateWrite(input) {
  const filePath = typeof input?.tool_input?.file_path === 'string' ? input.tool_input.file_path : '';
  if (filePath.length === 0) return { block: false, reason: '' };
  const basename = filePath.split('/').pop();
  if (basename === 'MEMORY.md') return { block: true, reason: REDIRECT_MESSAGE };
  return { block: false, reason: '' };
}

async function main() {
  const input = await readInput();
  const { block, reason } = evaluateWrite(input);
  if (block) {
    process.stderr.write(reason + '\n');
    process.exit(2);
  }
  process.exit(0);
}

// Only run main() when invoked as the hook (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {
    // Guarda nunca trava uma escrita legítima por erro próprio: allow em caso de falha.
    process.exit(0);
  });
}
