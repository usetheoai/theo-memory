#!/usr/bin/env node
// theo-onboard.mjs — wizard /onboard: importa o contexto do projeto, idempotente (M14 T4.1).
//
// Detecta CLAUDE.md / AGENTS.md no cwd e os importa como memórias de perfil UMA vez — a mesma
// ideia do `themory import claude-code` (M12), adaptada ao pipeline `post()` do kit. Idempotência
// por hash de conteúdo (marker local por-projeto): re-rodar com o mesmo conteúdo não duplica.
//
// Invariante (ADR-M14-1): a identidade vem do Principal server-side. O hook só manda o conteúdo,
// NUNCA user_id/workspace_id no body. Sem token, não importa (EC-2). Qualquer falha → exit 0.

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { post as realPost, loadEnv, projectOf } from './theo-lib.mjs';

const ONBOARD_TARGETS = ['CLAUDE.md', 'AGENTS.md'];

/** Hash curto e estável do conteúdo (idempotência por conteúdo, não por path). */
export function hashContent(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Pure, testable core: importa os arquivos cujo hash ainda não foi visto.
 *
 * @param {{ files: {path:string, content:string}[], post: Function, env: {token: string|null}, seen: Set<string> }} deps
 * @returns {Promise<{ imported: {path:string, hash:string}[], seen: Set<string> }>}
 */
export async function runOnboard({ files, post, env, seen }) {
  // No token → no import (EC-2). Sem credencial não há Principal para escopar.
  if (!env || env.token === null || env.token === undefined) return { imported: [], seen };

  const known = new Set(seen);
  const imported = [];
  for (const f of files) {
    const content = typeof f.content === 'string' ? f.content : '';
    if (content.trim().length === 0) continue; // arquivo vazio → nada a importar
    const h = hashContent(content);
    if (known.has(h)) continue; // já importado (idempotência)
    // Body carrega SÓ o conteúdo — a identidade (workspace,user) vem do Principal server-side.
    await post('/v1/remember', { content });
    known.add(h);
    imported.push({ path: f.path, hash: h });
  }
  return { imported, seen: known };
}

/** Marker local por-projeto com os hashes já importados (idempotência entre execuções). */
function markerPath(cwd) {
  return join(homedir(), '.claude', `.theo-onboard-${projectOf(cwd)}.json`);
}

function loadSeen(cwd) {
  try {
    const raw = readFileSync(markerPath(cwd), 'utf8');
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveSeen(cwd, seen) {
  try {
    writeFileSync(markerPath(cwd), JSON.stringify([...seen]), 'utf8');
  } catch {
    // marker não-persistido só custa uma re-importação idempotente no servidor (dedup UPSERT).
  }
}

function readTargets(cwd) {
  const files = [];
  for (const name of ONBOARD_TARGETS) {
    try {
      files.push({ path: name, content: readFileSync(join(cwd, name), 'utf8') });
    } catch {
      // arquivo ausente → ignora
    }
  }
  return files;
}

async function main() {
  const cwd = process.cwd();
  const env = loadEnv();
  const files = readTargets(cwd);
  const seen = loadSeen(cwd);
  const { imported, seen: newSeen } = await runOnboard({ files, post: realPost, env, seen });
  if (imported.length > 0) {
    saveSeen(cwd, newSeen);
    process.stdout.write(
      `theo-memory: onboarded ${imported.length} file(s) — ${imported.map((i) => i.path).join(', ')}\n`,
    );
  } else {
    process.stdout.write('theo-memory: nothing new to onboard (already imported or no CLAUDE.md/AGENTS.md).\n');
  }
}

// Only run main() when invoked as the command (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch(() => {
      /* never surface an error */
    })
    .finally(() => process.exit(0));
}
