#!/usr/bin/env node
/**
 * Injeta o shebang no artefato do CLI (M0 / T1.5).
 *
 * O npm NAO adiciona shebang num arquivo apontado por `bin` — publicar sem ele
 * entrega um comando que o shell nao sabe executar. O compilador TypeScript
 * tambem nao o preserva, entao o passo tem de ser explicito no build.
 *
 * Idempotente: rodar duas vezes nao duplica a linha.
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

const TARGET = 'dist/agent-tools/cli.js';
const SHEBANG = '#!/usr/bin/env node';

if (!existsSync(TARGET)) {
  console.error(`[cli] ${TARGET} ausente — shebang nao aplicado`);
  process.exit(0);
}

let src = readFileSync(TARGET, 'utf8');

// Injeta a versao do manifesto do CLI. Fonte unica: o package.json.
const cliPkg = JSON.parse(readFileSync('packages/cli/package.json', 'utf8'));
if (src.includes('__CLI_VERSION__')) {
  src = src.replaceAll('__CLI_VERSION__', cliPkg.version);
  writeFileSync(TARGET, src);
  console.error(`[cli] versao injetada: ${cliPkg.version}`);
}
if (src.startsWith(SHEBANG)) {
  console.error('[cli] shebang ja presente');
} else {
  writeFileSync(TARGET, `${SHEBANG}\n${src}`);
  console.error('[cli] shebang aplicado');
}
chmodSync(TARGET, 0o755);
