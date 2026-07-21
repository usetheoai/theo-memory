#!/usr/bin/env bash
# install.sh — deploy the theo-memory Claude Code kit to ~/.claude.
#
# Idempotent: re-running copies the latest hook files and MERGES the 3 theo hook
# registrations into ~/.claude/settings.json WITHOUT clobbering existing hooks and
# WITHOUT duplicating the theo entries. The merge reuses the SAME mergeHooks() the
# test exercises (hooks/merge-settings.mjs) — the tested code is the shipped code.
#
# Usage: docs/claude-code-kit/install.sh
set -euo pipefail

# --- resolve paths -----------------------------------------------------------
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
HOOKS_DIR="${CLAUDE_DIR}/hooks"
SETTINGS="${CLAUDE_DIR}/settings.json"
ENV_FILE="${CLAUDE_DIR}/theo-memory.env"

NODE_BIN="$(command -v node || true)"
if [[ -z "${NODE_BIN}" ]]; then
  echo "ERROR: node not found on PATH — the theo hooks require node (>=18)." >&2
  exit 1
fi

echo "theo-memory Claude Code kit installer"
echo "  kit source : ${KIT_DIR}"
echo "  target     : ${CLAUDE_DIR}"

# --- 1. copy the hook + lib files --------------------------------------------
mkdir -p "${HOOKS_DIR}"
for f in theo-lib.mjs merge-settings.mjs theo-recall.mjs theo-remember.mjs theo-precompact.mjs; do
  cp "${KIT_DIR}/hooks/${f}" "${HOOKS_DIR}/${f}"
done
chmod +x "${HOOKS_DIR}/theo-recall.mjs" "${HOOKS_DIR}/theo-remember.mjs" "${HOOKS_DIR}/theo-precompact.mjs"
echo "  copied 5 hook files → ${HOOKS_DIR}"

# --- 2. seed the env file if absent ------------------------------------------
if [[ -f "${ENV_FILE}" ]]; then
  echo "  env exists — left untouched: ${ENV_FILE}"
else
  cp "${KIT_DIR}/theo-memory.env.example" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  echo "  seeded env (chmod 600): ${ENV_FILE}  <-- EDIT the URL/token"
fi

# --- 3. merge the hook registrations into settings.json ----------------------
# A node one-liner that: reads the existing settings.json (or {}), calls the shipped
# mergeHooks() + theoAdditions(), and writes the result back pretty-printed. Idempotent
# by construction (mergeHooks skips a registration whose command already exists).
mkdir -p "${CLAUDE_DIR}"
MERGE_MJS="${HOOKS_DIR}/merge-settings.mjs"
SETTINGS="${SETTINGS}" MERGE_MJS="${MERGE_MJS}" "${NODE_BIN}" --input-type=module <<'NODE'
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const settingsPath = process.env.SETTINGS;
const mergeMod = await import(pathToFileURL(process.env.MERGE_MJS).href);
const { mergeHooks, theoAdditions } = mergeMod;

let existing = {};
if (existsSync(settingsPath)) {
  const raw = readFileSync(settingsPath, 'utf8').trim();
  if (raw) {
    try {
      existing = JSON.parse(raw);
    } catch (e) {
      console.error(`ERROR: ${settingsPath} is not valid JSON — refusing to overwrite. (${e.message})`);
      process.exit(1);
    }
  }
}

const merged = mergeHooks(existing, theoAdditions('node', '~/.claude/hooks'));
writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
console.log(`  merged theo hook registrations → ${settingsPath}`);
NODE

# --- 4. print the MCP registration command (do NOT run it) -------------------
echo ""
echo "Hooks installed. Next, register the explicit MCP complement (run this yourself,"
echo "substituting your endpoint + token from ${ENV_FILE}):"
echo ""
echo '  claude mcp add --transport http --scope user theo-memory <URL>/mcp \'
echo '    --header "Authorization: Bearer <TOKEN>"'
echo ""
echo "Then edit ${ENV_FILE} to point at your endpoint. Done."
