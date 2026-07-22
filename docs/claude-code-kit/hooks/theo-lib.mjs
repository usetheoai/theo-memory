// theo-lib.mjs — shared ESM helpers for the theo-memory Claude Code hooks.
//
// DRY spine: theo-recall / theo-remember / theo-precompact all import from here so
// the env-loading, stdin-parsing, and HTTP-POST logic lives in exactly one place.
//
// Hard rule (blueprint ADR-5 + plan Phase 3 failure scenarios): a memory outage MUST
// NEVER break a Claude Code session. Every function here is failure-tolerant — `post`
// returns null on ANY error and NEVER throws; the hooks that call it exit 0 regardless.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = 'http://127.0.0.1:8080';
const ENV_PATH = join(homedir(), '.claude', 'theo-memory.env');
const DEFAULT_TIMEOUT_MS = 3000;
// A write (remember/precompact) runs server-side LLM fact-extraction through the
// gateway edge and legitimately takes ~8s. A blocking hook must NOT hold the session
// that long, so writes are DETACHED (postDetached) into a background worker that
// carries a generous timeout of its own — the parent hook exits 0 immediately.
const DETACHED_WRITE_TIMEOUT_MS = 20000;

/**
 * Read ~/.claude/theo-memory.env → { THEOMEM_MEMORY_URL, THEOMEM_MEMORY_TOKEN }.
 *
 * The endpoint is the single config knob (local dev / deployed REST / prod gateway).
 * Format: simple `KEY=value` lines; `#` comments and blank lines ignored; surrounding
 * quotes on the value are stripped. Process env overrides the file (CI / one-off).
 * Missing file → defaults (URL only, no token). Never throws.
 *
 * @returns {{ url: string, token: string|null }}
 */
export function loadEnv() {
  const parsed = {};
  try {
    const raw = readFileSync(ENV_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      parsed[key] = value;
    }
  } catch {
    // No env file (or unreadable) — fall through to defaults.
  }

  const url =
    process.env.THEOMEM_MEMORY_URL || parsed.THEOMEM_MEMORY_URL || DEFAULT_URL;
  const token =
    process.env.THEOMEM_MEMORY_TOKEN || parsed.THEOMEM_MEMORY_TOKEN || null;
  // Same precedence as url/token: env wins, then the file. Reading this ONLY from
  // process.env made the documented gateway setup a silent no-op — the key was
  // parsed out of the env file and then dropped, so requests kept going to the raw
  // REST path and failed soft (post() returns null on any error).
  const pathPrefix =
    process.env.THEOMEM_MEMORY_PATH_PREFIX || parsed.THEOMEM_MEMORY_PATH_PREFIX || '';
  // Optional explicit user id. Leave it unset for the gateway path (the default):
  // the gateway injects an auth-trusted X-Theo-User-Id from the credential, and the
  // server binds the user tier to it, so every instance of the same account lands in
  // ONE unified memory space the dashboard reads. Set it only to pin a fixed user
  // when talking to a raw REST endpoint that does NOT inject the header.
  const userId =
    process.env.THEOMEM_MEMORY_USER_ID || parsed.THEOMEM_MEMORY_USER_ID || '';

  return {
    url: url.replace(/\/+$/, ''),
    token: token || null,
    pathPrefix: pathPrefix.replace(/\/+$/, ''),
    userId: userId.trim(),
  };
}

/**
 * Read + parse the hook JSON payload from stdin. Tolerates an empty / absent / malformed
 * body by returning an empty object — a hook must not crash on a surprising stdin shape.
 *
 * @returns {Promise<object>}
 */
export async function readInput() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Derive the project name from a working directory (basename of cwd). Falls back to
 * 'unknown' so a namespaced recall/remember always has a stable key. Never throws.
 *
 * @param {string|undefined} cwd
 * @returns {string}
 */
export function projectOf(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return 'unknown';
  const parts = cwd.replace(/\/+$/, '').split('/');
  const base = parts[parts.length - 1];
  return base || 'unknown';
}

/**
 * POST JSON to `<url><path>` with the Bearer header when a token is configured and a
 * bounded timeout. Returns the parsed JSON body on 2xx, or null on ANY failure
 * (network error, non-2xx, timeout, malformed JSON). NEVER throws — a memory outage
 * degrades to a no-op, it does not break the session.
 *
 * The verb path is joined onto an optional prefix so the SAME hooks work against
 * both surfaces without editing code: theo-memory's own REST exposes `/v1/recall`,
 * while the Theo gateway namespaces capabilities as `/v1/memory/recall`. Set
 * THEOMEM_MEMORY_PATH_PREFIX=/v1/memory to go through the gateway. Hardcoding the
 * raw REST path is what tied this kit to a direct-to-service deployment.
 *
 * @param {string} path      verb path, e.g. '/v1/recall'
 * @param {object} body      JSON request body
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<object|null>}
 */
export async function post(path, body, opts = {}) {
  const { url, token, pathPrefix } = loadEnv();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // '/v1/recall' + prefix '/v1/memory' → '/v1/memory/recall'. An unset prefix keeps
  // the path verbatim, so existing raw-REST setups are unaffected.
  const target = pathPrefix ? `${pathPrefix}/${path.replace(/^\/v1\//, '')}` : path;
  try {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${url}${target}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Fire a POST in a DETACHED background process and return immediately — the write
 * outlives the calling hook. This is the ONLY correct shape for a Stop / PreCompact
 * hook write: server-side LLM fact-extraction takes ~8s through the gateway, but the
 * session must never block on it (blueprint ADR-5 "a memory outage never blocks the
 * session" — an 8s stall is the same failure). The child re-invokes THIS file in
 * `--write-worker` mode with the payload base64-encoded on argv, does the POST with a
 * generous timeout, then exits. Errors are swallowed (fire-and-forget). Never throws.
 *
 * @param {string} path  verb path, e.g. '/v1/remember'
 * @param {object} body  JSON request body
 */
export function postDetached(path, body) {
  try {
    const self = fileURLToPath(import.meta.url);
    const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
    const child = spawn(process.execPath, [self, '--write-worker', path, encoded], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // Spawn failed (no node? sandbox?) — degrade to a no-op, never break the session.
  }
}

// Worker entry: `node theo-lib.mjs --write-worker <path> <base64-json-body>`. Runs the
// POST with a long timeout so extraction completes after the parent hook has exited.
// Guarded on argv so a normal `import` of this module (recall/remember/precompact) never
// triggers it — only the explicit detached spawn does.
if (process.argv[1] &&
    fileURLToPath(import.meta.url) === process.argv[1] &&
    process.argv[2] === '--write-worker') {
  const path = process.argv[3];
  let body = {};
  try {
    body = JSON.parse(Buffer.from(process.argv[4] || '', 'base64').toString('utf8'));
  } catch {
    process.exit(0);
  }
  post(path, body, { timeoutMs: DETACHED_WRITE_TIMEOUT_MS }).finally(() =>
    process.exit(0)
  );
}
