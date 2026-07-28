/**
 * Postbuild — rewrite `@usetheo/*` workspace path-aliases in the emitted
 * `dist/**` artifacts to RELATIVE specifiers pointing at the co-compiled dist
 * output.
 *
 * Why this exists
 * ---------------
 * The workspace packages (`@usetheo/memory`, `@usetheo/memory-api`,
 * `@usetheo/memory-mcp`, plus subpaths) declare `exports` that resolve to their
 * TypeScript SOURCE (`./src/*.ts`) for the dev/test loader. `tsc` compiles the
 * whole import graph into a single root `dist/` (rootDir `packages/`, so
 * `packages/core/src/index.ts` -> `dist/core/src/index.js`; the CLI is then
 * moved to `dist/agent-tools/` by `postbuild:move-cli`). But `tsc` leaves the
 * bare alias specifiers (`import ... from '@usetheo/memory-mcp'`) untouched in
 * the emitted `.js`. Under plain Node, those bare specifiers resolve through the
 * node_modules workspace symlink back to the package's `exports` -> `src/*.ts`,
 * so `node dist/agent-tools/cli.js` crashes with ERR_MODULE_NOT_FOUND
 * (`packages/mcp/src/server.js`). The co-compiled `dist/mcp/src/*.js` is orphaned.
 *
 * This script bridges that gap deterministically (no extra dependency, matching
 * the existing inline-node postbuild idiom): every `@usetheo/*` specifier in the
 * emitted dist `.js` and `.d.ts` files is rewritten to a relative path that
 * resolves to the compiled dist file.
 *
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const DIST = 'dist';

// Specifier -> dist-root-relative compiled target.
const EXACT = {
  '@usetheo/memory': 'core/src/index.js',
  '@usetheo/memory/contract': 'core/src/domain/index.js',
  '@usetheo/memory/theokit': 'core/src/infrastructure/theokit/index.js',
  '@usetheo/memory-cli': 'agent-tools/index.js',
  '@usetheo/memory-agent-core': 'agent-core/src/index.js',
  '@usetheo/memory-api': 'api/src/server/index.js',
  '@usetheo/memory-mcp': 'mcp/src/index.js',
  // Subpath exports imported by the dist server/MCP entrypoints as BARE specifiers.
  // Must be mapped here or the fail-loud postbuild aborts `pnpm build` → docker build
  // → the publish CI goes red. Add any new such subpath in the SAME change that imports it.
  '@usetheo/memory/recall-trace-pg': 'core/src/infrastructure/db/recall-trace/index.js',
  // M25 — `@usetheo/memory/config` subpath imported by the dist CLI (run-server
  // resolves THEOMEM_PG_URI via loadConfig). Must be mapped or the fail-loud
  // postbuild aborts pnpm build / publish CI (known subpath gotcha).
  '@usetheo/memory/config': 'core/src/config-entry.js',
};
// Wildcard prefix -> dist-root-relative directory the rest maps into.
const PREFIX = {
  '@usetheo/memory/embedders/': 'core/src/infrastructure/embedders/',
  '@usetheo/memory/llms/': 'core/src/infrastructure/llms/',
};

/** Resolve a `@usetheo/*` specifier to its dist-root-relative `.js` target, or null. */
function resolveTarget(spec) {
  if (Object.prototype.hasOwnProperty.call(EXACT, spec)) return EXACT[spec];
  for (const [pfx, dir] of Object.entries(PREFIX)) {
    if (spec.startsWith(pfx)) return dir + spec.slice(pfx.length) + '.js';
  }
  return null;
}

/** Turn a dist-relative path into a `./`-prefixed POSIX specifier. */
function toSpecifier(fromFileDir, distRelTarget) {
  let rel = relative(fromFileDir, join(DIST, distRelTarget)).split('\\').join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.js') || full.endsWith('.d.ts')) yield full;
  }
}

// Matches the quoted specifier in: import ... from '<spec>'; export ... from '<spec>';
// import('<spec>'); — captures the quote char and the specifier.
const SPEC_RE = /(from\s*|import\s*\(\s*)(['"])(@usetheo\/[^'"]+)\2/g;

let filesChanged = 0;
let rewrites = 0;
let unresolved = 0;

for (const file of walk(DIST)) {
  const src = readFileSync(file, 'utf8');
  const fileDir = dirname(file);
  let changed = false;
  const out = src.replace(SPEC_RE, (match, lead, quote, spec) => {
    const target = resolveTarget(spec);
    if (target === null) {
      unresolved += 1;
      console.error(`rewrite-dist-aliases: UNRESOLVED specifier ${spec} in ${file}`);
      return match;
    }
    changed = true;
    rewrites += 1;
    return `${lead}${quote}${toSpecifier(fileDir, target)}${quote}`;
  });
  if (changed) {
    writeFileSync(file, out);
    filesChanged += 1;
  }
}

if (unresolved > 0) {
  console.error(`rewrite-dist-aliases: ${unresolved} unresolved @usetheo specifier(s) — failing build (fail-loud).`);
  process.exit(1);
}
console.error(`rewrite-dist-aliases: rewrote ${rewrites} specifier(s) across ${filesChanged} file(s).`);
