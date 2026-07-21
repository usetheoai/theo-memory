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
 * @see knowledge-base/plans/claude-code-memory-integration-plan.md § T2.1
 * @see knowledge-base/discoveries/blueprints/claude-code-theo-memory-integration-blueprint.md § Coverage Corner 4
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// --- Constants -------------------------------------------------------------

/** Facts per HTTP request. Bounded to stay under the server MAX_BATCH_ITEMS (1000). */
export const CHUNK_SIZE = 500;

/** Above this redacted-content ratio a node is treated as secret-dominated → SKIP (fail-closed). */
export const SECRET_DOMINATED_RATIO = 0.4;

/** Default REST endpoint; overridable via THEOMEM_MIGRATE_URL. */
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:8080';

/**
 * Ordered secret/PII deny-list. Specific patterns run BEFORE the generic
 * high-entropy catch-all so a known key gets its precise `kind`. Every match is
 * replaced with `[REDACTED:<kind>]`. Security-critical — ADR-4.
 */
const SECRET_PATTERNS = [
  { kind: 'private_key', re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, privateKey: true },
  { kind: 'openai_key', re: /sk-[A-Za-z0-9_-]{20,}/g },
  { kind: 'theo_key', re: /theo_live_[A-Za-z0-9_-]+/g },
  { kind: 'aws_key', re: /AKIA[0-9A-Z]{16}/g },
  { kind: 'github_token', re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'jwt', re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { kind: 'bearer_token', re: /Bearer\s+[A-Za-z0-9._-]{20,}/g },
  { kind: 'high_entropy', re: /[A-Za-z0-9+/]{32,}={0,2}/g },
];

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
  return [node.description, node.body].filter((s) => s && s.trim() !== '').join('\n\n');
}

// --- SCRUB (fail-closed, security-critical — ADR-4) ------------------------

/**
 * Redact every deny-list secret/PII match in `text`, replacing with
 * `[REDACTED:<kind>]`. Returns the cleaned text plus accounting used by the
 * fail-closed skip decision.
 *
 * @param {string} text
 * @returns {{ clean: string, redactedChars: number, originalChars: number, kinds: string[], hadPrivateKey: boolean }}
 */
export function scrub(text) {
  const originalChars = text.length;
  let clean = text;
  let redactedChars = 0;
  const kinds = [];
  let hadPrivateKey = false;
  for (const { kind, re, privateKey } of SECRET_PATTERNS) {
    clean = clean.replace(re, (match) => {
      redactedChars += match.length;
      kinds.push(kind);
      if (privateKey) hadPrivateKey = true;
      return `[REDACTED:${kind}]`;
    });
  }
  return { clean, redactedChars, originalChars, kinds, hadPrivateKey };
}

// --- MAP -------------------------------------------------------------------

/**
 * Map a parsed node to a `POST /v1/remember/batch` item. Text is the SCRUBBED
 * `description + body`; provenance (source/project/file/node_type/wikilinks) is
 * carried in metadata (values kept string|number|boolean|null per the server
 * schema — wikilinks joined into a comma string).
 *
 * @param {ReturnType<typeof parseNode>} node
 * @param {{ userId: string, project: string }} opts
 */
export function nodeToBatchItem(node, opts) {
  const { clean } = scrub(combinedText(node));
  const type = node.type;
  const metadata = {
    source: 'claude-code',
    project: opts.project,
    file: node.file,
    wikilinks: node.wikilinks.join(','),
  };
  if (type) metadata.node_type = type;
  const item = { userId: opts.userId, text: clean, infer: false, metadata };
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
export function planMigration(sourceDir) {
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

      items.push(nodeToBatchItem(node, { userId: slug, project: slug }));
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
 * POST the batch items to `<endpoint>/v1/remember/batch` in chunks of
 * {@link CHUNK_SIZE}. Fails LOUD — throws {@link MigrationHttpError} on an
 * unreachable endpoint or any non-2xx status, never partially claims success.
 *
 * @param {Array<object>} items
 * @param {{ endpoint: string, token?: string, chunkSize?: number, fetchImpl?: typeof fetch }} opts
 */
export async function importBatch(items, opts) {
  const endpoint = opts.endpoint;
  const chunkSize = opts.chunkSize ?? CHUNK_SIZE;
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${endpoint.replace(/\/+$/, '')}/v1/remember/batch`;
  const totals = { imported: 0, deduped: 0, failed: 0, requests: 0 };

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const endpoint = process.env.THEOMEM_MIGRATE_URL || DEFAULT_ENDPOINT;
  const token = process.env.THEOMEM_MIGRATE_TOKEN || undefined;

  const { report, items } = planMigration(args.source);
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
  log(`committing ${items.length} item(s) to ${endpoint}/v1/remember/batch ...`);
  const result = await importBatch(items, { endpoint, token });
  log(`imported=${result.imported} deduped=${result.deduped} failed=${result.failed} requests=${result.requests}`);
}

// Guard: only run the CLI when executed directly, never when imported.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
