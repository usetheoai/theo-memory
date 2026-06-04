/**
 * T3.5 — THE GOAL TEST docker-stack integration (Roadmap Items 16-18).
 *
 * Boots the prod compose against a locally-built `themory:dev` image
 * (T3.1), waits for both services to report healthy (`docker compose up
 * --wait --wait-timeout ${EC-51 default 60s}`), then exercises the 4-verb
 * REST contract end-to-end across the wire — `POST /v1/remember` followed
 * by `POST /v1/recall` returning the persisted memory in the ranked
 * results. Hits `/v1/health/db` to confirm the pgvector boundary is
 * actually reachable from inside the container (EC-17 2s timeout).
 *
 * Gates:
 *   - DOCKER_INTEGRATION=true             — opt-in (Docker required)
 *   - docker compose CLI present
 *   - dist/agent-tools/cli.js + Dockerfile present (image must be built
 *     locally first via `docker build -t themory:dev .` OR the test will
 *     skip with a clear stderr signal)
 *
 * EC-48 absorption: per-run UUID-suffixed compose project name so a
 *   crashed previous run cannot pollute this one + parallel CI matrices
 *   stay isolated.
 *
 * EC-49 (DOCUMENT): default HTTP probe port 8080; collision-prone
 *   environments override via THEMORY_TEST_PORT.
 *
 * EC-51 absorption: timeout configurable via DOCKER_HEALTH_TIMEOUT_MS
 *   (default 60_000ms).
 *
 * @see Plan theo-memory-standalone-p0 § T3.5 + EC-17 + EC-47 + EC-48 + EC-49 + EC-51
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const COMPOSE_FILE = resolve(REPO_ROOT, 'docker-compose.prod.yaml');
const DOCKERFILE = resolve(REPO_ROOT, 'Dockerfile');

const TEST_IMAGE = process.env['THEMORY_TEST_IMAGE'] ?? 'themory:dev';
const TEST_PORT = Number.parseInt(process.env['THEMORY_TEST_PORT'] ?? '8080', 10);
const TIMEOUT_MS = Number.parseInt(process.env['DOCKER_HEALTH_TIMEOUT_MS'] ?? '60000', 10);

const INTEGRATION_ENABLED = process.env['DOCKER_INTEGRATION'] === 'true';

function hasDocker(): boolean {
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function imageExists(ref: string): boolean {
  try {
    execSync(`docker image inspect ${ref}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

async function probeHttp(url: string): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetch(url, { method: 'GET' });
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}

async function waitForHttp(url: string, expectStatus: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let last: { status: number; body: string } | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await probeHttp(url);
    if (last !== null && last.status === expectStatus) return;
    await sleep(1_000);
  }
  throw new Error(
    `waitForHttp(${url}) did not reach ${String(expectStatus)} within ${String(timeoutMs)}ms; last=${JSON.stringify(last)}`,
  );
}

describe.skipIf(
  !INTEGRATION_ENABLED ||
    !hasDocker() ||
    !existsSync(COMPOSE_FILE) ||
    !existsSync(DOCKERFILE),
)('T3.5 — THE GOAL TEST docker-stack integration', () => {
  const projectName = `themory-test-${randomUUID().slice(0, 8)}`;
  const baseUrl = `http://127.0.0.1:${String(TEST_PORT)}`;
  // Per-run unique token — proves the round-trip exercises the production
  // bearer path (NOT the open mode), which is the realistic operator setup.
  const bearerToken = `sk-test-${randomUUID().slice(0, 12)}`;
  const composeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    THEMORY_IMAGE: TEST_IMAGE,
    THEMORY_PORT: String(TEST_PORT),
    POSTGRES_USER: 'themem',
    POSTGRES_PASSWORD: 'themem',
    POSTGRES_DB: 'themem',
    THEMEMORY_API_KEY: bearerToken,
    // T3.2 / EC-2 — run-server.ts hard-fails when OPENAI_API_KEY is unset
    // (commit e43d801 mirror). Inject a fake key for boot validation; real
    // LLM round-trips are out of THE GOAL TEST scope (the test exercises
    // shape, not extraction quality).
    OPENAI_API_KEY: process.env['OPENAI_API_KEY'] ?? 'sk-fake-test-key-for-boot',
  };
  const authHeaders = { authorization: `Bearer ${bearerToken}` };

  function compose(args: readonly string[]): ReturnType<typeof spawnSync> {
    return spawnSync('docker', ['compose', '-p', projectName, '-f', COMPOSE_FILE, ...args], {
      cwd: REPO_ROOT,
      env: composeEnv,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  beforeAll(async () => {
    if (!imageExists(TEST_IMAGE)) {
      throw new Error(
        `Image ${TEST_IMAGE} not found locally. Run \`docker build -t themory:dev .\` first, OR set THEMORY_TEST_IMAGE to a published tag.`,
      );
    }
    // EC-48 — unique project name guarantees isolation; --wait blocks
    // until both services report their healthcheck OK or hit timeout.
    const up = compose([
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      String(Math.ceil(TIMEOUT_MS / 1000)),
    ]);
    if (up.status !== 0) {
      // Drain logs to stderr so CI failure carries actionable context.
      const logs = compose(['logs', '--no-color']);
      throw new Error(
        `docker compose up failed (status=${String(up.status)})\nstderr:\n${up.stderr}\nlogs:\n${logs.stdout}`,
      );
    }
    // Belt-and-suspenders: confirm /v1/health is 200 from the host's view.
    await waitForHttp(`${baseUrl}/v1/health`, 200, TIMEOUT_MS);
  }, TIMEOUT_MS + 30_000);

  afterAll(() => {
    // Always tear down — leaves no zombie containers across re-runs.
    compose(['down', '-v', '--remove-orphans']);
  }, TIMEOUT_MS);

  test('55. compose project name carries the per-run UUID suffix (EC-48)', () => {
    expect(projectName).toMatch(/^themory-test-[0-9a-f]{8}$/);
    // Reverse-check via `docker compose ls` — our project should show up.
    const ls = spawnSync('docker', ['compose', 'ls', '--format', 'json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(ls.status).toBe(0);
    expect(ls.stdout).toContain(projectName);
  });

  test('56. GET /v1/health returns 200 within timeout (EC-51)', async () => {
    const res = await probeHttp(`${baseUrl}/v1/health`);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
  });

  test('57. GET /v1/health/db succeeds — pgvector reachable from container (EC-17)', async () => {
    const res = await probeHttp(`${baseUrl}/v1/health/db`);
    expect(res?.status).toBe(200);
    expect(res?.body).toContain('"status":"ok"');
  });

  test('58. THE GOAL METRIC — remember + recall round-trip', async () => {
    // POST /v1/remember persists a fact under the alice user scope.
    const userId = `alice-${randomUUID().slice(0, 6)}`;
    const rememberRes = await fetch(`${baseUrl}/v1/remember`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: JSON.stringify({ userId, text: 'Paulo prefers dark mode', infer: false }),
    });
    expect(rememberRes.status).toBe(201);
    const rememberBody = (await rememberRes.json()) as { items: { id: string }[] };
    expect(Array.isArray(rememberBody.items)).toBe(true);
    expect(rememberBody.items.length).toBeGreaterThanOrEqual(1);

    // POST /v1/recall returns the persisted memory under the same scope.
    // Query text matches the stored text verbatim — StubEmbedder produces
    // deterministic but uncorrelated vectors per distinct input, so an
    // exact-text query yields cosine 1.0 and bypasses any non-zero
    // similarity threshold. Real consumers wire OpenAILocalTransformer
    // embedders for production semantic recall; this E2E asserts the wire
    // shape, not embedder quality (the latter is covered by the
    // adapters-or-local integration suite).
    const recallRes = await fetch(`${baseUrl}/v1/recall`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: JSON.stringify({ userId, query: 'Paulo prefers dark mode', topK: 5, threshold: 0 }),
    });
    expect(recallRes.status).toBe(200);
    const recallBody = (await recallRes.json()) as { results: { text: string }[] };
    expect(Array.isArray(recallBody.results)).toBe(true);
    const texts = recallBody.results.map((r) => r.text);
    expect(texts).toContain('Paulo prefers dark mode');
  }, 30_000);

  test('59. image runs as nonroot user (ADR D6 + EC-47 verification)', () => {
    const result = spawnSync('docker', ['inspect', TEST_IMAGE, '--format', '{{.Config.User}}'], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('65532');
  });

  test('60. image has no shell (EC-47 distroless integrity)', () => {
    // /bin/sh entrypoint MUST fail; if it succeeds, distroless was breached.
    const result = spawnSync('docker', ['run', '--rm', '--entrypoint', '/bin/sh', TEST_IMAGE, '-c', 'echo not-distroless'], {
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no such file|exec format error|OCI runtime/i);
  });
});
