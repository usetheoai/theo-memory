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

const DEFAULT_URL = 'http://127.0.0.1:8080';
const ENV_PATH = join(homedir(), '.claude', 'theo-memory.env');
const DEFAULT_TIMEOUT_MS = 3000;

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

  return { url: url.replace(/\/+$/, ''), token: token || null };
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
 * @param {string} path      request path, e.g. '/v1/recall'
 * @param {object} body      JSON request body
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<object|null>}
 */
export async function post(path, body, opts = {}) {
  const { url, token } = loadEnv();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${url}${path}`, {
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
