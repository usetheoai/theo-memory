/**
 * T3.4 RED — static-shape Dockerfile invariants per ADR D13 + EC-47.
 *
 * Locks the four discipline rules:
 *  1. ENTRYPOINT invokes /nodejs/bin/node directly (no shell wrapper).
 *  2. ENTRYPOINT first arg is the compiled CLI, second is `server` (T2.3
 *     migrate-on-startup absorbs former docker-entrypoint.sh duties).
 *  3. CMD is empty array.
 *  4. NO `docker-entrypoint.sh` file exists anywhere in the repo.
 *
 * EC-45/46 retire here: Node-as-PID-1 receives signals natively; no shell
 * layer to lose SIGTERM.
 *
 * @see Plan theo-memory-standalone-p0 § T3.4 + ADR D13 + EC-47
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const DOCKERFILE = resolve(REPO_ROOT, 'Dockerfile');

function findShellEntrypointFiles(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name === '.claude') {
      continue;
    }
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...findShellEntrypointFiles(full, depth + 1));
    } else if (/docker-entrypoint\.(sh|bash)$/i.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('T3.4 — ENTRYPOINT direct Node binary per ADR D13', () => {
  test('50. Dockerfile ENTRYPOINT invokes /nodejs/bin/node directly (no shell)', () => {
    const text = readFileSync(DOCKERFILE, 'utf-8');
    // Exact form: ["/nodejs/bin/node", "/app/dist/agent-tools/cli.js", "server"]
    expect(text).toMatch(
      /ENTRYPOINT\s+\[\s*"\/nodejs\/bin\/node"\s*,\s*"\/app\/dist\/agent-tools\/cli\.js"\s*,\s*"server"\s*\]/,
    );
    // No `sh -c` or shell-form invocation.
    expect(text).not.toMatch(/ENTRYPOINT\s+\[\s*"\/bin\/sh"/);
    expect(text).not.toMatch(/ENTRYPOINT\s+["']?\/bin\/sh/);
  });

  test('51. Dockerfile CMD is empty array', () => {
    const text = readFileSync(DOCKERFILE, 'utf-8');
    expect(text).toMatch(/^CMD\s+\[\s*\]\s*$/m);
  });

  test('52. No docker-entrypoint.sh / .bash file exists in the repo (EC-47)', () => {
    const offenders = findShellEntrypointFiles(REPO_ROOT);
    expect(offenders).toEqual([]);
  });

  test('53. README documents the --entrypoint override pattern for migrate/health', () => {
    const readme = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf-8');
    expect(readme).toMatch(/--entrypoint\s+\/nodejs\/bin\/node/);
    // A imagem chama-se `theo-memory`, nao `themory` (renomeada para o nome do repositorio, como em
    // todos os irmaos). MEDIDO em 2026-07-30 com credencial no host:
    //   ghcr.io/usetheoai/theo-memory:develop  EXISTE
    //   ghcr.io/usetheoai/themory:develop      nao existe
    // Este teste ficou no nome antigo e reprovava — e o CHANGELOG da renomeacao prometia justamente
    // que "o teste trava as duas pontas". Travamos as duas de verdade abaixo.
    expect(readme).toMatch(/usetheoai\/theo-memory:\S+/);
    // O caminho antigo nao pode voltar como ALVO DE PULL em silencio. Ele ainda aparece no README numa
    // nota explicando que nao resolve — por isso o negativo e sobre `pull ...themory:<tag>`, nao sobre
    // a string solta, que e documentacao legitima.
    expect(readme).not.toMatch(/pull\s+ghcr\.io\/usetheoai\/themory:/);
    expect(readme).toMatch(/migrate/);
    expect(readme).toMatch(/health/);
  });

  test('54. Dockerfile exists + uses distroless nodejs base image (D13)', () => {
    const text = readFileSync(DOCKERFILE, 'utf-8');
    expect(existsSync(DOCKERFILE)).toBe(true);
    expect(text).toMatch(/gcr\.io\/distroless\/nodejs22-debian12:nonroot/);
  });
});
