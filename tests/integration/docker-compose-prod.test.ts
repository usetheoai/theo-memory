/**
 * T3.2 RED — `docker-compose.prod.yaml` config validation (EC-42).
 *
 * Asserts the prod compose file parses + validates WITHOUT the consumer
 * having to export `VERSION` first. The `${VERSION:-0.1.0-alpha}`
 * fail-safe-default pattern keeps `docker compose config` exit 0 on a
 * cold clone — CI sets `VERSION=$TAG` at release time.
 *
 * Gated on `docker compose` CLI availability so fresh checkouts without
 * Docker installed still pass `npm test`. THE GOAL TEST end-to-end stack
 * boot (T3.5) covers the runtime behavior; this locus is the config-shape
 * regression guard.
 *
 * @see Plan theo-memory-standalone-p0 § T3.2 + EC-41 + EC-42
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const COMPOSE_FILE = resolve(REPO_ROOT, 'docker-compose.prod.yaml');

function hasDockerCompose(): boolean {
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasDockerCompose() || !existsSync(COMPOSE_FILE))(
  'T3.2 — docker-compose.prod.yaml',
  () => {
    test('42. compose config validates without VERSION env (EC-42 fail-safe default)', () => {
      // Drop VERSION env if the harness leaks one in.
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env['VERSION'];
      const result = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'config', '--quiet'], {
        cwd: REPO_ROOT,
        env,
        encoding: 'utf-8',
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    }, 15_000);

    test('43. compose declares themory image with ${VERSION:-default} substitution', () => {
      const result = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'config'], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
      });
      expect(result.status).toBe(0);
      // Default version interpolation must surface in resolved output.
      // Docker Hub is now the primary registry (THEMORY_IMAGE default
      // `usetheo/themory:<version>`); GHCR is the documented alternative.
      // `ghcr.io/usetheoai/theo-memory` — o nome do repositorio, que e o que o `publish` empurra e o
      // que o host de fato roda. MEDIDO: `ghcr.io/usetheoai/themory:develop` NAO existe. O Docker Hub
      // (`usetheo/themory`) esta dormente: nenhum irmao publica la, por falta de `DOCKERHUB_TOKEN`.
      expect(result.stdout).toMatch(/usetheoai\/theo-memory:\S+/);
    }, 15_000);

    test('44. compose declares pgvector + themory services with healthchecks', () => {
      const result = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'config'], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
      });
      expect(result.status).toBe(0);
      // Both services present.
      expect(result.stdout).toMatch(/pgvector:/);
      expect(result.stdout).toMatch(/themory:/);
      // Healthchecks declared for EC-41 `--wait --wait-timeout` semantics.
      const healthchecks = result.stdout.match(/healthcheck:/g) ?? [];
      expect(healthchecks.length).toBeGreaterThanOrEqual(2);
    }, 15_000);
  },
);
