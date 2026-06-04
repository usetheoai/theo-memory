#!/usr/bin/env node
/**
 * Thin runner that reads a file from disk + invokes the bridge per CLI args.
 * Used by the dogfood-mirror hook (PostToolUse on Write/Edit of memory files).
 *
 * T1.2 of dogfood-anchor-scenario-launch plan v1.1.
 *
 * Usage:
 *   node run-bridge-from-file.mjs \
 *     --project-slug "/abs/path/to/project" \
 *     --file "/abs/path/to/memory/foo.md" \
 *     --op remember
 *
 * Exit codes:
 *   0 — bridge succeeded OR skipped (empty content)
 *   1 — invalid arguments
 *   2 — bridge threw (MCPUnreachable, InvalidProjectSlug, or other)
 *
 * Delegates to the compiled bridge at dist/scripts/dogfood/claude-code-bridge.js;
 * falls back to ts-node-style on-the-fly resolution if dist/ is missing
 * (intentional: T2.1 + T2.2 expect `npm run build` was run before mirror is
 * exercised in real Claude Code sessions).
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k?.startsWith('--')) {
      args[k.slice(2)] = v;
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args['project-slug'] || !args.file || !args.op) {
  console.error('usage: run-bridge-from-file --project-slug <path> --file <path> --op <remember|recall|forget|reflect>');
  process.exit(1);
}

if (!existsSync(args.file)) {
  // File was deleted between Write and our hook firing. Not a degradation;
  // just skip.
  process.exit(0);
}

const content = readFileSync(args.file, 'utf8');

const bridgeDir = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(bridgeDir, '..', '..', 'dist', 'scripts', 'dogfood', 'claude-code-bridge.js');
const srcPath = resolve(bridgeDir, 'claude-code-bridge.ts');

const modulePath = existsSync(distPath) ? distPath : srcPath;

try {
  const bridge = await import(modulePath);
  const ctx = { projectSlug: basename(args['project-slug']) };
  let result;
  switch (args.op) {
    case 'remember':
      result = await bridge.bridgeRemember(content, ctx);
      break;
    case 'recall':
      result = await bridge.bridgeRecall(content, ctx);
      break;
    default:
      console.error(`unsupported op: ${args.op}`);
      process.exit(1);
  }
  if (result?.skipped) {
    process.exit(0);
  }
  process.exit(0);
} catch (err) {
  console.error(`bridge failed: ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
  process.exit(2);
}
