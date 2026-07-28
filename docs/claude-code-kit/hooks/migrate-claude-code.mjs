/**
 * Claude-Code-memory → theo-memory migration tool (M6 T2.1).
 *
 * Migrates Claude Code's native file-memory (`~/.claude/projects/<slug>/memory/*.md`)
 * into theo-memory via `POST /v1/remember/batch` (`infer:false` verbatim store +
 * composite-UPSERT idempotency).
 *
 * Pipeline per node: PARSE (both frontmatter variants + wikilinks) → SCRUB
 * (fail-closed secret/PII redaction — ADR-4) → MAP (batch item + provenance
 * metadata) → BATCH IMPORT (chunked HTTP).
 *
 * Default is DRY-RUN (parse + scrub + review report; writes NOTHING over HTTP).
 * `--commit` is required to actually POST.
 *
 * Stdlib only — NO new dependency (parsimony rung 4). Pure functions
 * (`parseNode`, `scrub`, `nodeToBatchItem`, `planMigration`) are exported for
 * unit testing; the CLI `main()` is guarded so importing the module never runs it.
 *
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Single source of truth for the secret/PII deny-list (M6-SEC-01): the SAME scrub
// the ongoing auto-remember hooks apply. Re-exported below so existing unit tests
// that import `{ scrub }` from this module keep working.
import { scrub } from './theo-scrub.mjs';

// --- Constants -------------------------------------------------------------

/**
 * Facts per HTTP request. The server does per-item work (embedding ≈ 1.5s/item measured live,
 * issue #109): 183 items took 275s — grazing Node fetch's non-extendable ~300s headers timeout
 * ("fetch failed"). 75 caps a request at ~2 min with margin; also far under MAX_BATCH_ITEMS (1000).
 */
export const CHUNK_SIZE = 75;

/**
 * Serialized-body byte budget per HTTP request (issue #109). The REST server enforces a
 * 1 MB bodyLimit (DOS guard); a count-only chunk of real-world prose exceeds it → 413.
 * Conservative half-limit leaves headroom for JSON envelope + multi-byte characters.
 */
export const CHUNK_MAX_BYTES = 512 * 1024;

/** Above this redacted-content ratio a node is treated as secret-dominated → SKIP (fail-closed). */
export const SECRET_DOMINATED_RATIO = 0.4;

/** Default REST endpoint; overridable via THEOMEM_MIGRATE_URL. */
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:8080';

/** Re-export the shared scrub so `import { scrub } from '<this module>'` still resolves. */
export { scrub };

// --- Typed errors (error-handling.md: explicit + typed, never magic values) --

/** Raised when the batch endpoint is unreachable or returns a non-2xx status. */
export class MigrationHttpError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationHttpError';
  }
}

// --- PARSE -----------------------------------------------------------------

function unquote(v) {
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}

/**
 * Parse the frontmatter block into `{ top, metadata }`. Accepts BOTH the flat
 * top-level `type:` variant and the nested `metadata:\n  type:` variant.
 */
function parseFrontmatter(block, fm) {
  let inMetadata = false;
  for (const line of block.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const kv = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const indent = kv[1].length;
    const key = kv[2];
    const val = unquote(kv[3].trim());
    if (indent === 0) {
      if (key === 'metadata' && val === '') {
        inMetadata = true;
        continue;
      }
      inMetadata = false;
      fm.top[key] = val;
    } else if (inMetadata) {
      fm.metadata[key] = val;
    }
  }
}

function extractWikilinks(text) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const link = m[1].trim();
    if (link !== '') out.push(link);
  }
  return out;
}

/**
 * Parse a raw memory-node file into a structured node.
 * `type` is resolved from flat `type` first, then nested `metadata.type`.
 *
 * @param {string} raw       full file contents
 * @param {string} filename  bare filename (provenance)
 */
export function parseNode(raw, filename) {
  const fm = { top: {}, metadata: {} };
  let body = raw;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (m) {
    parseFrontmatter(m[1], fm);
    body = m[2];
  }
  const type = fm.top.type ?? fm.metadata.type;
  const description = fm.top.description ?? '';
  return {
    file: filename,
    name: fm.top.name,
    description,
    type,
    body: body.trim(),
    // wikilinks may appear in the description or the body — capture from both.
    wikilinks: extractWikilinks(`${description}\n${body}`),
    frontmatter: fm,
  };
}

function combinedText(node) {
  // COR-05: include `name` — a node whose only human label is the frontmatter
  // `name` would otherwise migrate with near-empty text and be dropped by the
  // SKIP gate as "empty after scrub".
  return [node.name, node.description, node.body]
    .filter((s) => s && s.trim() !== '')
    .join('\n\n');
}

// --- SCRUB — the deny-list + scrub() live in the shared theo-scrub.mjs module,
//     imported + re-exported at the top of this file. Single source of truth with
//     the ongoing auto-remember hooks (M6-SEC-01), so a secret shape the migration
//     redacts is redacted on every Stop/PreCompact write too.

// --- MAP -------------------------------------------------------------------

/**
 * Map a parsed node to a `POST /v1/remember/batch` item. Text is the SCRUBBED
 * `description + body`; provenance (source/project/file/node_type/wikilinks) is
 * carried in metadata (values kept string|number|boolean|null per the server
 * schema — wikilinks joined into a comma string).
 *
 * Scope semantics (#109 live E2E, theo-lib parity): `userId` is OPTIONAL — omitted, the item
 * carries NO userId so the gateway's edge-injected X-Theo-User-Id binds the tier and migrated
 * rows land in the SAME scope the kit hooks recall from. The project slug is provenance
 * metadata, never the scope.
 *
 * @param {ReturnType<typeof parseNode>} node
 * @param {{ userId?: string, project: string }} opts
 */
export function nodeToBatchItem(node, opts) {
  const { clean } = scrub(combinedText(node));
  // SEC-05 (M12 review F-arch-3): EVERY source-derived field is scrubbed before it can ride into
  // the batch item — including the frontmatter `type` and the filename. "Scrub before any network
  // write on every path" means every path, not just the body text.
  const type = node.type ? scrub(String(node.type)).clean : node.type;
  const metadata = {
    source: 'claude-code',
    project: opts.project,
    file: scrub(String(node.file)).clean,
    // SEC-04: scrub the wikilinks too — they ride into metadata, so a secret
    // embedded in a `[[...]]` link must be redacted like the body text is.
    wikilinks: scrub(node.wikilinks.join(',')).clean,
  };
  if (type) metadata.node_type = type;
  const item = { ...(opts.userId ? { userId: opts.userId } : {}), text: clean, infer: false, metadata };
  if (type) item.category = type;
  return item;
}

// --- PLAN (dry-run — NEVER performs HTTP) ----------------------------------

/**
 * Walk `<sourceDir>/<slug>/memory/*.md` and produce the migration plan: the
 * batch items that WOULD import plus a review report (scanned / would-import /
 * redacted / skipped). `MEMORY.md` is a derivable index — skipped. A node is
 * SKIPPED (fail-closed) when a private-key block is present, when it is
 * secret-dominated (> 40% redacted), or when it is empty after scrub.
 *
 * Pure/offline: reads the filesystem only — makes NO network call.
 *
 * @param {string} sourceDir
 */
export function planMigration(sourceDir, opts = {}) {
  const items = [];
  const skipped = [];
  const nodes = [];
  let scanned = 0;
  let redacted = 0;

  if (!existsSync(sourceDir)) {
    throw new Error(`migrate: source directory not found: ${sourceDir}`);
  }

  for (const projectEnt of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!projectEnt.isDirectory()) continue;
    const slug = projectEnt.name;
    const memDir = join(sourceDir, slug, 'memory');
    if (!existsSync(memDir)) continue;
    for (const file of readdirSync(memDir)) {
      if (!file.endsWith('.md') || file === 'MEMORY.md') continue;
      scanned += 1;
      const raw = readFileSync(join(memDir, file), 'utf8');
      const node = parseNode(raw, file);
      const s = scrub(combinedText(node));
      const ratio = s.originalChars > 0 ? s.redactedChars / s.originalChars : 0;

      let reason = null;
      if (s.hadPrivateKey) {
        reason = 'private-key block present';
      } else if (ratio > SECRET_DOMINATED_RATIO) {
        reason = `secret-dominated (${Math.round(ratio * 100)}% redacted)`;
      } else if (s.clean.trim() === '') {
        reason = 'empty after scrub';
      }

      if (reason !== null) {
        skipped.push({ file, project: slug, reason });
        nodes.push({ file, project: slug, skipped: true, reason, redactions: s.kinds.length });
        continue;
      }

      items.push(nodeToBatchItem(node, { userId: opts.userId, project: slug }));
      if (s.redactedChars > 0) redacted += 1;
      nodes.push({ file, project: slug, skipped: false, redactions: s.kinds.length });
    }
  }

  return {
    items,
    report: { scanned, wouldImport: items.length, redacted, skipped, nodes },
  };
}

// --- BATCH IMPORT (fail-loud on any HTTP failure) --------------------------

/**
 * Split items into chunks bounded BOTH by count ({@link CHUNK_SIZE} / opts.chunkSize)
 * AND serialized bytes ({@link CHUNK_MAX_BYTES}) — issue #109: a count-only chunk of
 * real-world prose exceeds the server's 1 MB bodyLimit and the whole import 413s.
 * A single item that alone exceeds the byte budget fails FAST with a typed error
 * (the server would reject it anyway; silent skip would hide data loss).
 *
 * @param {Array<object>} items
 * @param {number} chunkSize
 * @param {number} maxBytes
 * @returns {Array<Array<object>>}
 */
export function chunkByBytes(items, chunkSize, maxBytes) {
  // JSON envelope: {"items":[...]} + commas between items.
  const envelope = '{"items":[]}'.length;
  const chunks = [];
  let current = [];
  let currentBytes = envelope;
  for (const item of items) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
    if (envelope + itemBytes > maxBytes) {
      throw new MigrationHttpError(
        `batch item exceeds the per-request byte budget (${itemBytes} > ${maxBytes - envelope} bytes serialized) — cannot import without server-side 413`,
      );
    }
    if (current.length >= chunkSize || currentBytes + itemBytes + 1 > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = envelope;
    }
    current.push(item);
    currentBytes += itemBytes + 1; // +1 for the separating comma
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * POST the batch items to `<endpoint>/v1/remember/batch` in chunks bounded by
 * count ({@link CHUNK_SIZE}) AND serialized bytes ({@link CHUNK_MAX_BYTES}).
 * Fails LOUD — throws {@link MigrationHttpError} on an
 * unreachable endpoint or any non-2xx status, never partially claims success.
 *
 * @param {Array<object>} items
 * @param {{ endpoint: string, token?: string, pathPrefix?: string, chunkSize?: number, maxBytes?: number, fetchImpl?: typeof fetch }} opts
 */
export async function importBatch(items, opts) {
  const endpoint = opts.endpoint;
  const chunkSize = opts.chunkSize ?? CHUNK_SIZE;
  const maxBytes = opts.maxBytes ?? CHUNK_MAX_BYTES;
  const doFetch = opts.fetchImpl ?? fetch;
  // theo-lib parity: with a gateway prefix the verb path drops its /v1 — the gateway rewrite
  // maps /v1/memory/remember/batch → /v1/remember/batch. Without a prefix, native REST path.
  const prefix = (opts.pathPrefix ?? '').replace(/\/+$/, '');
  const path = prefix ? `${prefix}/remember/batch` : '/v1/remember/batch';
  const url = `${endpoint.replace(/\/+$/, '')}${path}`;
  const totals = { imported: 0, deduped: 0, failed: 0, requests: 0 };

  for (const chunk of chunkByBytes(items, chunkSize, maxBytes)) {
    const headers = { 'content-type': 'application/json' };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;

    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ items: chunk }),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new MigrationHttpError(`batch import failed: POST ${url} unreachable (${detail})`);
    }

    if (!res.ok) {
      let text = '';
      try {
        text = await res.text();
      } catch {
        text = '';
      }
      throw new MigrationHttpError(
        `batch import failed: POST ${url} -> ${res.status} ${res.statusText} ${text.slice(0, 200)}`,
      );
    }

    let body = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    totals.imported += Number(body.imported ?? 0);
    totals.deduped += Number(body.deduped ?? 0);
    totals.failed += Number(body.failed ?? 0);
    totals.requests += 1;
  }
  return totals;
}

/**
 * Orchestrate a run: plan (offline) then, only when `commit` is true, import.
 * Dry-run performs NO network call.
 *
 * @param {{ sourceDir: string, commit?: boolean, endpoint: string, token?: string, fetchImpl?: typeof fetch }} opts
 */
export async function runMigration(opts) {
  const plan = planMigration(opts.sourceDir);
  if (!opts.commit) {
    return { plan, committed: false };
  }
  const result = await importBatch(plan.items, {
    endpoint: opts.endpoint,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
  });
  return { plan, result, committed: true };
}

// --- CLI -------------------------------------------------------------------

const USAGE = `migrate-claude-code-memory — Claude Code memory -> theo-memory

Usage:
  node scripts/migrate-claude-code-memory.mjs [--source <dir>] [--commit]

Options:
  --source <dir>   Root of Claude Code projects (default: ~/.claude/projects)
  --commit         Actually POST to the batch endpoint. DEFAULT IS DRY-RUN.
  --help, -h       Show this help.

Environment:
  THEOMEM_MIGRATE_URL     Batch endpoint base (default: ${DEFAULT_ENDPOINT})
  THEOMEM_MIGRATE_TOKEN   Optional Bearer token (theo_live_*)

Default is DRY-RUN: parse + scrub + print a review report; writes NOTHING.
Pass --commit to import. Secrets are scrubbed fail-closed before any write.`;

export function parseArgs(argv) {
  const args = { commit: false, help: false, source: join(homedir(), '.claude', 'projects') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') args.commit = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--source') args.source = argv[++i];
    else if (a.startsWith('--source=')) args.source = a.slice('--source='.length);
  }
  return args;
}

/** Parse the kit env file (`KEY=VALUE` lines; `#` comments ignored; surrounding quotes stripped —
 * mirrors the kit's `theo-lib.mjs` parser so a quoted token works identically). Missing file → {}. */
export function parseKitEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    let v = t.slice(eq + 1).trim();
    // F-arch-2: strip ONE pair of surrounding quotes (theo-lib.mjs parity).
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

/**
 * Resolve `{ url, token }` (blueprint D2 precedence): `THEOMEM_MIGRATE_*` explicit override →
 * `THEOMEM_MEMORY_*` env (+PATH_PREFIX) → the same keys from `~/.claude/theo-memory.env` (the kit
 * file — ZERO-CONFIG on kit machines, incl. the standalone `node ~/.claude/hooks/...` path) →
 * undefined (caller falls back to DEFAULT_ENDPOINT). Deliberate: an explicit MIGRATE_URL override
 * does NOT inherit the kit token (fail-closed against cross-endpoint token leakage).
 */
export function resolveImportEndpoint(env, fileVars) {
  if (env.THEOMEM_MIGRATE_URL !== undefined && env.THEOMEM_MIGRATE_URL !== '') {
    return {
      url: env.THEOMEM_MIGRATE_URL,
      pathPrefix: '',
      token: env.THEOMEM_MIGRATE_TOKEN || undefined,
      userId: env.THEOMEM_MEMORY_USER_ID || undefined,
    };
  }
  const base = env.THEOMEM_MEMORY_URL || fileVars.THEOMEM_MEMORY_URL || '';
  // The prefix is returned SEPARATELY, never baked into the url: the Theo gateway REWRITES
  // /v1/memory/X → /v1/X (Traefik memory-rewrite), so the verb path must drop its /v1 when a
  // prefix is in play (theo-lib parity — issue #109 live E2E hit /v1/memory/v1/... → 404).
  const pathPrefix = env.THEOMEM_MEMORY_PATH_PREFIX || fileVars.THEOMEM_MEMORY_PATH_PREFIX || '';
  const token = env.THEOMEM_MEMORY_TOKEN || fileVars.THEOMEM_MEMORY_TOKEN || undefined;
  const userId = env.THEOMEM_MEMORY_USER_ID || fileVars.THEOMEM_MEMORY_USER_ID || undefined;
  if (base !== '') {
    return { url: base.replace(/\/+$/, ''), pathPrefix, token, userId };
  }
  return { url: undefined, pathPrefix, token, userId };
}

export async function main(argvOverride) {
  const args = parseArgs(argvOverride ?? process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  // D2 resolution lives IN the engine so the kit-shipped standalone path is zero-config too.
  const fileVars = parseKitEnvFile(join(homedir(), '.claude', 'theo-memory.env'));
  const resolved = resolveImportEndpoint(process.env, fileVars);
  const endpoint = resolved.url || DEFAULT_ENDPOINT;
  const token = process.env.THEOMEM_MIGRATE_TOKEN || resolved.token || undefined;
  // theo-lib parity: explicit user override wins; absent → items carry NO userId and the
  // gateway's edge-injected X-Theo-User-Id binds the scope the kit hooks recall from.
  const userId = process.env.THEOMEM_MIGRATE_USER_ID || resolved.userId || undefined;

  const { report, items } = planMigration(args.source, { userId });
  const log = (s) => process.stdout.write(`${s}\n`);
  log(`source:      ${args.source}`);
  log(`scanned:     ${report.scanned} node(s)`);
  log(`would-import:${report.wouldImport}`);
  log(`redacted-in: ${report.redacted} node(s) (imported with secrets scrubbed)`);
  log(`skipped:     ${report.skipped.length} node(s)`);
  for (const s of report.skipped) {
    log(`  - SKIP ${s.project}/${s.file}: ${s.reason}`);
  }

  if (!args.commit) {
    log('');
    log('DRY-RUN (no --commit): nothing written over HTTP. Re-run with --commit to import.');
    return;
  }

  log('');
  const prefix = resolved.pathPrefix || '';
  log(`committing ${items.length} item(s) to ${endpoint}${prefix ? `${prefix}/remember/batch` : '/v1/remember/batch'} ...`);
  const result = await importBatch(items, { endpoint, token, pathPrefix: prefix });
  log(`imported=${result.imported} deduped=${result.deduped} failed=${result.failed} requests=${result.requests}`);
}

// Guard: only run the CLI when executed directly, never when imported.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
