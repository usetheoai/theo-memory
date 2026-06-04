#!/usr/bin/env node
/**
 * Unified bridge runner — exercised by BOTH the dogfood-mirror hook AND the
 * memory-policy skill.
 *
 * T1.2 of dogfood-anchor-scenario-launch plan v1.1.
 *
 * Usage:
 *   node run-bridge.mjs --project-slug <path> --op <verb> [--text|--file|--query|--memory-id <val>]
 *
 * Ops:
 *   remember  — requires --text OR --file (text content OR file path to read)
 *   recall    — requires --query
 *   forget    — requires --memory-id
 *   reflect   — no extra args
 *
 * Exit codes:
 *   0 — bridge succeeded OR skipped (empty content) OR file missing on mirror
 *   1 — invalid arguments
 *   2 — bridge threw (MCPUnreachable / InvalidProjectSlug / other)
 */
import { existsSync, readFileSync } from 'node:fs';
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
if (!args['project-slug'] || !args.op) {
  console.error('usage: run-bridge --project-slug <path> --op <verb> [--text|--file|--query|--memory-id <val>]');
  process.exit(1);
}

const bridgeDir = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(bridgeDir, '..', '..', 'dist', 'scripts', 'dogfood', 'claude-code-bridge.js');
const srcPath = resolve(bridgeDir, 'claude-code-bridge.ts');
const modulePath = existsSync(distPath) ? distPath : srcPath;

try {
  const bridge = await import(modulePath);
  const ctx = { projectSlug: basename(args['project-slug']) };
  let result;
  switch (args.op) {
    case 'remember': {
      let text = args.text;
      if (!text && args.file) {
        if (!existsSync(args.file)) {
          // File deleted between Write and hook firing; skip silently.
          process.exit(0);
        }
        text = readFileSync(args.file, 'utf8');
      }
      if (!text) {
        console.error('remember requires --text OR --file');
        process.exit(1);
      }
      result = await bridge.bridgeRemember(text, ctx);
      break;
    }
    case 'recall': {
      if (!args.query) {
        console.error('recall requires --query');
        process.exit(1);
      }
      result = await bridge.bridgeRecall(args.query, ctx);
      break;
    }
    case 'forget': {
      if (!args['memory-id']) {
        console.error('forget requires --memory-id');
        process.exit(1);
      }
      result = await bridge.bridgeForget(args['memory-id'], ctx);
      break;
    }
    case 'reflect': {
      result = await bridge.bridgeReflect(ctx);
      break;
    }
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
